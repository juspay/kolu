/**
 * Dial the kolu-server pty-host over its unix socket and hand back a
 * contract-typed client. The transport is `unixSocketLink` — the local-IPC
 * member of `@kolu/surface`'s link family, same base64+newline framing the
 * in-server listener speaks (and the same link the ssh/daemon path will
 * reuse, swapping only the socket for a child's stdio). This module just
 * binds it to the `ptyHostSurface` contract.
 */
import type { ptyHostSurface } from "kaval";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";

export type Connection = UnixSocketConnection<typeof ptyHostSurface.contract>;
export type PtyTuiClient = Connection["client"];

/** Connect to the pty-host at `socketPath`. Rejects with the raw socket error
 *  (`ECONNREFUSED` for a dead/absent server, `ENOENT` for a missing path) so
 *  the caller can print an honest, actionable message. */
export function connectPtyHost(socketPath: string): Promise<Connection> {
  return unixSocketLink<typeof ptyHostSurface.contract>({ socketPath });
}
