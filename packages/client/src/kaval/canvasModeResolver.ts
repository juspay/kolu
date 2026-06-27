/** The pure canvas-surface precedence — type + total resolver, with NO reactive
 *  or wire imports, so the load-bearing arm order is unit-testable in isolation
 *  (see `canvasModeResolver.test.ts`). `useCanvasMode.ts` gathers the live
 *  daemon/session facts and delegates the decision here; keeping the decision in
 *  its own dependency-free module is what lets the test import it without
 *  mounting the `daemonStatus` subscription (which drags in `../wire`).
 *
 *  The arm ORDER is correctness, not cosmetics:
 *    - `down` beats `empty` so a dead/degraded kaval never masquerades as
 *      "you have no terminals" — the #1034 empty-canvas lie.
 *    - `warming` beats `empty` so a restart's `drain` (which empties the
 *      terminal list) shows the neutral warming surface, not EmptyState with
 *      its enabled Restore / new-terminal affordances — a fast click there
 *      would spawn/restore into the daemon the recycle is about to kill
 *      (terminal creation must wait for `connected`). */

import type { DaemonState } from "kolu-common/surface";

/** Which canvas surface wins, with the payload each surface needs. Tagged so
 *  the down sub-state and the warming label travel WITH the choice — the
 *  renderer reads neither `downState()` nor `warmingCanvasLabel()` a second
 *  time. */
export type CanvasMode =
  | { kind: "connecting" }
  | { kind: "down"; state: "dead" | "degraded" }
  | { kind: "warming"; label: string; daemonState: DaemonState | undefined }
  | { kind: "empty" }
  | { kind: "workspace" };

/** The flat snapshot the precedence decision needs — every fact as a plain
 *  value, no accessors and no module reads. Separating this from the live
 *  accessors is what makes {@link resolveCanvasMode} a pure, exhaustively
 *  testable total function. */
export interface CanvasFacts {
  isLoading: boolean;
  daemonPending: boolean;
  down: "dead" | "degraded" | undefined;
  warming: boolean;
  warmingLabel: string;
  daemonState: DaemonState | undefined;
  terminalCount: number;
  /** The watchdog-backed liveness of the ws delivering daemonStatus. The `down`
   *  and `warming` facts arrive ALREADY floored on this at their source accessors
   *  (`downState`/`daemonWarming` → `liveDownState`/`liveWarming`); this fact floors
   *  the remaining daemon-derived claim — `empty` ("no terminals"), which the dead
   *  channel also can't confirm — so a dead/half-open link makes NO unconfirmable
   *  canvas claim (the #1568 SHAPE A class the rail dot already floors). */
  transportLive: boolean;
}

/** The pure precedence partition — total over {@link CanvasFacts}, exclusive,
 *  order load-bearing (see the module header). No reactive reads, so the whole
 *  #1034 / restart-drain precedence is unit-testable without mounting the
 *  daemon-status subscription. */
export function resolveCanvasMode(facts: CanvasFacts): CanvasMode {
  // Neutral "connecting" until BOTH the session cell AND the daemon-status
  // stream have produced their first value. Gating on daemon-status-pending
  // (not just `down`, which is undefined while pending) stops a `dead` boot
  // from flashing the normal empty workspace before the degraded surface takes
  // over (#1034).
  if (facts.isLoading || facts.daemonPending) return { kind: "connecting" };
  // `down` and `warming` arrive ALREADY floored on transport liveness (their source
  // accessors `downState`/`daemonWarming` return undefined/false when the link is
  // dead), so a stale daemon state never reaches these arms over a dead channel.
  if (facts.down) return { kind: "down", state: facts.down };
  if (facts.warming)
    return {
      kind: "warming",
      label: facts.warmingLabel,
      daemonState: facts.daemonState,
    };
  // "No terminals" is the remaining daemon-derived claim, and it too is
  // unconfirmable over a dead link — so gate `empty` on transport liveness. When the
  // link is not live, show the last-good workspace if any terminals are on screen,
  // else the neutral connecting surface — never a stale "no terminals" with active
  // Restore / new-terminal affordances. The post-grace TransportOverlay owns the
  // disconnect messaging.
  if (facts.transportLive && facts.terminalCount === 0) return { kind: "empty" };
  return facts.terminalCount > 0 ? { kind: "workspace" } : { kind: "connecting" };
}
