/** The single canvas-surface precedence — which surface the workspace shows,
 *  and in what order. Collapses App.tsx's outer `<Show>` connecting-gate and
 *  the multi-arm `<Switch>` into one total, exclusive partition, so the
 *  precedence is named once.
 *
 *  The pure decision (type + arm order + payloads) lives in the dependency-free
 *  `resolveCanvasMode`; this module gathers the live facts AND owns the boot
 *  deadline (#1763): it reads the per-host episode anchor, feeds the ONE resolve an
 *  `{ exceeded }` verdict, and writes the frame's tag back — all in one memo
 *  evaluation (see `bootDeadline.ts`). It reads the ACTIVE entry's connection state
 *  (`padiMap.entry(activeHost()).state()`) to pick the discriminated {@link CanvasFacts}
 *  arm — the kaval-derived facts are gathered ONLY when the entry is `connected`
 *  (off any other host they'd be stale), which the discriminated union makes
 *  structural, not a convention.
 *
 *  Lives in `kaval/` beside `useDaemonStatus` (whose accessors it composes)
 *  and takes the session/terminal facts as injected accessors — mirroring
 *  `isWarming`/`refuseIfWarming` — so the module never imports `terminal/`
 *  (no kaval→terminal cycle). */

import { encodeHostKey } from "kolu-common/hostKey";
import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import {
  type CanvasFacts,
  type CanvasMode,
  resolveCanvasMode,
} from "./canvasModeResolver";
import { isConnectPhase } from "../host/connectCanvasCopy";
import { activeHost, connectionInfo, hostKeys, padiMap } from "../wire";
import { NO_LOG_LINES, type LogAbsence } from "../ui/logTailChrome";
import {
  bootDeadlineExceeded,
  pruneBootAnchors,
  recordBootFrame,
} from "./bootDeadline";
import { getMonotonicNow } from "../time/clock";
import {
  activeEntryState,
  daemonChannelLive,
  daemonStatusPending,
  daemonWarming,
  downState,
  isActiveHostLocal,
  localDaemonStatus,
} from "./useDaemonStatus";

export type { CanvasMode } from "./canvasModeResolver";

/** Resolve the canvas surface in strict precedence order. Reads the ACTIVE
 *  entry's connection state for the discriminant and the daemon accessors for
 *  the connected-arm facts; takes session-loading and terminal-count as injected
 *  accessors (a kaval module must not import `terminal/`). Gathers the live facts
 *  into the matching {@link CanvasFacts} arm, then runs the ONE boot-deadline-aware
 *  resolve and folds the frame into the per-host anchor. */
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
    isLocalHost: isActiveHostLocal(),
  };
  // The ACTIVE host's OWN connection cell — the SAME channel `ConnectCanvas` narrates off, so
  // the connect-overlay routing reads it too (no cross-channel skew). ONE read yields BOTH the
  // phase and the output tail: they are two fields of one cell frame, and the boot-stalled
  // card's connector arm shows them together. Fed ONLY into the not-yet-connected arms
  // (warming/not-a-member): the `connected` arm carries neither, so a stale/lagging cell can
  // never route the overlay over a connected host (A'). `connectionInfo()` is floored on the
  // map's transport liveness (C'), so a stale cell already demotes before it reaches here.
  // NARROW the phase to the framework's `ConnectPhase` (the narrated subset) at THIS boundary:
  // a `connected`/`disconnected`/`failed` cell phase is not a connect phase → `undefined` (no
  // overlay), so the resolver's arm can carry only a real connect phase and its routing is a
  // plain `!== undefined`.
  const info = connectionInfo();
  const phase = info?.phase;
  const connectPhase: ConnectPhase | undefined =
    phase !== undefined && isConnectPhase(phase) ? phase : undefined;
  // The tail, TOTAL, plus — separately — WHY it is empty when the cell handed us no frame
  // at all. This is the one site that holds both halves of that question: the cell read
  // above and `padiMap.live()`, the very liveness the map's floor applies. Two different
  // situations produce a missing cell — the floor DROPPED the live word because our link
  // to the publisher is dead, or no frame has landed yet — and only the first is a link
  // problem. Deciding it here means the boot-stalled card renders a reason it was TOLD;
  // it used to infer "kolu's link to this browser went quiet" from a bare `undefined`,
  // which was true only via a four-file chain no type expressed.
  const connectLog = info?.log ?? NO_LOG_LINES;
  const connectLogAbsence: LogAbsence | undefined =
    info === undefined && !padiMap.live() ? "link-down" : undefined;
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
        connectPhase,
        connectLog,
        connectLogAbsence,
      };
      break;
    case "failed":
      // The failed arm feeds the resolver the DISCRIMINANT only — the episode itself is read
      // by `failedEpisode` at the surfaces that show it (see its doc in `useDaemonStatus.ts`).
      facts = { ...liveness, entry: "failed" };
      break;
    case "not-a-member":
      facts = {
        ...liveness,
        entry: "not-a-member",
        connectPhase,
        connectLog,
        connectLogAbsence,
      };
      break;
    case "connected":
      facts = {
        ...liveness,
        entry: "connected",
        down: downState(),
        warming: daemonWarming(),
        daemonState: localDaemonStatus()?.state,
        terminalCount: deps.terminalCount(),
        recordsAwaited: deps.recordsAwaited(),
        channelLive: daemonChannelLive(),
      };
      break;
  }
  // The #1763 boot deadline, in ONE memo evaluation (C1): prune departed hosts' anchors,
  // read `exceeded` off the PRIOR frame's stored anchor, run the ONE resolve, then fold this
  // frame's tag back. `activeHost()` is always defined (even during the membership stall
  // where `activeScope()` is undefined), so the anchor keyed on it fixes Hole A structurally.
  // The monotonic tick makes this memo re-evaluate each second so a wedged overlay's elapsed
  // crosses its ceiling (the same 1s cadence the deleted daemon ceiling rode).
  const hostEnc = encodeHostKey(activeHost());
  const nowMs = getMonotonicNow()();
  // Prune departed hosts' anchors ONLY once membership has snapshotted (non-empty). An EMPTY
  // `hostKeys()` is the pre-snapshot warming window (`wire.ts`), NOT "every host left" —
  // `LOCAL_HOST` is the unremovable seed, so a LOADED membership always contains it (the same
  // `keys.length === 0` distinction `hostReconcileTarget` draws). Pruning on empty would delete
  // the active host's OWN anchor every tick during the membership stall (Hole A), reset its
  // elapsed to 0, and the ceiling could never fire — leaving "Connecting to local…" up forever.
  const members = hostKeys();
  if (members.length > 0) pruneBootAnchors(members.map(encodeHostKey));
  // The #1908 R8a campaign backstop: `bootDeadlineExceeded` folds the class ceiling AND the
  // class-blind campaign cell on the one monotonic `nowMs`; `recordBootFrame` arms the campaign
  // cell off the frame's own tag (the connector-owned `provisioning` leg). Both are pure client-
  // monotonic — no server `sinceMs` (frame-stamped + wall-clock). A user Retry connection resets
  // this host's deadline explicitly via `resetBootDeadline` (in the card), not read here.
  const exceeded = bootDeadlineExceeded(hostEnc, nowMs);
  const { mode, tag } = resolveCanvasMode(facts, { exceeded });
  recordBootFrame(hostEnc, tag, nowMs);
  return mode;
}
