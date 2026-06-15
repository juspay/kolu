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

/** The contract-typed pty-host client — `ContractRouterClient<contract,
 *  ClientRetryPluginContext>`. Identical whether the link is a local unix socket
 *  (`unixSocketLink`) or an ssh stdio child (`getHostSession` → `stdioLink`), so
 *  one client type backs both transports. */
export type PtyTuiClient = UnixSocketConnection<
  typeof ptyHostSurface.contract
>["client"];

/** A live pty-host connection: the client plus a `dispose` that tears the
 *  transport down. Both the local socket path (`connectPtyHost`) and the ssh
 *  `--host` path (`connectPtyHostViaHost`) return this shape, so every `cmd*()`
 *  is transport-blind — written against it once over either transport. This is
 *  the kaval-tui CLI's shape: a one-shot dialer needs only the client and a
 *  teardown. A long-lived consumer (kolu-server, P3) that wants the session's
 *  `onState`/`markConnected` seam composes its own `Connection` variant carrying
 *  `session` (as mini-ci's dialer does) — it does NOT reuse this `{ client,
 *  dispose }`. */
export interface Connection {
  client: PtyTuiClient;
  dispose: () => void;
}

/** Connect to the pty-host at `socketPath`. Rejects with the raw socket error
 *  (`ECONNREFUSED` for a dead/absent server, `ENOENT` for a missing path) so
 *  the caller can print an honest, actionable message. */
export function connectPtyHost(socketPath: string): Promise<Connection> {
  return unixSocketLink<typeof ptyHostSurface.contract>({ socketPath });
}
