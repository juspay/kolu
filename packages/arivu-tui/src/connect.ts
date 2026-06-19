/**
 * Dial an `arivu` daemon over its unix socket and hand back a contract-typed
 * client for the awareness surface. The transport is `unixSocketLink` — the
 * local-IPC member of `@kolu/surface`'s link family, the same one kaval-tui
 * uses for the pty-host. A future `--host <ssh>` (P2) swaps only the link
 * (`getHostSession` → stdio over `arivu --stdio`); every command is written
 * against `Connection`, so it stays transport-blind.
 */

import type { arivuSurface } from "@kolu/arivu-contract";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";

/** The contract-typed awareness client — identical whatever link backs it. */
export type ArivuClient = UnixSocketConnection<
  typeof arivuSurface.contract
>["client"];

/** A live arivu connection: the client plus a `dispose` that tears the
 *  transport down. */
export interface Connection {
  client: ArivuClient;
  dispose: () => void;
}

/** Connect to the arivu daemon at `socketPath`. Rejects with the raw socket
 *  error (`ECONNREFUSED` for a dead/absent daemon, `ENOENT` for a missing
 *  path) so the caller can print an honest, actionable message. */
export function connectArivu(socketPath: string): Promise<Connection> {
  return unixSocketLink<typeof arivuSurface.contract>({ socketPath });
}
