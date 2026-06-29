/**
 * Dial a supervised daemon's unix socket and assemble the {@link DaemonConnection}
 * the endpoint holds — the ONE place that owns the dial → close-forwarding shape.
 *
 * Every `connect()` a host injects into `createEndpoint` shares the same plumbing:
 * `dialSocket` the path, build a contract client over the socket, run an optional
 * handshake for `{ identity, startedAt }`, and return a `DaemonConnection` whose
 * `onClose` forwards the socket's `close` (latching it so a callback registered
 * AFTER the socket already closed still fires, via `queueMicrotask`). Only the
 * VALUES differ per daemon: how the client is built (which contract `stdioLink`
 * speaks) and whether there's a version handshake (kaval checks contract skew;
 * the ephemeral local pulam, spawned fresh from kolu's own build, can't skew, so
 * it has none → `identity: undefined`, `startedAt: now`). So those two are
 * injected; the close-forwarding and the `DaemonConnection` assembly live here,
 * not copied into each host's `connect`.
 *
 * `makeClient` is injected (rather than this owning `stdioLink`) so the spine
 * stays dep-minimal — it never imports `@kolu/surface` or an `@orpc` client; the
 * host supplies the transport-typed client, the spine owns only the socket
 * lifecycle it already owns through `dialSocket`.
 */

import type { Socket } from "node:net";
import { dialSocket } from "./dialSocket.ts";
import type { DaemonConnection } from "./endpoint.ts";

export interface DialDaemonConnectionOptions<C, I> {
  /** Build the contract client over the connected socket — e.g.
   *  `stdioLink<contract>({ read: socket, write: socket }) as C`. The spine never
   *  names the transport, so it stays free of a `@kolu/surface` / `@orpc` dep. */
  makeClient: (socket: Socket) => C;
  /** Optional handshake: read the daemon's identity/start time (and reject — a
   *  plain `Error`, or a typed `DaemonContractSkewError` for an incompatible
   *  survivor) BEFORE the connection is handed back. On a throw the socket is
   *  destroyed here and the error propagates. Omit it for a daemon that can't skew
   *  (the ephemeral local pulam): identity defaults to `undefined`, startedAt to
   *  now. */
  handshake?: (client: C) => Promise<{ identity: I; startedAt: number }>;
}

/** Dial `socketPath`, build the client, (optionally) handshake, and return the
 *  live {@link DaemonConnection}. Rejects with the raw socket error if the socket
 *  isn't up (the endpoint maps it to a retry / `dead`), or with the handshake's
 *  error on a failed/ skewed handshake. */
export async function dialDaemonConnection<C, I>(
  socketPath: string,
  opts: DialDaemonConnectionOptions<C, I>,
): Promise<DaemonConnection<C, I>> {
  const socket = await dialSocket(socketPath);
  const client = opts.makeClient(socket);

  let identity: I;
  let startedAt: number;
  if (opts.handshake) {
    try {
      ({ identity, startedAt } = await opts.handshake(client));
    } catch (err) {
      socket.destroy();
      throw err;
    }
  } else {
    // No handshake: an ephemeral, never-adopted daemon reports no identity, and
    // nothing compares its start time against a survivor's.
    identity = undefined as I;
    startedAt = Date.now();
  }

  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    client,
    identity,
    startedAt,
    dispose: () => socket.destroy(),
    onClose: (cb) => {
      if (closed) queueMicrotask(cb);
      else socket.once("close", cb);
    },
  };
}
