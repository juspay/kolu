/**
 * Dial an `pulam` daemon over its unix socket and hand back a contract-typed
 * client for the awareness surface. The transport is `unixSocketLink` — the
 * local-IPC member of `@kolu/surface`'s link family, the same one kaval-tui
 * uses for the pty-host. The `--host <ssh>` path swaps only the link
 * (`dialAgentOnce` → stdio over `pulam --stdio`, see `hostConnect.ts`) and
 * returns this SAME `Connection`; every command is written against it, so it
 * stays transport-blind.
 */

import type { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";

/** The contract-typed awareness client — identical whatever link backs it. */
export type ArivuClient = UnixSocketConnection<
  typeof terminalWorkspaceSurface.contract
>["client"];

/** A live pulam connection: the client plus a `dispose` that tears the
 *  transport down. */
export interface Connection {
  client: ArivuClient;
  dispose: () => void;
}

/** Connect to the pulam daemon at `socketPath`. Rejects with the raw socket
 *  error (`ECONNREFUSED` for a dead/absent daemon, `ENOENT` for a missing
 *  path) so the caller can print an honest, actionable message. */
export function connectArivu(socketPath: string): Promise<Connection> {
  return unixSocketLink<typeof terminalWorkspaceSurface.contract>({
    socketPath,
  });
}
