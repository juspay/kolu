/** The single canvas-surface precedence — which surface the workspace shows,
 *  and in what order. Collapses App.tsx's outer `<Show>` connecting-gate and
 *  the four-arm `<Switch>` into one total, exclusive partition, so the
 *  precedence is named once.
 *
 *  The pure decision (type + arm order + payloads) lives in the dependency-free
 *  `canvasModeResolver` so it stays unit-testable without mounting the
 *  daemon-status subscription; this module only gathers the live facts. The arm
 *  ORDER is load-bearing correctness — see `canvasModeResolver` for why `down`
 *  and `warming` each beat `empty`.
 *
 *  Lives in `kaval/` beside `useDaemonStatus` (whose accessors it composes)
 *  and takes the session/terminal facts as injected accessors — mirroring
 *  `isWarming`/`refuseIfWarming` — so the module never imports `terminal/`
 *  (no kaval→terminal cycle). */

import { type CanvasMode, resolveCanvasMode } from "./canvasModeResolver";
import {
  daemonStatusPending,
  daemonWarming,
  downState,
  localDaemonStatus,
  warmingCanvasLabel,
} from "./useDaemonStatus";

export type { CanvasMode } from "./canvasModeResolver";

/** Resolve the canvas surface in strict precedence order. Reads the daemon
 *  accessors directly; takes session-loading and terminal-count as injected
 *  accessors (a kaval module must not import `terminal/`). Gathers the live
 *  facts and delegates the decision to the pure {@link resolveCanvasMode}. */
export function canvasMode(deps: {
  isLoading: () => boolean;
  terminalCount: () => number;
}): CanvasMode {
  return resolveCanvasMode({
    isLoading: deps.isLoading(),
    daemonPending: daemonStatusPending(),
    down: downState(),
    warming: daemonWarming(),
    warmingLabel: warmingCanvasLabel(),
    daemonState: localDaemonStatus()?.state,
    terminalCount: deps.terminalCount(),
  });
}
