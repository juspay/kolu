/** The single canvas-surface precedence — which surface the workspace shows,
 *  and in what order. Collapses App.tsx's outer `<Show>` connecting-gate and
 *  the four-arm `<Switch>` into one total, exclusive partition, so the
 *  precedence is named once and unit-testable without rendering.
 *
 *  The arm ORDER is load-bearing correctness, not cosmetics:
 *    - `down` beats `empty` so a dead/degraded kaval never masquerades as
 *      "you have no terminals" — the #1034 empty-canvas lie.
 *    - `warming` beats `empty` so a restart's `drain` (which empties the
 *      terminal list) shows the neutral warming surface, not EmptyState with
 *      its enabled Restore / new-terminal affordances — a fast click there
 *      would spawn/restore into the daemon the recycle is about to kill
 *      (terminal creation must wait for `connected`, F3).
 *
 *  Lives in `kaval/` beside `useDaemonStatus` (whose accessors it composes)
 *  and takes the session/terminal facts as injected accessors — mirroring
 *  `isWarming`/`refuseIfWarming` — so the module never imports `terminal/`
 *  (no kaval→terminal cycle). */

import type { DaemonState } from "kolu-common/surface";
import {
  daemonStatusPending,
  daemonWarming,
  downState,
  localDaemonStatus,
  warmingCanvasLabel,
} from "./useDaemonStatus";

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

/** Resolve the canvas surface in strict precedence order. Reads the daemon
 *  accessors directly; takes session-loading and terminal-count as injected
 *  accessors (a kaval module must not import `terminal/`). */
export function canvasMode(deps: {
  isLoading: () => boolean;
  terminalCount: () => number;
}): CanvasMode {
  // Neutral "connecting" until BOTH the session cell AND the daemon-status
  // stream have produced their first value. Gating on daemon-status-pending
  // (not just `downState()`, which is undefined while pending) stops a `dead`
  // boot from flashing the normal empty workspace before the degraded surface
  // takes over (#1034).
  if (deps.isLoading() || daemonStatusPending()) return { kind: "connecting" };
  const down = downState();
  if (down) return { kind: "down", state: down };
  if (daemonWarming())
    return {
      kind: "warming",
      label: warmingCanvasLabel(),
      daemonState: localDaemonStatus()?.state,
    };
  if (deps.terminalCount() === 0) return { kind: "empty" };
  return { kind: "workspace" };
}
