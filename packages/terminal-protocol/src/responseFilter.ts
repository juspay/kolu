/**
 * Filter terminal *query responses* out of a mirroring client's input before
 * they reach the PTY.
 *
 * The server runs a headless xterm that already answers device queries
 * (DA1/DA2, DSR/CPR, DECRQM, XTVERSION, window/colour reports, …). A mirroring
 * client's terminal answers them too — the browser xterm (`Terminal.tsx`
 * `onData`), or the user's real terminal when `kolu-tui attach` passes the PTY
 * bytes through raw — and those duplicate answers, arriving late over the
 * wire, get echoed back into the PTY and printed as visible garbage (the
 * yazi/TUI escape-soup bug). Both clients suppress the SAME response classes —
 * the three grammars below — so the suppressed set can never drift between
 * them; they differ only in how they slice the input.
 *
 * Two entry points, for two stream shapes:
 *
 *   - `isTerminalQueryResponse` — a whole-payload predicate, for callers that
 *     already get one discrete source event per call. xterm's `onData` is
 *     exactly that: it fires once per terminal-generated event (a keystroke, a
 *     paste, a single reply packet), so a real keystroke and a reply are never
 *     coalesced and dropping a chunk that *is* a reply cannot eat real input.
 *     The grammars are still anchored to the full payload (`^…$`), so a chunk
 *     that merely *contains* a response shape is forwarded untouched.
 *
 *   - `createTerminalResponseStripper` — a streaming, boundary-aware filter,
 *     for the raw-tty path (`kolu-tui attach`). A raw tty read gives NO
 *     one-event-per-read guarantee: the kernel/libuv and the line discipline
 *     can split one reply across reads, coalesce several, or glue a reply to a
 *     keystroke. The whole-payload predicate would forward duplicates (or eat
 *     input) on those chunks, so the stripper isolates each VT sequence at its
 *     boundary, tests JUST that sequence, and drops only the matches — see its
 *     own doc comment below.
 *
 * INVARIANT (one answerer, or none): every sequence class this module
 * suppresses is in exactly one of two deliberate states —
 *
 *   1. ANSWERED by the headless server (DA1/DA2 · DSR/CPR · DECRPM · DECRQSS
 *      natively; XTVERSION via the hand-rolled handler in
 *      `pty-host/src/ptyHost.ts`) and forwarded to the PTY child. Dropping the
 *      mirroring client's duplicate is then safe: exactly one answerer.
 *   2. UNIFORMLY SILENT — the headless does NOT answer it (colour reports,
 *      window-size reports: it has no theme and no window) and the forwarder
 *      drops `ESC ]` regardless, so suppressing the browser's theme-derived
 *      reply keeps kolu's clients consistent with that silence. Programs
 *      querying these carry their own timeout fallbacks; consistent silence
 *      beats answers that differ per attached client.
 *
 * What must NEVER happen is a suppressed class the inner program needs that
 * lands in neither state. The table is pinned mechanically by the
 * "device-query contract" tests in `pty-host/src/ptyHost.test.ts` — extend
 * them before suppressing a new class here. The converse also holds — OSC 52
 * (clipboard) is NOT suppressed: only the browser can answer it (the headless
 * has no clipboard provider), so its reply must reach the PTY.
 */

// CSI responses, anchored to the whole payload:
//   DA1/DA2  CSI [?>=] Ps… c        e.g. ESC [ ? 1 ; 2 c
//   DSR      CSI Ps… n              e.g. ESC [ 0 n
//   CPR      CSI Ps ; Ps R          e.g. ESC [ 12 ; 40 R
//   DECRPM   CSI ? Ps ; Ps $ y      e.g. ESC [ ? 25 ; 1 $ y   (note the `$y`)
//   size     CSI Ps ; Ps ; Ps t     window/text-area reports — the one CSI
//            class on the "uniformly silent" arm: xterm answers CSI t only
//            with `windowOptions` enabled (off in both kolu terminals), so
//            this is defensive parity with the headless's silence, not a
//            duplicate-drop (pinned in ptyHost.test.ts).
const CSI_RESPONSE = /^\x1b\[[?>=]?[\d;]*(?:\$y|[cnRt])$/;

// OSC *colour* responses — NOT every OSC packet:
//   OSC 4 ; index ; rgb:… (BEL|ST)   palette colour report
//   OSC 10–19 ; rgb:… (BEL|ST)       dynamic colours (fg/bg/cursor/…)
// The "uniformly silent" arm of the invariant: the headless never answers
// colour queries (no theme — pinned in ptyHost.test.ts), so the browser's
// theme-derived reply isn't a duplicate, it's a per-client divergence —
// suppressed to keep kolu consistently silent here. Critically this does
// NOT match OSC 52 (clipboard): with `ClipboardAddon`/`SafeClipboardProvider`
// loaded, the OSC 52 *read* reply (`OSC 52 ; c ; <base64> …`) is generated
// only in the browser from the real system clipboard — the headless terminal
// has no clipboard provider and never answers it — so that reply must reach the
// PTY and is deliberately left forwarded.
const OSC_COLOUR_RESPONSE = /^\x1b\](?:4|1[0-9]);[\s\S]*?(?:\x07|\x1b\\)$/;

// DCS responses, anchored to the whole payload and to the response introducers
// xterm actually emits — NOT every `ESC P … ST` packet:
//   XTVERSION   ESC P > | text ST
//   DECRQSS     ESC P [01] $ r … ST   (valid/invalid setting reports)
// Sixel/DECUDK/etc. are program *output*, never keyboard input, and don't carry
// these introducers, so they stay forwarded.
//
// Both DCS classes sit on the ANSWERED arm of the invariant: DECRQSS the
// headless answers natively, XTVERSION via ptyHost.ts's explicit CSI `> q`
// handler (the load-bearing case — a TUI like Yazi blocks on it, and without
// the handler we'd drop the browser's reply while nothing else answered).
// Before adding a new suppressed class anywhere in this module, extend the
// device-query contract tests in `pty-host/src/ptyHost.test.ts` so the class
// is pinned to one arm — answered-and-forwarded, or uniformly silent.
const DCS_RESPONSE = /^\x1bP(?:>\||[01]\$r)[\s\S]*?\x1b\\$/;

/** True when `data` is a complete terminal-generated query response. */
export function isTerminalQueryResponse(data: string): boolean {
  return (
    CSI_RESPONSE.test(data) ||
    OSC_COLOUR_RESPONSE.test(data) ||
    DCS_RESPONSE.test(data)
  );
}

/**
 * The STREAMING form of the predicate, for the raw-tty path.
 *
 * `isTerminalQueryResponse` is a whole-payload predicate: it is correct only
 * when the caller already has one discrete source event per call (xterm's
 * `onData`). A raw tty read gives no such guarantee — Node/libuv and the line
 * discipline can split one reply across two reads, coalesce several replies
 * into one read, or sit a reply right up against a real keystroke. Feeding such
 * a chunk to the whole-payload predicate either forwards a duplicate reply (the
 * yazi escape-soup bug this whole module exists to kill) or, worse, drops real
 * input that happened to be glued to a reply.
 *
 * The stripper instead works at the escape-sequence boundary. It walks the byte
 * stream, isolating each complete VT control sequence (CSI / OSC / DCS — the
 * only shapes a query reply can take), tests JUST that sequence against the same
 * three response grammars above, drops it when it matches, and forwards
 * everything else (plain bytes, keystrokes, arrow-key CSIs, program-output
 * escapes) untouched and IN ORDER. Once a sequence's INTRODUCER is known (we've
 * seen `ESC [`, `ESC ]`, or `ESC P`) a partial tail is held and completed
 * against the next chunk, so a reply split across reads is reassembled before
 * it is judged.
 *
 * The one byte it will NOT hold across a chunk boundary is a *bare trailing
 * ESC* — an ESC whose introducer hasn't arrived yet. A lone ESC is far more
 * often the Escape key (or the start of an Alt-chord) than the first byte of a
 * reply that happened to split at exactly its second byte, and the inner
 * program does its own ESC-vs-Alt timeout on the byte's ARRIVAL at the PTY.
 * Buffering it until the next keystroke would merge `Esc` then `i` into `Alt-i`
 * and wreck interactive editors over the wire. So a trailing bare ESC is
 * forwarded at end-of-push; the cost is the (vanishingly rare) reply that
 * splits precisely between its ESC and its introducer, whose bytes then leak —
 * the pre-existing whole-chunk behaviour, no worse than before.
 *
 * Forwarding-on-no-match is the safe default throughout: only the three
 * response classes are ever suppressed, so the worst case for an unrecognised
 * escape is that it reaches the PTY (exactly what it would have done without
 * this filter).
 */
const ESC = 0x1b;
const BEL = 0x07;
const LBRACKET = 0x5b; // [
const RBRACKET = 0x5d; // ]
const P_UPPER = 0x50; // P (DCS)
const BACKSLASH = 0x5c; // \  (the ST in ESC \)

/** What kind of escape sequence the pending buffer is accumulating. */
type Pending =
  | { kind: "none" }
  /** Saw a bare ESC; the next byte decides CSI / OSC / DCS / short. Never held
   *  across a chunk boundary — a trailing bare ESC is forwarded at end-of-push
   *  (interactive-Escape latency beats catching a reply split at byte two). */
  | { kind: "esc" }
  /** ESC [ … — ends at the first final byte (0x40–0x7e). */
  | { kind: "csi" }
  /** ESC ] … or ESC P … — ends at BEL or ST (ESC \). `escSeen` tracks a
   *  half-typed ST so the terminating backslash is recognised across the pair. */
  | { kind: "string"; escSeen: boolean };

export interface TerminalResponseStripper {
  /**
   * Push raw input bytes; get back the bytes to forward to the PTY with every
   * complete query reply removed. Returns an empty buffer when the chunk
   * contained only (the start of) a reply. State carries across calls.
   */
  push(chunk: Buffer): Buffer;
}

export function createTerminalResponseStripper(): TerminalResponseStripper {
  // Bytes confirmed-forwardable, accumulated for this push() call.
  let out: number[] = [];
  // The escape sequence currently being isolated (may span chunks).
  let seq: number[] = [];
  let pending: Pending = { kind: "none" };

  // The isolated sequence is complete — decide its fate, then reset.
  const finishSequence = (): void => {
    const bytes = Buffer.from(seq);
    seq = [];
    pending = { kind: "none" };
    // latin1 is byte-exact for the all-ASCII response grammars.
    if (!isTerminalQueryResponse(bytes.toString("latin1"))) {
      for (const b of bytes) out.push(b);
    }
  };

  return {
    push(chunk: Buffer): Buffer {
      out = [];
      for (const b of chunk) {
        if (pending.kind === "none") {
          if (b === ESC) {
            pending = { kind: "esc" };
            seq.push(b);
          } else {
            out.push(b);
          }
          continue;
        }
        // We are inside a candidate escape sequence.
        seq.push(b);
        if (pending.kind === "esc") {
          if (b === LBRACKET) pending = { kind: "csi" };
          else if (b === RBRACKET || b === P_UPPER)
            pending = { kind: "string", escSeen: false };
          else {
            // ESC + anything else (Alt-key, ESC ESC, lone ESC \) is never a
            // suppressible reply — forward the pair as-is.
            finishSequence();
          }
          continue;
        }
        if (pending.kind === "csi") {
          // CSI ends at its final byte (0x40–0x7e). Params/intermediates
          // (0x20–0x3f) keep it open.
          if (b >= 0x40 && b <= 0x7e) finishSequence();
          continue;
        }
        // String sequence (OSC / DCS): BEL or ST (ESC \) terminates.
        if (b === BEL) {
          finishSequence();
        } else if (pending.escSeen) {
          if (b === BACKSLASH) finishSequence();
          else pending = { kind: "string", escSeen: false };
        } else if (b === ESC) {
          pending = { kind: "string", escSeen: true };
        }
      }
      // End of chunk. A bare trailing ESC (introducer still unknown) is NOT
      // held — forward it now so the inner program's Escape-vs-Alt timeout sees
      // it on time (see the doc comment). A partial sequence whose introducer
      // IS known stays buffered for the next chunk.
      if (pending.kind === "esc") {
        for (const b of seq) out.push(b);
        seq = [];
        pending = { kind: "none" };
      }
      return Buffer.from(out);
    },
  };
}
