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
 * yazi/TUI escape-soup bug). Both clients run their input through this one
 * predicate, so the suppressed set can never drift between them.
 *
 * The input event fires once per discrete source event (xterm's `onData`; a
 * raw tty read returning one terminal-generated reply per kernel write): a
 * single keystroke, a single paste, or a single response packet. A real
 * keystroke and a
 * query response are therefore never coalesced into one chunk, so suppressing a
 * whole chunk that *is* a response cannot eat real input. To stay safe against
 * any future coalescing we still anchor every predicate to the full payload
 * (`^…$`) rather than matching a substring — a chunk that merely *contains* a
 * response-shaped sequence is left untouched and forwarded to the PTY.
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
