/** The single canvas-surface precedence — which surface the workspace shows,
 *  and in what order. Collapses App.tsx's outer `<Show>` connecting-gate and
 *  the multi-arm `<Switch>` into one total, exclusive partition, so the
 *  precedence is named once.
 *
 *  The pure decision (type + arm order + payloads) lives in the dependency-free
 *  `canvasModeResolver` so it stays unit-testable without mounting the
 *  daemon-status subscription; this module only gathers the live facts. It reads
 *  the ACTIVE entry's connection state (`padiMap.entry(activeHost()).state()`) to
 *  pick the discriminated {@link CanvasFacts} arm — the kaval-derived facts are
 *  gathered ONLY when the entry is `connected` (off any other host they'd be
 *  stale), which the discriminated union makes structural, not a convention.
 *
 *  Lives in `kaval/` beside `useDaemonStatus` (whose accessors it composes)
 *  and takes the session/terminal facts as injected accessors — mirroring
 *  `isWarming`/`refuseIfWarming` — so the module never imports `terminal/`
 *  (no kaval→terminal cycle). */

import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import {
  type CanvasFacts,
  type CanvasMode,
  resolveCanvasMode,
} from "./canvasModeResolver";
import { isConnectPhase } from "./connectCanvasCopy";
import { connectionInfo } from "../wire";
import {
  activeEntryState,
  daemonChannelLive,
  daemonStatusPending,
  daemonStatusPendingTimedOut,
  daemonWarming,
  downState,
  isActiveHostLocal,
  localDaemonStatus,
  warmingCanvasLabel,
} from "./useDaemonStatus";

export type { CanvasMode } from "./canvasModeResolver";

/** Resolve the canvas surface in strict precedence order. Reads the ACTIVE
 *  entry's connection state for the discriminant and the daemon accessors for
 *  the connected-arm facts; takes session-loading and terminal-count as injected
 *  accessors (a kaval module must not import `terminal/`). Gathers the live facts
 *  into the matching {@link CanvasFacts} arm and delegates the decision to the
 *  pure {@link resolveCanvasMode}. */
export function canvasMode(deps: {
  isLoading: () => boolean;
  terminalCount: () => number;
  recordsAwaited: () => number;
}): CanvasMode {
  // Facts every arm carries — the loading guard reads only these, before the
  // entry-state switch ever consults an arm.
  const liveness = {
    isLoading: deps.isLoading(),
    daemonPending: daemonStatusPending(),
    pendingTimedOut: daemonStatusPendingTimedOut(),
    isLocalHost: isActiveHostLocal(),
  };
  // The ACTIVE host's OWN connection-cell phase — the SAME channel `ConnectCanvas`
  // narrates off, so the connect-overlay routing reads it too (no cross-channel skew). Fed
  // ONLY into the not-yet-connected arms (warming/not-a-member): the `connected` arm carries
  // no `connectPhase`, so a stale/lagging cell can never route the overlay over a connected
  // host (A'). `connectionInfo()` is floored on the map's transport liveness (C'), so a
  // stale cell already demotes before it reaches here. NARROW to the framework's `ConnectPhase`
  // (the narrated subset) at THIS boundary: a `connected`/`disconnected`/`failed` cell phase is
  // not a connect phase → `undefined` (no overlay), so the resolver's arm can carry only a real
  // connect phase and its routing is a plain `!== undefined`.
  const phase = connectionInfo()?.phase;
  const connectPhase: ConnectPhase | undefined =
    phase !== undefined && isConnectPhase(phase) ? phase : undefined;
  // The active entry's connection state is the discriminant. A non-`connected`
  // host's re-served daemonStatus is frozen stale, so the kaval-derived facts are
  // gathered ONLY on the `connected` arm.
  const state = activeEntryState();
  let facts: CanvasFacts;
  switch (state.kind) {
    case "warming":
      facts = {
        ...liveness,
        entry: "warming",
        warmingLabel: warmingCanvasLabel(),
        connectPhase,
      };
      break;
    case "failed":
      facts = {
        ...liveness,
        entry: "failed",
        cause: state.cause,
        reason: state.reason,
      };
      break;
    case "not-a-member":
      facts = { ...liveness, entry: "not-a-member", connectPhase };
      break;
    case "connected":
      facts = {
        ...liveness,
        entry: "connected",
        down: downState(),
        warming: daemonWarming(),
        warmingLabel: warmingCanvasLabel(),
        daemonState: localDaemonStatus()?.state,
        terminalCount: deps.terminalCount(),
        recordsAwaited: deps.recordsAwaited(),
        channelLive: daemonChannelLive(),
      };
      break;
  }
  return resolveCanvasMode(facts);
}
