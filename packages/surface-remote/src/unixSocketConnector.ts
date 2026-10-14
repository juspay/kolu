/**
 * `unixSocketConnector` — the unix-domain-socket transport plug for
 * {@link makeSession}.
 *
 * A session over this connector reaches a daemon that is ALREADY listening on a
 * path on this box; it never provisions anything (`Prov = never`, so the
 * session opens at `connecting`). What it adds over a bare link is the one fact
 * a session cannot derive for itself: the difference between "nothing is
 * serving this path" — a quiet, legitimate steady state, published as the
 * session's `absent` arm — and "the dial genuinely failed". A unix `connect(2)`
 * is the only dial that can TELL (see {@link EndpointAbsentError}), so the
 * classification lives here and nowhere downstream.
 */

import { type Socket, Socket as NetSocket } from "node:net";
import type { Rpc, RpcGroup } from "effect/rpc";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { socketDuplexLink } from "@kolu/surface/links/stdio";
import type { WireLink } from "@kolu/surface/links/wire";
import {
  type ClosedInfo,
  ConnectError,
  type Connection,
  type Connector,
  EndpointAbsentError,
  surfaceLiveProbe,
} from "./session";

export interface UnixSocketConnectorOptions<Client> {
  /** A THUNK, re-read on every dial — a daemon's socket path is derived from its
   *  environment, and a connector that captured it once would dial a stale path. */
  socketPath: () => string;
  /** The surface group the link speaks. */
  group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Build the typed face over the link's dispatch — one cast, at the consumer. */
  client: (dispatch: SurfaceDispatch) => Client;
  /** What a log line calls this endpoint. */
  describe: string;
}

/** True only for the two codes that mean "nobody is serving this path":
 *  `ENOENT` (no socket file at all) and `ECONNREFUSED` (a stale file nobody is
 *  bound to). The code can ride on the error or on its `cause` depending on who
 *  wrapped it, so both are read. Every OTHER code is a real failure and must not
 *  collapse into absence — a permissions `EACCES` on the path is a defect to
 *  surface, not a daemon that happens to be down. */
function isAbsentError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e?.code ?? e?.cause?.code;
  return code === "ENOENT" || code === "ECONNREFUSED";
}

/** Dial `socketPath`, settling once: the CONNECTED socket, or the raw socket
 *  error.
 *
 *  The socket is constructed and its listeners attached BEFORE `connect()` is
 *  called, rather than through `net.createConnection`, for one reason: a unix
 *  `connect(2)` that fails outright (a missing path) can emit its `error`
 *  SYNCHRONOUSLY inside the connect call on Bun. With `createConnection` there
 *  is no instant at which to attach a listener ahead of that emit — an `error`
 *  with no listener is a hard process crash, not a rejection anyone can catch.
 *
 *  The losing listener is removed on settle so a late `error` after a `connect`
 *  cannot fire a stray rejection, and an ABORTED dial destroys the socket here:
 *  nobody will ever be handed it to close. */
function dialUnixSocket(
  socketPath: string,
  signal: AbortSignal,
): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = new NetSocket();
    let settled = false;
    const finish = (): void => {
      settled = true;
      socket.removeListener("connect", onConnect);
      socket.removeListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onConnect = (): void => {
      finish();
      resolve(socket);
    };
    const onError = (err: Error): void => {
      finish();
      socket.destroy();
      reject(err);
    };
    const onAbort = (): void => {
      if (settled) return;
      finish();
      socket.destroy();
      reject(
        new ConnectError(
          `dial of ${socketPath} aborted before it connected`,
          "network",
        ),
      );
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    socket.connect(socketPath);
  });
}

/** Build a unix-socket {@link Connector}. Each dial re-reads
 *  {@link UnixSocketConnectorOptions.socketPath}, connects, and opens ONE link
 *  over the socket it owns — so the socket's `close` is the connection's
 *  `closed`. An absent listener rejects with {@link EndpointAbsentError}; every
 *  other dial or link failure is an ordinary `network` {@link ConnectError}. */
export function unixSocketConnector<Client>(
  opts: UnixSocketConnectorOptions<Client>,
): Connector<Client, never> {
  return async (ctx): Promise<Connection<Client>> => {
    const socketPath = opts.socketPath();

    let socket: Socket;
    try {
      socket = await dialUnixSocket(socketPath, ctx.signal);
    } catch (err) {
      if (isAbsentError(err)) {
        throw new EndpointAbsentError(
          `nothing is serving ${opts.describe} at ${socketPath}`,
        );
      }
      // An abort already carries its own classified rejection; anything else is
      // a dial that failed for a reason that is NOT absence.
      if (err instanceof ConnectError) throw err;
      throw new ConnectError(
        `dial of ${opts.describe} at ${socketPath} failed: ${String(err)}`,
        "network",
      );
    }

    // The socket is BOTH halves, which is what keeps its `close` event
    // observable to `closed` below — the whole reason this is `socketDuplexLink`
    // over an owned socket rather than `unixSocketLink`, which dials its own
    // socket and gives no such signal.
    let link: WireLink;
    try {
      link = await socketDuplexLink({
        group: opts.group,
        socket,
        describe: `unix socket ${socketPath}`,
      });
    } catch (err) {
      socket.destroy();
      throw new ConnectError(
        `link over ${opts.describe} at ${socketPath} failed to open: ${String(err)}`,
        "network",
      );
    }

    // Subscribed BEFORE the connector returns, so a socket that dies between the
    // link opening and the session awaiting `closed` is still observed. It
    // RESOLVES (never rejects): a dead endpoint is a fact the loop acts on, not
    // an exception it has to catch.
    const closed = new Promise<ClosedInfo>((resolve) => {
      socket.once("close", () => resolve({ kind: "endpoint-down" }));
    });

    const client = opts.client(link.dispatch);
    ctx.connecting();

    let torn = false;
    return {
      client,
      dispatch: link.dispatch,
      closed,
      isAlive: surfaceLiveProbe(client),
      teardown: () => {
        // Idempotent, because the session force-tears down on paths that can
        // overlap (recheck, destroy, connect timeout). `dispose()` is the ONLY
        // thing that frees the link's dial/ping/response fibers — destroying the
        // socket alone leaks one set per dial — and it destroys the socket
        // itself, so the close event still arrives and `closed` still settles.
        if (torn) return;
        torn = true;
        void link.dispose();
      },
    };
  };
}
