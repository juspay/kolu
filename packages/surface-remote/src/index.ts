/**
 * `@kolu/surface-remote` — run a typed `@kolu/surface` agent on a
 * remote machine over `ssh`, with Nix as the provisioning mechanism.
 *
 * See `README.md` for the conceptual overview. This module exports the
 * public API.
 */

export { resolveSystem } from "./arch";
// The connection-health cell + its node-side pump. The cell fragment
// (`connectionCell`, schema, default) is ALSO exported from the browser-safe
// `@kolu/surface-remote/connection` subpath — a surface composes it from
// there; node consumers (the pump) read it from the root.
// `ConnectionState` / `FailureCause` are re-exported below from `./session` —
// their single source now that `hostSession.ts` is gone (`./session` in turn
// re-exports them from `./connection` / `./host`). The root surfaces only the
// NODE-side pump + the `ConnectionInfo`
// it produces; the browser-safe cell members (`connectionCell`, schema,
// `CONNECTION_STATES`, …) live solely on the `@kolu/surface-remote/connection`
// subpath, which is where a surface composes them.
export type { ConnectionInfo } from "./connection";
export {
  pipeSessionStateToCell,
  projectConnection,
  seedConnectionCell,
} from "./connectionPipe";
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
  type ProvisionOptions,
  type ProvisionResult,
  provisionAgent,
} from "./nixCopy";
export {
  type CaptureResult,
  type ExitResult,
  runCapture,
  runProgress,
} from "./process";
export {
  type DeltaMembers,
  type ForwardableStream,
  NoLiveUpstreamError,
  type RelayHoldOpenOptions,
  type RelayPolicy,
  type RelayStreamOptions,
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
} from "./serveHostMap";
export {
  type Admit,
  type AdmitRefusal,
  type AdmitVerdict,
  type ClosedInfo,
  type ConnectContext,
  ConnectError,
  type Connection,
  type ConnectionState,
  type Connector,
  type DestroyableSession,
  type FailureCause,
  type MakeSessionOptions,
  makeSession,
  type Session,
  type SessionState,
  surfaceLiveProbe,
} from "./session";
export {
  type AgentClient,
  type SshConnectorOptions,
  sshConnector,
} from "./sshConnector";
export { type ClientCursor, makeClientCursor } from "./waitForNextClient";
