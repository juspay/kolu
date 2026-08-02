/**
 * Unix-socket link — the local-IPC leg of the link family (`websocketLink` for
 * browsers, `stdioLink` for subprocess/ssh, `directLink` in-process, this one
 * for a local daemon). Dials the path, then hands the connected `net.Socket`
 * (already a `Duplex`) to the SAME `duplexWireLink` the stdio leg uses — so
 * both ends speak byte-identical ndjson, which is what makes a daemon's
 * contract-blind stdio↔socket byte splice legal (review #10).
 *
 * Unlike the browser leg this one DIALS: connecting is the link's job here, and
 * a dial failure is the caller's "nothing is serving that path" answer (every
 * daemon probe in the tree — supervisor convergence, the CLI's daemon
 * discovery, the upgrade-window harness — reads it that way). So the dial is
 * explicit and EAGER rather than folded into `NodeSocket.layerNet`, whose
 * socket is acquired lazily per protocol run: a lazy dial would resolve this
 * function for a dead path and only fail at the first call, turning "is the
 * daemon up?" from a connect verdict into a request timeout.
 *
 * No reconnect, like `stdioLink`: the link dies with the socket; callers that
 * need reconnect dial a fresh one.
 */

import { createConnection, type Socket } from "node:net";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { duplexWireLink } from "./stdio";
import type { WireLink } from "./wire";

export interface UnixSocketLinkOptions {
  /** The served surface's flat `RpcGroup` (`surface.group`). */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Path of the unix socket `serveOverUnixSocket` bound. */
  readonly socketPath: string;
}

/** Dial `socketPath` and open a link over the connected socket. Rejects with
 *  the raw socket error (`ECONNREFUSED` for a dead/absent server, `ENOENT` for
 *  a missing path) so the caller can print an honest, actionable message — and
 *  so a probe can tell "nobody is serving" from "the server said no". */
export function unixSocketLink(opts: UnixSocketLinkOptions): Promise<WireLink> {
  return new Promise<WireLink>((resolve, reject) => {
    const socket: Socket = createConnection(opts.socketPath);
    socket.once("connect", () => {
      socket.removeListener("error", reject);
      resolve(
        duplexWireLink({
          group: opts.group,
          duplex: socket,
          describe: `unix socket ${opts.socketPath}`,
        }),
      );
    });
    socket.once("error", reject);
  });
}
