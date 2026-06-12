/**
 * kolu's side of the daemon handshake — the `connect` the supervisor endpoint
 * is parameterized over. It dials kaval's unix socket, runs the
 * contract-version handshake BEFORE anything else (a skew becomes an honest
 * "restart it", never an opaque deep-RPC error or an import-time throw), and
 * hands back a `DaemonConnection` the endpoint holds.
 *
 * It dials the socket *directly* (the supervisor's `dialSocket` + `stdioLink`)
 * rather than through `@kolu/surface`'s `unixSocketLink`, for one reason the
 * supervisor genuinely needs and that link doesn't expose: the socket's
 * **close event**. When kaval dies mid-session the supervisor must learn it
 * instantly (to flip the endpoint to `degraded`), without polling — so kolu
 * owns the socket here and forwards its `close` as `onClose`. The dial shares
 * `dialSocket` with the endpoint's readiness probe so the connect/error race
 * lives at one site; the framing and client wiring are otherwise identical to
 * `unixSocketLink`.
 */

import { isContractVersionCompatible } from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import {
  type DaemonConnection,
  dialSocket,
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
 *  Rejects (raw socket error) if the socket isn't up, or throws on a contract
 *  skew / unreadable version — the endpoint turns either into `dead`. */
export async function connectKaval(
  socketPath: string,
): Promise<KavalConnection> {
  const socket = await dialSocket(socketPath);
  const client = stdioLink<typeof ptyHostSurface.contract>({
    read: socket,
    write: socket,
  }) as PtyHostClient;

  let version: Awaited<
    ReturnType<PtyHostClient["surface"]["system"]["version"]>
  >;
  try {
    version = await client.surface.system.version({});
  } catch (err) {
    socket.destroy();
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
    socket.destroy();
    throw new Error(
      `pty-host contract skew: kaval speaks ${version.contractVersion}, server needs ${PTY_HOST_CONTRACT_VERSION}`,
    );
  }

  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    client,
    identity: version.identity,
    startedAt: version.startedAt,
    dispose: () => socket.destroy(),
    onClose: (cb) => {
      if (closed) queueMicrotask(cb);
      else socket.once("close", cb);
    },
  };
}
