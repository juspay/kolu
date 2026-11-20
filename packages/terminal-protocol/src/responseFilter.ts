/**
 * Filter terminal *query responses* out of a mirroring client's input before
 * they reach the PTY.
 *
 * The server runs a headless xterm that already answers device queries
 * (DA1/DA2, DSR/CPR, DECRQM, XTVERSION, window/colour reports, …). A mirroring
 * client's terminal answers them too, and those duplicate answers, arriving
 * late over the wire, get echoed back into the PTY and printed as visible
 * garbage.
 *
 * Two entry points, for two stream shapes: `isTerminalQueryResponse` is a
 * whole-payload predicate, for callers that already get one discrete source
 * event per call (xterm's `onData`); `createTerminalResponseStripper` is a
 * streaming, boundary-aware filter, for the raw-tty path.
 */

// CSI responses, anchored to the whole payload:
//   DA1/DA2  CSI [?>=] Ps… c        e.g. ESC [ ? 1 ; 2 c
//   DSR      CSI Ps… n              e.g. ESC [ 0 n
//   CPR      CSI Ps ; Ps R          e.g. ESC [ 12 ; 40 R
//   DECRPM   CSI ? Ps ; Ps $ y      e.g. ESC [ ? 25 ; 1 $ y   (note the `$y`)
//   size     CSI Ps ; Ps ; Ps t     window/text-area reports
const CSI_RESPONSE = /^\x1b\[[?>=]?[\d;]*(?:\$y|[cnRt])$/;

// OSC *colour* responses — NOT every OSC packet:
//   OSC 4 ; index ; rgb:… (BEL|ST)   palette colour report
//   OSC 10–19 ; rgb:… (BEL|ST)       dynamic colours (fg/bg/cursor/…)
const OSC_COLOUR_RESPONSE = /^\x1b\](?:4|1[0-9]);[\s\S]*?(?:\x07|\x1b\\)$/;

// DCS responses, anchored to the whole payload and to the response introducers
// xterm actually emits — NOT every `ESC P … ST` packet:
//   XTVERSION   ESC P > | text ST
//   DECRQSS     ESC P [01] $ r … ST   (valid/invalid setting reports)
// Sixel/DECUDK/etc. are program *output*, never keyboard input, and don't carry
// these introducers, so they stay forwarded.
const DCS_RESPONSE = /^\x1bP(?:>\||[01]\$r)[\s\S]*?\x1b\\$/;

/** True when `data` is a complete terminal-generated query response. */
export function isTerminalQueryResponse(data: string): boolean {
  return (
    CSI_RESPONSE.test(data) ||
    OSC_COLOUR_RESPONSE.test(data) ||
    DCS_RESPONSE.test(data)
  );
}

const ESC = 0x1b;
const BEL = 0x07;
const CSI_INTRODUCER = 0x5b;
const OSC_INTRODUCER = 0x5d;
const DCS_INTRODUCER = 0x50;
const ST_FINAL = 0x5c;
const CSI_FINAL_MIN = 0x40;
const CSI_FINAL_MAX = 0x7e;

// Alt+] types `ESC ]` and Alt+Shift+P types `ESC P`: a string introducer can
// arrive from the keyboard, where no BEL/ST terminator ever follows.
const UNTERMINATED_STRING_BUDGET_BYTES = 8192;

type Pending =
  | { kind: "none" }
  | { kind: "esc" }
  | { kind: "csi" }
  /** OSC / DCS, which end at BEL or ST (`ESC \`); `sawStEsc` carries a
   *  half-read ST so its backslash is recognised across the pair. */
  | { kind: "string"; sawStEsc: boolean };

/** What a scanner does with a bare ESC still pending when a push ends: hold it
 *  and `Esc` then `i` merge into `Alt-i`, so it is forwarded instead. */
type BareEscPolicy = "forward-at-end-of-push";

interface VtSequenceSink {
  /** A byte outside any control sequence. */
  passthrough(byte: number): void;
  /** One COMPLETE control sequence, reassembled across chunk boundaries — the
   *  whole unit a response grammar gets to judge. */
  sequence(bytes: readonly number[]): void;
  /** Bytes the scanner will never judge as a sequence: a string sequence past
   *  its budget, or a bare ESC released by the {@link BareEscPolicy}. */
  released(bytes: readonly number[]): void;
}

interface VtSequenceScanner {
  scan(byte: number): void;
  endOfPush(): void;
}

/**
 * Isolate VT control sequences (CSI / OSC / DCS) in a byte stream that carries
 * no event boundaries: a sequence split over two pushes is completed against
 * the next one, and every other byte goes straight to the sink in order.
 */
const createVtSequenceScanner = (config: {
  readonly bareEsc: BareEscPolicy;
  readonly unterminatedStringBudgetBytes: number;
  readonly sink: VtSequenceSink;
}): VtSequenceScanner => {
  const { bareEsc, unterminatedStringBudgetBytes, sink } = config;
  let seq: number[] = [];
  let pending: Pending = { kind: "none" };

  const complete = (): void => {
    sink.sequence(seq);
    seq = [];
    pending = { kind: "none" };
  };

  const release = (): void => {
    sink.released(seq);
    seq = [];
    pending = { kind: "none" };
  };

  return {
    scan(byte: number): void {
      if (pending.kind === "none") {
        if (byte === ESC) {
          pending = { kind: "esc" };
          seq.push(byte);
        } else {
          sink.passthrough(byte);
        }
        return;
      }
      seq.push(byte);
      if (pending.kind === "esc") {
        if (byte === CSI_INTRODUCER) pending = { kind: "csi" };
        else if (byte === OSC_INTRODUCER || byte === DCS_INTRODUCER)
          pending = { kind: "string", sawStEsc: false };
        else complete();
        return;
      }
      if (pending.kind === "csi") {
        if (byte >= CSI_FINAL_MIN && byte <= CSI_FINAL_MAX) complete();
        return;
      }
      if (byte === BEL) {
        complete();
      } else if (pending.sawStEsc) {
        if (byte === ST_FINAL) complete();
        else pending = { kind: "string", sawStEsc: false };
      } else if (byte === ESC) {
        pending = { kind: "string", sawStEsc: true };
      }
      if (
        pending.kind === "string" &&
        seq.length >= unterminatedStringBudgetBytes
      ) {
        release();
      }
    },
    endOfPush(): void {
      if (bareEsc === "forward-at-end-of-push" && pending.kind === "esc") {
        release();
      }
    },
  };
};

export interface TerminalResponseStripper {
  /**
   * Push raw input bytes; get back the bytes to forward to the PTY with every
   * complete query reply removed. Returns an empty buffer when the chunk
   * contained only (the start of) a reply. State carries across calls.
   */
  push(chunk: Buffer): Buffer;
}

/**
 * The STREAMING form of the predicate, for the raw-tty path: a read can split
 * one reply across reads, coalesce several, or sit a reply right up against a
 * real keystroke. Each isolated VT control sequence is judged whole against the
 * same three grammars and dropped when it matches; everything else is forwarded
 * untouched and IN ORDER.
 */
export function createTerminalResponseStripper(): TerminalResponseStripper {
  let out: number[] = [];
  const forward = (bytes: readonly number[]): void => {
    for (const byte of bytes) out.push(byte);
  };
  const scanner = createVtSequenceScanner({
    bareEsc: "forward-at-end-of-push",
    unterminatedStringBudgetBytes: UNTERMINATED_STRING_BUDGET_BYTES,
    sink: {
      passthrough(byte: number): void {
        out.push(byte);
      },
      sequence(bytes: readonly number[]): void {
        let text = "";
        for (const byte of bytes) text += String.fromCharCode(byte);
        if (!isTerminalQueryResponse(text)) forward(bytes);
      },
      released: forward,
    },
  });

  return {
    push(chunk: Buffer): Buffer {
      out = [];
      for (const byte of chunk) scanner.scan(byte);
      scanner.endOfPush();
      return Buffer.from(out);
    },
  };
}
