/**
 * kolu's side of the daemon handshake — the `connect` the supervisor endpoint
 * is parameterized over. It dials kaval's unix socket, reads the frozen identity
 * first, then runs the versioned pty-host handshake (a skew becomes an honest
 * "restart it", never an opaque deep-RPC error), and hands back a
 * `DaemonConnection` the endpoint holds.
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

import { ORPCError } from "@orpc/client";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import {
  type ConvergenceProbe,
  type DaemonConnection,
  DaemonContractSkewError,
  daemonBuild,
  dialSocket,
  isNoListenerError,
  instanceKeyFromStartedAt,
  probeDaemonIdentity,
} from "@kolu/surface-daemon-supervisor";
import {
  CONTROL_CORE_VERSION,
  type DaemonLifetimeInfo,
} from "@kolu/surface-daemon";
import { withTimeout } from "../withTimeout.ts";
import {
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostClient,
  type PtyHostIdentity,
  type kavalDaemonContract,
} from "kaval";

export { isNoListenerError };

/** A live daemon from before the frozen fragment has no trusted identity, so the
 * endpoint's identity type remains optional during this upgrade window. */
export type KavalConnection = DaemonConnection<
  PtyHostClient,
  PtyHostIdentity | undefined,
  KavalConnectionMetadata
>;

export type KavalConnectionMetadata = {
  contractVersion: string;
  /** kaval's serialized lifetime (`forever` in production; `boundToPid` under a
   *  test/smoke run), read off `system.version` — mirrored into `DaemonStatus`
   *  for the Kaval dialog's lifetime row. Optional: a survivor predating the
   *  field reports none, and the reader falls back to "—". Rides the metadata
   *  channel (kolu's soul), not the supervisor's generic `identity`. */
  lifetime?: DaemonLifetimeInfo;
};

/** Deadline for each handshake read. The socket is already connected, so a
 * healthy kaval answers in milliseconds; a foreign or wedged peer must reject
 * rather than hang boot. */
const HANDSHAKE_READ_DEADLINE_MS = 10_000;

function isMissingFrozenFragment(err: unknown): boolean {
  return (
    err instanceof ORPCError &&
    err.code === "NOT_FOUND" &&
    err.status === 404 &&
    err.defined === false
  );
}

/** Read the frozen hello on the same bounded handshake clock. A current kaval
 * must answer; the caller alone interprets the structured old-route absence. */
function readControlHelloBounded(
  client: ReturnType<typeof stdioLink<typeof kavalDaemonContract>>,
) {
  return withTimeout(
    client.surface.control.core.hello(),
    HANDSHAKE_READ_DEADLINE_MS,
    `control-core hello exceeded ${HANDSHAKE_READ_DEADLINE_MS}ms deadline`,
  );
}

/** Read `system.version` off `client`, bounded by {@link HANDSHAKE_READ_DEADLINE_MS}:
 *  a peer that accepts the unix connection but never answers oRPC (a foreign squatter,
 *  a wedged daemon) would otherwise leave the read pending FOREVER and hang boot. The
 *  deadline is a BAKED constant, never an override knob (fail-fast). `Promise.race`
 *  attaches a handler to the version promise, so a late rejection after the caller's
 *  `socket.destroy()` is not unhandled. Throws on the deadline; the CALLER destroys
 *  the socket (the caller owns that error boundary). */
function readSystemVersionBounded(
  client: PtyHostClient,
): Promise<Awaited<ReturnType<PtyHostClient["surface"]["system"]["version"]>>> {
  return withTimeout(
    client.surface.system.version({}),
    HANDSHAKE_READ_DEADLINE_MS,
    `handshake read exceeded ${HANDSHAKE_READ_DEADLINE_MS}ms deadline`,
  );
}

export async function connectKaval(
  socketPath: string,
): Promise<KavalConnection> {
  const socket = await dialSocket(socketPath);
  const client = stdioLink<typeof kavalDaemonContract>({
    read: socket,
    write: socket,
  });

  let hello: Awaited<ReturnType<typeof readControlHelloBounded>> | undefined;
  try {
    hello = await readControlHelloBounded(client);
  } catch (err) {
    if (!isMissingFrozenFragment(err)) {
      socket.destroy();
      throw new Error(
        `pty-host handshake failed — could not read control.core.hello (${(err as Error).message})`,
      );
    }
    // A live old kaval has no frozen route. Keep the versioned handshake for
    // connectivity/metadata, but never read build identity from it: absence is
    // the identity fact and the UI's #1671 fold turns that into the update nudge.
  }
  if (
    hello !== undefined &&
    hello.controlCoreVersion !== CONTROL_CORE_VERSION
  ) {
    socket.destroy();
    throw new Error(
      `pty-host handshake failed — unsupported control-core version ${hello.controlCoreVersion}; expected ${CONTROL_CORE_VERSION}`,
    );
  }

  let version: Awaited<
    ReturnType<PtyHostClient["surface"]["system"]["version"]>
  >;
  try {
    version = await readSystemVersionBounded(client);
  } catch (err) {
    socket.destroy();
    throw new Error(
      `pty-host handshake failed — could not read system.version (${(err as Error).message})`,
    );
  }
  const reportedContractVersion =
    hello?.surfaceVersion ?? version.contractVersion;
  if (hello !== undefined && hello.surfaceVersion !== version.contractVersion) {
    socket.destroy();
    throw new Error(
      `pty-host handshake failed — control-core reports surface ${hello.surfaceVersion} but system.version reports ${version.contractVersion}`,
    );
  }
  if (
    !isContractVersionCompatible(
      reportedContractVersion,
      PTY_HOST_CONTRACT_VERSION,
    )
  ) {
    socket.destroy();
    // The ONE failure that proves the survivor is incompatible — raise the typed
    // skew error so `adoptOrEnsure` recycles it (retrying can't fix incompatible
    // contracts). Every other reject above stays a plain Error (non-skew). The
    // versions ride as FIELDS (SK2) so every downstream consumer — the typed
    // recycleKaval rethrow, the `incompatible` status arm — reads them
    // structurally, never re-parsing the message prose.
    throw new DaemonContractSkewError({
      subject: "pty-host",
      daemonVersion: reportedContractVersion,
      requiredVersion: PTY_HOST_CONTRACT_VERSION,
      // The skewed daemon's OWN pid, so the gate-less-squatter recovery of an OLD
      // orphan (the 25494 case, which throws HERE before a connection exists) has
      // its third identity attestation. `pid` is a required `system.version` field
      // (since #1301), so a validated `version` always carries it.
      pid: version.pid,
    });
  }
  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    client: client as PtyHostClient,
    identity:
      hello === undefined
        ? undefined
        : {
            staleKey: hello.buildId ?? "",
            navigableCommit: hello.commit ?? "",
          },
    startedAt: hello?.startedAt ?? version.startedAt,
    metadata: {
      contractVersion: reportedContractVersion,
      lifetime: version.lifetime,
    },
    dispose: () => socket.destroy(),
    onClose: (cb) => {
      if (closed) queueMicrotask(cb);
      else socket.once("close", cb);
    },
  };
}

/**
 * The convergence PROBE for kaval — reads identity only through the frozen
 * control-core fragment, before the versioned pty-host handshake. The shared
 * factory owns dial, timeout, transport disposal, and honest no-listener null.
 *
 * A served daemon that returns the structured missing-route frame predates the
 * fragment. By the #1671 rule, absent means older: represent it as a compatible
 * contract with an unknown build and a named pre-instance key. The existing
 * not-drainable policy therefore chooses `nudge-human` (never silent adopt,
 * never destructive recycle). Every other handshake failure still throws.
 */
const probeFrozenKavalIdentity = probeDaemonIdentity({
  capability: "not-drainable",
});

export async function probeKavalForConvergence(
  socketPath: string,
): Promise<ConvergenceProbe<"not-drainable"> | null> {
  try {
    return await probeFrozenKavalIdentity(socketPath);
  } catch (err) {
    if (isMissingFrozenFragment(err)) {
      return {
        capability: "not-drainable",
        identity: {
          contractVersion: PTY_HOST_CONTRACT_VERSION,
          build: daemonBuild(""),
        },
        instanceKey: instanceKeyFromStartedAt(undefined),
        // The framework factory already disposed the failed route connection.
        dispose: () => {},
      };
    }
    throw err;
  }
}
