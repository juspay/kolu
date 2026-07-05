/**
 * `@kolu/surface-nix-host` — run a typed `@kolu/surface` agent on a
 * remote machine over `ssh`, with Nix as the provisioning mechanism.
 *
 * See `README.md` for the conceptual overview. This module exports the
 * public API.
 */

export { resolveSystem } from "./arch";
// The connection-health cell + its node-side pump. The cell fragment
// (`connectionCell`, schema, default) is ALSO exported from the browser-safe
// `@kolu/surface-nix-host/connection` subpath — a surface composes it from
// there; node consumers (the pump) read it from the root.
// `ConnectionState` / `FailureCause` stay exported via `./hostSession` (which
// now re-exports them from `./connection`) — re-exporting here too would
// duplicate. The root surfaces only the NODE-side pump + the `ConnectionInfo`
// it produces; the browser-safe cell members (`connectionCell`, schema,
// `CONNECTION_STATES`, …) live solely on the `@kolu/surface-nix-host/connection`
// subpath, which is where a surface composes them.
export type { ConnectionInfo } from "./connection";
export {
  pipeSessionStateToCell,
  projectConnection,
  seedConnectionCell,
} from "./connectionPipe";
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
  buildHostRegistry,
  type ClosableSocket,
  type FleetControls,
  type HostEntry,
  type HostRegistry,
  type HostRegistryControlOptions,
  type HostRegistryOptions,
  type LiveSpawnHolder,
  type ObservableHolder,
  observableHolder,
  type PumpRemoteSurfaceOptions,
  pumpRemoteSurface,
} from "./hostFanout";
export type {
  DaemonConvergence,
  DaemonSession,
  PreservationStrategy,
} from "./daemonSession";
export {
  type Admit,
  type AdmitRefusal,
  type AdmitVerdict,
  type ClosedInfo,
  type ConnectContext,
  type Connection,
  ConnectError,
  type Connector,
  type ConnectionState,
  type DestroyableSession,
  type FailureCause,
  makeSession,
  type MakeSessionOptions,
  type Session,
  type SessionState,
  surfaceLiveProbe,
} from "./session";
export {
  type AgentClient,
  sshConnector,
  type SshConnectorOptions,
} from "./sshConnector";
export {
  type ProvisionOptions,
  type ProvisionResult,
  provisionAgent,
} from "./nixCopy";
export {
  type ReServedSurface,
  type ReServeSurfaceOptions,
  reServeSurface,
} from "./reServeSurface";
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
  type CaptureResult,
  type ExitResult,
  runCapture,
  runProgress,
} from "./process";
export { type ClientCursor, makeClientCursor } from "./waitForNextClient";
