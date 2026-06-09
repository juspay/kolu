/**
 * Unix-socket link adapter — the client half of the local-IPC member of the
 * link family (`websocketLink` for browsers, `stdioLink` for subprocess/ssh,
 * `directLink` in-process, this one for a local daemon). Dials the path,
 * then hands the connected `net.Socket` (a Duplex — it IS the
 * `{ read, write }` stream pair) to `stdioLink`, so both ends speak the same
 * base64+newline framing as `serveOverUnixSocket` serves.
 *
 * Unlike its sync siblings this one is async — connecting is the link's job
 * here (the others are handed an already-open transport) — and it returns a
 * `dispose` alongside the client because it owns the socket it opened.
 * No reconnect, like `stdioLink`: the link dies with the socket; callers
 * that need reconnect dial a fresh one.
 */
import { createConnection, type Socket } from "node:net";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import { stdioLink } from "./stdio";

export interface UnixSocketConnection<C extends AnyContractRouter> {
  client: ContractRouterClient<C, ClientRetryPluginContext>;
  /** Close the socket — the link dies with it. */
  dispose(): void;
}

/** Connect a typed oRPC client to the unix socket at `socketPath`. Rejects
 *  with the raw socket error (`ECONNREFUSED` for a dead/absent server,
 *  `ENOENT` for a missing path) so the caller can print an honest,
 *  actionable message. */
export function unixSocketLink<C extends AnyContractRouter>(opts: {
  socketPath: string;
}): Promise<UnixSocketConnection<C>> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection(opts.socketPath);
    socket.once("connect", () => {
      socket.removeListener("error", reject);
      resolve({
        client: stdioLink<C>({ read: socket, write: socket }),
        dispose: () => socket.destroy(),
      });
    });
    socket.once("error", reject);
  });
}
