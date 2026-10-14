/**
 * `@kolu/surface-remote` — run a typed `@kolu/surface` agent on a
 * remote machine over `ssh`, with Nix as the provisioning mechanism.
 *
 * See `README.md` for the conceptual overview. This module exports the
 * public API.
 */

export { type HostNix, resolveHostNix } from "./arch";
export {
  type AgentBinaryCache,
  agentBinaryCache,
  AgentBinaryCacheUnbakedError,
  type BakedDeclaration,
  readBakedDeclaration,
} from "./agentBinaryCache";
export {
  type AgentDerivation,
  directAgentDerivation,
} from "./agentDerivation";
export {
  type ClosureIndex,
  ClosureIndexError,
  type ClosureKey,
  type ClosureLookup,
  closureIndexUrl,
  type FetchText,
  type IndexedClosure,
  fetchClosureIndex,
  type PublishedClosure,
  readPublishedClosure,
} from "./closureIndex";
export {
  type ClosureRoute,
  closureRoute,
  type SignedBecause,
  signedBecause,
} from "./closureRoute";
export {
  AgentSourceUnbakedError,
  type AgentResolutionContext,
  readBakedAgentSource,
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
  nixSshOpts,
  ResolveDrvError,
  SSH_COMMON_OPTS,
  sshDialOpts,
  type SshDestination,
} from "./host";
export {
  DEFAULT_SSH_KEEPALIVE,
  MAX_SSH_KEEPALIVE_TOLERANCE_S,
  type SshKeepalive,
  sshKeepalive,
} from "./keepalive";
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
  homeGcRoot,
  makeProvisionBudgets,
  makeStepBudget,
  PROVISION_STEP_MAX_EXPIRIES,
  PROVISION_STEP_SILENCE_BASE_MS,
  type ProvisionBudgets,
  type ProvisionOptions,
  type ProvisionResult,
  provisionAgent,
  type PullClosureOptions,
  type PullClosureResult,
  pullClosure,
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
  isMiddleHopTransportLoss,
  type RelayedStream,
  type RelayHoldOpenOptions,
  type RelayPolicy,
  type RelayStreamOptions,
  RelayTransportLostError,
  relayFailThroughStream,
  relayHoldOpenStream,
  // The shape `RelayHoldOpenOptions.upstream.signal` demands. Exported so a
  // direct caller can name it rather than satisfy it with an inline literal.
  type UpstreamSignal,
  type ValueMembers,
} from "./relayStream";
export {
  type ReServedSurface,
  type ReServeSurfaceOptions,
  reServeSurface,
  UpstreamUnavailableError,
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
  // A connector's "nothing is serving there" verdict (thrown by `unixSocketConnector`),
  // so a consumer outside this package can test for it by class rather than by prose.
  EndpointAbsentError,
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
export {
  type UnixSocketConnectorOptions,
  unixSocketConnector,
} from "./unixSocketConnector";
export { type ClientCursor, makeClientCursor } from "./waitForNextClient";
