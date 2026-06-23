/**
 * `@kolu/surface-nix-host` — run a typed `@kolu/surface` agent on a
 * remote machine over `ssh`, with Nix as the provisioning mechanism.
 *
 * See `README.md` for the conceptual overview. This module exports the
 * public API.
 */

export { resolveSystem } from "./arch";
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
  type HostEntry,
  type HostRegistry,
  type HostRegistryOptions,
  type LiveSpawnHolder,
  type ObservableHolder,
  observableHolder,
  type PumpRemoteSurfaceOptions,
  pumpRemoteSurface,
} from "./hostFanout";
export {
  type AgentClient,
  type ConnectionState,
  destroyAllSessions,
  evictHostSession,
  type FailureCause,
  getHostSession,
  HostSession,
  type HostSessionOptions,
  type HostSessionState,
} from "./hostSession";
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
export { type ClientCursor, makeClientCursor } from "./waitForNextClient";
