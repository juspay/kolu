/**
 * kolu's side of the local-`pulam` handshake — the `connect` the supervisor
 * endpoint is parameterized over, the awareness twin of `connect.ts` (kaval). It
 * dials pulam's unix socket and hands back a `DaemonConnection` the endpoint
 * holds and the mirror reads.
 *
 * Like `connectKaval`, it goes through the shared `dialDaemonConnection` (dial →
 * `stdioLink` client → close-forwarding `DaemonConnection`) rather than
 * `unixSocketLink`, for the one thing the supervisor needs that the link doesn't
 * expose: the socket's **close event**, so the supervisor learns of pulam's death
 * instantly (flip to `degraded`, end the mirror) without polling.
 *
 * Unlike kaval it supplies NO handshake: the local pulam is spawned fresh from
 * kolu's OWN build on every boot (it never survives kolu, never adopts), so a
 * contract skew can't arise — the socket-accepting gate the supervisor already
 * waits on before calling `connect` is the only liveness check the ephemeral
 * local mirror needs. So the shared dialer defaults identity to `undefined` and
 * startedAt to now.
 */

import { stdioLink } from "@kolu/surface/links/stdio";
import {
  type DaemonConnection,
  dialDaemonConnection,
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
export function connectPulam(socketPath: string): Promise<PulamConnection> {
  return dialDaemonConnection<PulamDaemonClient, undefined>(socketPath, {
    makeClient: (socket) =>
      stdioLink<typeof terminalWorkspaceSurface.contract>({
        read: socket,
        write: socket,
      }) as PulamDaemonClient,
    // No handshake → identity:undefined, startedAt:now (see the module note).
  });
}
