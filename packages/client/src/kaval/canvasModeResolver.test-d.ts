import type { DaemonState } from "@kolu/padi-client/surface";
import type { CanvasFacts } from "./canvasModeResolver";

const liveness = {
  isLoading: false,
  daemonPending: false,
  isLocalHost: true,
};

const daemonState: DaemonState = "connected";

const connected: CanvasFacts = {
  ...liveness,
  entry: "connected",
  down: undefined,
  warming: false,
  daemonState,
  terminalCount: 1,
  recordsAwaited: 0,
  channelLive: true,
};
void connected;
void (connected.entry === "connected" ? connected.daemonState : undefined);

const connectedWithPhase: CanvasFacts = {
  ...liveness,
  entry: "connected",
  down: undefined,
  warming: false,
  daemonState,
  terminalCount: 1,
  recordsAwaited: 0,
  channelLive: true,
  // @ts-expect-error
  connectPhase: "provisioning",
};
void connectedWithPhase;

const connectedArm: Extract<CanvasFacts, { entry: "connected" }> = {
  ...liveness,
  entry: "connected",
  down: undefined,
  warming: false,
  daemonState,
  terminalCount: 1,
  recordsAwaited: 0,
  channelLive: true,
};
// @ts-expect-error
void connectedArm.connectPhase;

const warming: CanvasFacts = {
  ...liveness,
  entry: "warming",
  connectPhase: "provisioning",
  // @ts-expect-error
  daemonState,
};
void warming;
void (warming.entry === "warming" ? warming.connectPhase : undefined);

const warmingBadPhase: CanvasFacts = {
  ...liveness,
  entry: "warming",
  // @ts-expect-error
  connectPhase: "banana",
};
void warmingBadPhase;

const warmingConnectedPhase: CanvasFacts = {
  ...liveness,
  entry: "warming",
  // @ts-expect-error
  connectPhase: "connected",
};
void warmingConnectedPhase;

const failed: CanvasFacts = {
  ...liveness,
  entry: "failed",
  // @ts-expect-error
  down: "dead",
};
void failed;

const failedArm: Extract<CanvasFacts, { entry: "failed" }> = {
  ...liveness,
  entry: "failed",
};
// @ts-expect-error
void failedArm.daemonState;

const warmingArm: Extract<CanvasFacts, { entry: "warming" }> = {
  ...liveness,
  entry: "warming",
  connectPhase: undefined,
  connectLog: [],
  connectLogAbsence: undefined,
  connectQuiet: undefined,
};
// @ts-expect-error
void warmingArm.terminalCount;
