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
 * It succeeds with the *connected* socket and leaves it open — the probe
 * destroys it, the dialer adopts it. The error it fails with is the raw socket
 * error (`ECONNREFUSED` for a dead/absent peer, `ENOENT` for a missing path) so
 * the caller can classify or surface it honestly.
 */
import { createConnection, type Socket } from "node:net";
import { Effect } from "effect";

/** Open a connection to the unix socket at `socketPath`. Succeeds with the
 *  CONNECTED socket (left open; the caller owns it), fails with the raw socket
 *  error (`ECONNREFUSED` for a dead/absent peer, `ENOENT` for a missing path).
 *  The loser listener is removed so a post-settle `error` cannot fire a stray
 *  failure — and a dial INTERRUPTED before either listener fires destroys the
 *  half-open socket, because nobody will ever be handed it to close. (That last
 *  part is what a Promise-shaped dial could not express: a caller who stopped
 *  waiting simply abandoned the socket.) */
export function dialSocket(socketPath: string): Effect.Effect<Socket, Error> {
  return Effect.callback<Socket, Error>((resume) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const onConnect = (): void => {
      settled = true;
      socket.removeListener("error", onError);
      resume(Effect.succeed(socket));
    };
    const onError = (err: Error): void => {
      settled = true;
      socket.removeListener("connect", onConnect);
      resume(Effect.fail(err));
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
    return Effect.sync(() => {
      if (settled) return;
      socket.removeListener("connect", onConnect);
      socket.removeListener("error", onError);
      socket.destroy();
    });
  });
}
