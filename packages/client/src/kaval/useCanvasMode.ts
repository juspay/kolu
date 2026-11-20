import { encodeHostKey } from "kolu-common/hostKey";
import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import {
  type CanvasFacts,
  type CanvasMode,
  resolveCanvasMode,
} from "./canvasModeResolver";
import { isConnectPhase } from "../host/connectCanvasCopy";
import { activeHost, connectionInfo, hostKeys, padiMap } from "../wire";
import { NO_LOG_LINES } from "@kolu/solid-logtail";
import type { LogAbsence } from "./canvasModeResolver";
import {
  bootDeadlineExceeded,
  pruneBootAnchors,
  recordBootFrame,
  watchedBootIdentity,
} from "./bootDeadline";
import { getMonotonicNow } from "../time/clock";
import {
  connectTailQuiet,
  noteConnectTail,
  pruneConnectTails,
} from "./connectTailClock";
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

export function canvasMode(deps: {
  isLoading: () => boolean;
  terminalCount: () => number;
  recordsAwaited: () => number;
}): CanvasMode {
  const linkLive = padiMap.live();
  const liveness = {
    isLoading: deps.isLoading(),
    daemonPending: daemonStatusPending(),
    isLocalHost: isActiveHostLocal(),
  };
  const info = connectionInfo();
  const phase = info?.phase;
  const connectPhase: ConnectPhase | undefined =
    phase !== undefined && isConnectPhase(phase) ? phase : undefined;
  const connectLog = info?.log ?? NO_LOG_LINES;
  const connectLogAbsence: LogAbsence | undefined =
    info === undefined && !linkLive ? "link-down" : undefined;
  const hostEnc = encodeHostKey(activeHost());
  const nowMs = getMonotonicNow()();
  noteConnectTail(hostEnc, connectLog, nowMs);
  const connectQuiet = connectTailQuiet(hostEnc, nowMs);
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
        connectQuiet,
      };
      break;
    case "failed":
      facts = { ...liveness, entry: "failed" };
      break;
    case "not-a-member":
      facts = {
        ...liveness,
        entry: "not-a-member",
        connectPhase,
        connectLog,
        connectLogAbsence,
        connectQuiet,
      };
      break;
    case "unobservable":
      facts = {
        ...liveness,
        entry: "unobservable",
        connectPhase,
        connectLog,
        connectLogAbsence,
        connectQuiet,
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
  const members = hostKeys();
  if (members.length > 0) {
    const memberEncs = members.map(encodeHostKey);
    pruneBootAnchors(memberEncs);
    pruneConnectTails(memberEncs);
  }
  const exceeded = bootDeadlineExceeded(hostEnc, nowMs, linkLive);
  const { mode, tag } = resolveCanvasMode(facts, {
    transportLive: linkLive,
    exceeded,
    earnedBoot: watchedBootIdentity(hostEnc),
  });
  recordBootFrame(hostEnc, tag, nowMs);
  return mode;
}
