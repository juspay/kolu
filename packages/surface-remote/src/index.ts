/**
 * `@kolu/surface-remote` — run a typed `@kolu/surface` agent on a
 * remote machine over `ssh`, with Nix as the provisioning mechanism.
 *
 * See `README.md` for the conceptual overview. This module exports the
 * public API.
 */

export { resolveSystem } from "./arch";
export {
  AGENT_BINARY_CACHE_FILE,
  AgentBinaryCacheUnbakedError,
  AgentSourceUnbakedError,
  type AgentResolutionContext,
  readBakedAgentSource,
  readBakedBinaryCache,
  resolveBakedAgentDrv,
  SURFACE_AGENT_FLAKE_REF_ENV,
} from "./agentDrv";
// SR9 — one connection authority. Link health is no longer a per-host `connection`
// CELL (that second wire channel + its `pipeSessionStateToCell` pump + the
// `mirroredSurface`/`seedConnectionCell` seam are gone); it rides the host-map entry's
// fine `connection` payload, projected by `serveHostMap`. What survives on the root is
// the PURE, browser-safe leaf a consumer derives the word from the entry with —
// `projectConnection` + the `ConnectionInfo` type/schema — re-exported from the
// browser-safe `@kolu/surface-remote/connection` subpath (its honest home).
export type { ConnectionInfo, ConnectPhase } from "./connection";
export { projectConnection, sessionConnection } from "./connection";
export type {
  DaemonConvergence,
  DaemonSession,
  PreservationStrategy,
} from "./daemonSession";
export {
  type AgentDial,
  type DialAgentOnceOptions,
  dialAgentOnce,
} from "./dialAgentOnce";
export {
  buildAgentCommand,
  buildSshProbeCommand,
  forEachLine,
  isLocalHost,
  ResolveDrvError,
  SSH_COMMON_OPTS,
} from "./host";
export {
  buildRemotePool,
  type ClosableSocket,
  type LiveSpawnHolder,
  type ObservableHolder,
  observableHolder,
  type PoolControls,
  type PumpRemoteSurfaceOptions,
  pumpRemoteSurface,
  type RemoteEntry,
  type RemotePool,
  type RemotePoolControlOptions,
  type RemotePoolOptions,
} from "./hostFanout";
export {
  type AgentBinaryCache,
  type AgentDerivation,
  directAgentDerivation,
  makeProvisionBudgets,
  makeStepBudget,
  type ProvisionBudgets,
  type ProvisionOptions,
  type ProvisionResult,
  provisionAgent,
  type StepBudget,
} from "./nixCopy";
export {
  type CaptureResult,
  type ExitResult,
  type LifetimePolicy,
  type RunOptions,
  runCapture,
} from "./process";
export {
  type DeltaMembers,
  type ForwardableStream,
  type RelayHoldOpenOptions,
  type RelayPolicy,
  type RelayStreamOptions,
  RelayTransportLostError,
  relayFailThroughStream,
  relayHoldOpenStream,
  type ValueMembers,
} from "./relayStream";
export {
  type ReServedSurface,
  type ReServeSurfaceOptions,
  reServeSurface,
} from "./reServeSurface";
export {
  type MembershipPool,
  type ServeHostMapOptions,
  serveHostMap,
  UnclassifiedHostFailureError,
  UnclassifiedHostSessionError,
} from "./serveHostMap";
export {
  type Admit,
  type AdmitRefusal,
  type AdmitVerdict,
  type ClosedInfo,
  type ConnectContext,
  ConnectError,
  type Connection,
  type Connector,
  type DestroyableSession,
  // The DOWN arms (`disconnected`/`failed`) of `SessionState` — already the declared
  // param type of `ServeHostMapOptions.failureOf`, so a consumer implementing that
  // classifier can name what it receives.
  type DownSessionState,
  type MakeSessionOptions,
  makeSession,
  type Session,
  type SessionState,
  surfaceLiveProbe,
} from "./session";
export {
  type AgentClient,
  type ResolveDrvPathContext,
  type SshConnectorOptions,
  type SshProv,
  sshConnector,
} from "./sshConnector";
export { type ClientCursor, makeClientCursor } from "./waitForNextClient";
