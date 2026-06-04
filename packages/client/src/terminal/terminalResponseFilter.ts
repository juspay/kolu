/**
 * Filter terminal *query responses* out of xterm's `onData` before they reach
 * the PTY.
 *
 * The server runs a headless xterm that already answers device queries
 * (DA1/DA2, DSR/CPR, DECRQM, XTVERSION, window/colour reports, …). The
 * browser-side xterm answers them too, and those duplicate answers — arriving
 * late over the network — get echoed back into the PTY and printed as visible
 * garbage (the yazi/TUI escape-soup bug).
 *
 * `onData` fires once per discrete source event: a single keystroke, a single
 * paste, or a single terminal-generated response packet. A real keystroke and a
 * query response are therefore never coalesced into one chunk, so suppressing a
 * whole chunk that *is* a response cannot eat real input. To stay safe against
 * any future coalescing we still anchor every predicate to the full payload
 * (`^…$`) rather than matching a substring — a chunk that merely *contains* a
 * response-shaped sequence is left untouched and forwarded to the PTY.
 */

// CSI responses, anchored to the whole payload:
//   DA1/DA2  CSI [?>=] Ps… c        e.g. ESC [ ? 1 ; 2 c
//   DSR      CSI Ps… n              e.g. ESC [ 0 n
//   CPR      CSI Ps ; Ps R          e.g. ESC [ 12 ; 40 R
//   DECRPM   CSI ? Ps ; Ps $ y      e.g. ESC [ ? 25 ; 1 $ y   (note the `$y`)
//   size     CSI Ps ; Ps ; Ps t     window/text-area reports
const CSI_RESPONSE = /^\x1b\[[?>=]?[\d;]*(?:\$y|[cnRt])$/;

// OSC responses: ESC ] … (BEL | ST). Colour/clipboard query answers.
const OSC_RESPONSE = /^\x1b\][\s\S]*?(?:\x07|\x1b\\)$/;

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
    OSC_RESPONSE.test(data) ||
    DCS_RESPONSE.test(data)
  );
}
