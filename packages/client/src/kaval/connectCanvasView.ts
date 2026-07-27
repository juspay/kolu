/** How many trailing `log` lines the live connect tail shows — a tail, not the whole Nix
 *  firehose (the reassurance is "named phase + real output + elapsed", not a scroll of every
 *  line). */
export const TAIL_LINES = 6;

/** The connect overlay renders from the frame's own DATA, never a per-phase show/hide flag.
 *  These are the two pure visibility predicates ConnectCanvas keys on — extracted so the
 *  "`probing` narrates its log the instant it arrives / no 0s flash on the brief handshake"
 *  behaviour is unit-pinnable without mounting a DOM. */

/** The last `lines` lines of a frame's `log` — the ONE "take a tail" rule every surface that
 *  shows raw host output calls, rather than re-spelling a `.slice(-n)` per site. A non-empty
 *  result renders the tail, so a `probing` frame's "<host>: checking for a cached agent…"
 *  shows immediately (no silent probing window); the pre-frame gap has an empty log, so it
 *  renders title-only BY CONSTRUCTION (data absence, not policy). Depth defaults to the
 *  connect overlay's {@link TAIL_LINES}; the host-diagnostics popover asks for a shallower
 *  one, because it is a popover and not a canvas. Generic in the line shape: the connect
 *  overlay hands it the wire's `LogEntry`, the failure surfaces the structural `LogLine`, and
 *  taking a tail cares about neither. */
export function tailOf<Line>(
  log: readonly Line[],
  lines: number = TAIL_LINES,
): readonly Line[] {
  return log.slice(-lines);
}

/** Whether the elapsed timer renders: only once the episode duration reaches 1s — so a
 *  dragging connect reads as abnormal, while the brief `connecting` handshake (and the
 *  pre-frame gap, where `elapsedMs` is `null`) never flashes a "0s" (the same 1s guard
 *  drishti's `withElapsed` uses). */
export function showsElapsed(elapsedMs: number | null): boolean {
  return elapsedMs !== null && elapsedMs >= 1000;
}
