/**
 * `@kolu/surface-nix-host` — run a typed `@kolu/surface` agent on a
 * remote machine over `ssh`, with Nix as the provisioning mechanism.
 *
 * See `README.md` for the conceptual overview. This module exports the
 * public API.
 */

export {
  buildAgentCommand,
  forEachLine,
  isLocalHost,
} from "./host";
export {
  type AgentClient,
  type ConnectionState,
  destroyAllSessions,
  getHostSession,
  HostSession,
  type HostSessionOptions,
  type HostSessionState,
} from "./hostSession";
export { mirrorRemoteCollection } from "./mirrorRemoteCollection";
export {
  type ProvisionOptions,
  type ProvisionResult,
  provisionAgent,
} from "./nixCopy";
export { waitForNextClient } from "./waitForNextClient";
