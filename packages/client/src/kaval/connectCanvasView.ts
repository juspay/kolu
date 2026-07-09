import type { ConnectionInfo } from "kolu-common/surfacesWithPadi";

/** How many trailing `log` lines the live connect tail shows — a tail, not the whole Nix
 *  firehose (the reassurance is "named phase + real output + elapsed", not a scroll of every
 *  line). */
export const TAIL_LINES = 6;

/** The connect overlay renders from the frame's own DATA, never a per-phase show/hide flag.
 *  These are the two pure visibility predicates ConnectCanvas keys on — extracted so the
 *  "`probing` narrates its log the instant it arrives / no 0s flash on the brief handshake"
 *  behaviour is unit-pinnable without mounting a DOM. */

/** The live log tail — the last {@link TAIL_LINES} lines of the frame's `log`. A non-empty
 *  result renders the tail, so a `probing` frame's "<host>: checking for a cached agent…"
 *  shows immediately (no silent probing window); the pre-frame gap has an empty log, so it
 *  renders title-only BY CONSTRUCTION (data absence, not policy). */
export function tailOf(log: ConnectionInfo["log"]): ConnectionInfo["log"] {
  return log.slice(-TAIL_LINES);
}

/** Whether the elapsed timer renders: only once the episode duration reaches 1s — so a
 *  dragging connect reads as abnormal, while the brief `connecting` handshake (and the
 *  pre-frame gap, where `elapsedMs` is `null`) never flashes a "0s" (the same 1s guard
 *  drishti's `withElapsed` uses). */
export function showsElapsed(elapsedMs: number | null): boolean {
  return elapsedMs !== null && elapsedMs >= 1000;
}
