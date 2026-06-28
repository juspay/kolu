/**
 * kolu's side of the local-`pulam` handshake — the `connect` the supervisor
 * endpoint is parameterized over, the awareness twin of `connect.ts` (kaval). It
 * dials pulam's unix socket and hands back a `DaemonConnection` the endpoint
 * holds and the mirror reads.
 *
 * Like `connectKaval`, it dials *directly* (`dialSocket` + `stdioLink`) rather
 * than through `unixSocketLink`, for the one thing the supervisor needs that the
 * link doesn't expose: the socket's **close event**. When pulam dies the
 * supervisor must learn it instantly (flip the endpoint to `degraded`, end the
 * mirror) without polling, so kolu owns the socket here and forwards its `close`
 * as `onClose`.
 *
 * Unlike kaval there is NO contract-version handshake: the local pulam is spawned
 * fresh from kolu's OWN build on every boot (it never survives kolu, never
 * adopts), so a contract skew between the two cannot arise — the socket-accepting
 * gate the supervisor already waits on before calling `connect` is the only
 * liveness check the ephemeral local mirror needs.
 */

import { stdioLink } from "@kolu/surface/links/stdio";
import {
  type DaemonConnection,
  dialSocket,
} from "@kolu/surface-daemon-supervisor";
import type { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";
import type { ContractRouterClient } from "@orpc/contract";

/** The awareness client kolu mirrors — a contract-typed `terminalWorkspaceSurface`
 *  client, identical whatever link backs it. */
export type PulamDaemonClient = ContractRouterClient<
  typeof terminalWorkspaceSurface.contract
>;

/** The local pulam reports no identity (it is ephemeral and never adopted), so
 *  the endpoint's identity type is `undefined`. */
export type PulamConnection = DaemonConnection<PulamDaemonClient, undefined>;

/** Dial the local pulam at `socketPath` and return the live connection. Rejects
 *  with the raw socket error (the supervisor maps it to a retry/`dead`) if the
 *  socket isn't up. */
export async function connectPulam(
  socketPath: string,
): Promise<PulamConnection> {
  const socket = await dialSocket(socketPath);
  const client = stdioLink<typeof terminalWorkspaceSurface.contract>({
    read: socket,
    write: socket,
  }) as PulamDaemonClient;

  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    client,
    identity: undefined,
    // Approximate: the connect instant. The ephemeral pulam is never adopted, so
    // nothing compares this against a survivor's start time.
    startedAt: Date.now(),
    dispose: () => socket.destroy(),
    onClose: (cb) => {
      if (closed) queueMicrotask(cb);
      else socket.once("close", cb);
    },
  };
}
