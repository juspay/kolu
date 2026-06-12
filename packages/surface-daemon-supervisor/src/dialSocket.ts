/**
 * The one place that knows how to win the unix-socket connect/error race.
 *
 * Dialing a freshly-opened `net.Socket` is a two-listener handshake — resolve
 * on `connect`, reject on `error`, and drop the loser so a late `error` after
 * a `connect` can't fire a stray rejection. That race showed up verbatim in two
 * spots: the endpoint's readiness probe (which throws the socket away once it
 * knows the daemon is up) and the caller's `connect` dialer (which keeps the
 * socket for the handshake). Both call this so the race lives at one site;
 * neither re-implements the listener pair.
 *
 * It resolves the *connected* socket and leaves it open — the probe destroys
 * it, the dialer adopts it. The error it rejects with is the raw socket error
 * (`ECONNREFUSED` for a dead/absent peer, `ENOENT` for a missing path) so the
 * caller can classify or surface it honestly.
 */
import { createConnection, type Socket } from "node:net";

/** Open a connection to the unix socket at `socketPath`, resolving the live
 *  socket on `connect` and rejecting with the raw socket error otherwise. The
 *  loser listener is removed so a post-resolve `error` cannot fire a stray
 *  rejection. The resolved socket is left open; the caller owns it. */
export function dialSocket(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.once("connect", () => {
      socket.removeListener("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}
