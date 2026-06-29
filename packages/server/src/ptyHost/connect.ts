/**
 * kolu's side of the daemon handshake — the `connect` the supervisor endpoint
 * is parameterized over. It dials kaval's unix socket, runs the
 * contract-version handshake BEFORE anything else (a skew becomes an honest
 * "restart it", never an opaque deep-RPC error or an import-time throw), and
 * hands back a `DaemonConnection` the endpoint holds.
 *
 * It dials the socket *directly* (the supervisor's `dialDaemonConnection`, over
 * `stdioLink`) rather than through `@kolu/surface`'s `unixSocketLink`, for one
 * reason the supervisor genuinely needs and that link doesn't expose: the
 * socket's **close event**. When kaval dies mid-session the supervisor must learn
 * it instantly (to flip the endpoint to `degraded`), without polling. The shared
 * `dialDaemonConnection` owns that dial → close-forwarding assembly (so the local
 * pulam's `connect` reuses it); this file supplies only kaval's VALUES — the
 * `stdioLink` client and the version handshake.
 */

import { isContractVersionCompatible } from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import {
  type DaemonConnection,
  DaemonContractSkewError,
  dialDaemonConnection,
} from "@kolu/surface-daemon-supervisor";
import {
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostClient,
  type PtyHostIdentity,
  type ptyHostSurface,
} from "kaval";

/** kaval reports `identity` as optional on the wire (a future daemon predating
 *  the field stays compatible), so the endpoint's identity type is nullable. */
export type KavalConnection = DaemonConnection<
  PtyHostClient,
  PtyHostIdentity | undefined
>;

/** Dial kaval at `socketPath`, handshake, and return the live connection.
 *
 *  Three failure classes, distinguished for the supervisor's adopt path (F4):
 *  - a raw socket error (socket isn't up) → plain reject (non-skew, transient);
 *  - an unreadable `system.version` (handshake read failed) → plain `Error`
 *    (non-skew: the daemon is there but did not answer the probe this time);
 *  - a genuine contract-version mismatch → `DaemonContractSkewError`.
 *
 *  Only the LAST is a skew: it is the one failure that proves the daemon is
 *  incompatible, so it is the only one on which `adoptOrEnsure` recycles a live
 *  survivor. The first two are possibly-transient and must not cost a survivor
 *  its live PTYs, so they stay plain errors the endpoint retries. (`ensure`'s
 *  fresh-boot path turns any of the three into `dead` regardless.) */
export function connectKaval(socketPath: string): Promise<KavalConnection> {
  return dialDaemonConnection<PtyHostClient, PtyHostIdentity | undefined>(
    socketPath,
    {
      makeClient: (socket) =>
        stdioLink<typeof ptyHostSurface.contract>({
          read: socket,
          write: socket,
        }) as PtyHostClient,
      // The handshake's throws (the shared dialer destroys the socket): an
      // unreadable `system.version` → a plain `Error` (non-skew, the daemon is
      // there but didn't answer); a genuine contract mismatch → the typed
      // `DaemonContractSkewError`, the ONE failure `adoptOrEnsure` recycles on
      // (retrying can't fix incompatible contracts).
      handshake: async (client) => {
        let version: Awaited<
          ReturnType<PtyHostClient["surface"]["system"]["version"]>
        >;
        try {
          version = await client.surface.system.version({});
        } catch (err) {
          throw new Error(
            `pty-host handshake failed — could not read system.version (${(err as Error).message})`,
          );
        }
        if (
          !isContractVersionCompatible(
            version.contractVersion,
            PTY_HOST_CONTRACT_VERSION,
          )
        ) {
          throw new DaemonContractSkewError(
            `pty-host contract skew: kaval speaks ${version.contractVersion}, server needs ${PTY_HOST_CONTRACT_VERSION}`,
          );
        }
        return { identity: version.identity, startedAt: version.startedAt };
      },
    },
  );
}
