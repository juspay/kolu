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
 * INVARIANT (client-suppressed ⇒ server-answered): every sequence class this
 * module suppresses MUST be answered by the headless server, or a TUI that
 * blocks on the query hangs forever (we drop the browser's reply and nothing
 * else replies). This is the reciprocal of the forwarding decision in
 * `pty-host/src/ptyHost.ts`: the headless `onData` forwarder relays the
 * server's own query answers, and its XTVERSION handler exists precisely
 * because the headless xterm has no built-in answerer for that one class. The
 * converse also holds — OSC 52 (clipboard) is NOT in the headless-answered set
 * (the headless terminal has no clipboard provider), so it is deliberately left
 * forwarded here rather than suppressed. Keep the two sides in step: before
 * suppressing a new class here, confirm the headless server answers it.
 */

// CSI responses, anchored to the whole payload:
//   DA1/DA2  CSI [?>=] Ps… c        e.g. ESC [ ? 1 ; 2 c
//   DSR      CSI Ps… n              e.g. ESC [ 0 n
//   CPR      CSI Ps ; Ps R          e.g. ESC [ 12 ; 40 R
//   DECRPM   CSI ? Ps ; Ps $ y      e.g. ESC [ ? 25 ; 1 $ y   (note the `$y`)
//   size     CSI Ps ; Ps ; Ps t     window/text-area reports
const CSI_RESPONSE = /^\x1b\[[?>=]?[\d;]*(?:\$y|[cnRt])$/;

// OSC *colour* responses, anchored to the colour report classes the headless
// server actually answers — NOT every OSC packet:
//   OSC 4 ; index ; rgb:… (BEL|ST)   palette colour report
//   OSC 10–19 ; rgb:… (BEL|ST)       dynamic colours (fg/bg/cursor/…)
// These are the only OSC replies the browser xterm synthesises that duplicate a
// headless-side answer, so they're the garbage we drop. Critically this does
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
// INVARIANT: any response class suppressed here MUST be answered by the headless
// server, or a TUI that blocks on the query (e.g. Yazi waiting on XTVERSION)
// hangs forever — we drop the browser's reply and nothing else replies. XTVERSION
// is the load-bearing case: ptyHost.ts registers an explicit CSI `> q` handler
// precisely because the headless xterm has no built-in answerer. Before adding a
// new suppressed class here, confirm the headless server answers it (or document
// why it must NOT, like the browser-only OSC 52 clipboard reply above).
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
