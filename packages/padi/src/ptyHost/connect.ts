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

import type { Socket } from "node:net";
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
  readControlCoreHello,
} from "@kolu/surface-daemon-supervisor";
import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
import { withTimeout } from "../withTimeout.ts";
import {
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostClient,
  type PtyHostIdentity,
  type kavalDaemonContract,
} from "kaval";
import { match } from "ts-pattern";

export { isNoListenerError };

/** A live daemon from before the frozen fragment gets the honest-unknown raw
 * identity (both fields empty), never the legacy `system.version.identity`.
 * Current padi connections therefore always carry an identity. The published
 * wire status remains optional at its compatibility boundary so an older padi's
 * pre-identity survivor can still be decoded. */
export type KavalConnection = DaemonConnection<
  PtyHostClient,
  PtyHostIdentity,
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

type KavalSystemVersion = Awaited<
  ReturnType<PtyHostClient["surface"]["system"]["version"]>
>;
type KavalControlHello = Awaited<ReturnType<typeof readControlCoreHello>>;

type KavalHandshake =
  | {
      kind: "current";
      hello: KavalControlHello;
      version: KavalSystemVersion;
    }
  | {
      kind: "pre-fragment";
      version: KavalSystemVersion;
    };

/** Interpret the wire handshake without owning its transport. The
 * discriminant keeps the current/pre-fragment fact explicit; the caller has
 * one failure boundary that releases the socket for every rejected handshake. */
async function readKavalHandshake(
  client: ReturnType<typeof stdioLink<typeof kavalDaemonContract>>,
): Promise<KavalHandshake> {
  let hello: KavalControlHello | undefined;
  try {
    hello = await readControlCoreHello(client);
  } catch (err) {
    if (!isMissingFrozenFragment(err)) {
      throw new Error(
        `pty-host handshake failed — could not read control.core.hello (${(err as Error).message})`,
      );
    }
    // A live old kaval has no frozen route. Keep the versioned handshake for
    // connectivity/metadata, but never read build identity from it: absence is
    // the identity fact and the UI's #1671 fold turns that into the update nudge.
  }

  let version: KavalSystemVersion;
  try {
    version = await readSystemVersionBounded(client as PtyHostClient);
  } catch (err) {
    throw new Error(
      `pty-host handshake failed — could not read system.version (${(err as Error).message})`,
    );
  }

  const reportedContractVersion =
    hello?.surfaceVersion ?? version.contractVersion;
  if (hello !== undefined && hello.surfaceVersion !== version.contractVersion) {
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

  return hello === undefined
    ? { kind: "pre-fragment", version }
    : { kind: "current", hello, version };
}

/** Project the frozen optional fields into Kaval's established raw identity.
 * New daemons emit both; any older partial/absent payload is one honest unknown
 * fact, never a half-identity. The frozen wire itself remains unchanged. */
function projectKavalIdentity(hello: KavalControlHello): PtyHostIdentity {
  return hello.buildId && hello.commit
    ? { staleKey: hello.buildId, navigableCommit: hello.commit }
    : { staleKey: "", navigableCommit: "" };
}

export async function connectKaval(
  socketPath: string,
): Promise<KavalConnection> {
  const socket = await dialSocket(socketPath);
  const client = stdioLink<typeof kavalDaemonContract>({
    read: socket,
    write: socket,
  });

  let handshake: KavalHandshake;
  try {
    handshake = await readKavalHandshake(client);
  } catch (err) {
    socket.destroy();
    throw err;
  }

  const { version } = handshake;
  const projected = match(handshake)
    .with({ kind: "current" }, ({ hello }) => ({
      contractVersion: hello.surfaceVersion,
      identity: projectKavalIdentity(hello),
      startedAt: hello.startedAt,
    }))
    .with({ kind: "pre-fragment" }, ({ version: legacyVersion }) => ({
      contractVersion: legacyVersion.contractVersion,
      identity: { staleKey: "", navigableCommit: "" },
      startedAt: legacyVersion.startedAt,
    }))
    .exhaustive();
  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    client: client as PtyHostClient,
    identity: projected.identity,
    startedAt: projected.startedAt,
    metadata: {
      contractVersion: projected.contractVersion,
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
 * contract with an unknown build and a named instance key from the observed
 * legacy boot instant. The existing
 * not-drainable policy therefore chooses `nudge-human` (never silent adopt,
 * never destructive recycle). Every other handshake failure still throws.
 */
const probeFrozenKavalIdentity = probeDaemonIdentity({
  capability: "not-drainable",
});

/** The one finite transition read for a daemon that predates the frozen route.
 * Read only facts the old wire can honestly supply: its contract version and
 * boot instant. Its old build field is deliberately ignored; build identity is
 * trusted only from the frozen fragment. */
async function probePreFragmentKaval(
  socketPath: string,
): Promise<ConvergenceProbe<"not-drainable"> | null> {
  let socket: Socket;
  try {
    socket = await dialSocket(socketPath);
  } catch (err) {
    if (isNoListenerError(err)) return null;
    throw err;
  }
  const client = stdioLink<typeof kavalDaemonContract>({
    read: socket,
    write: socket,
  });
  try {
    const version = await readSystemVersionBounded(client as PtyHostClient);
    return {
      capability: "not-drainable",
      identity: {
        contractVersion: version.contractVersion,
        build: daemonBuild(""),
      },
      instanceKey: instanceKeyFromStartedAt(version.startedAt),
      dispose: () => socket.destroy(),
    };
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

export async function probeKavalForConvergence(
  socketPath: string,
): Promise<ConvergenceProbe<"not-drainable"> | null> {
  try {
    return await probeFrozenKavalIdentity(socketPath);
  } catch (err) {
    if (isMissingFrozenFragment(err)) {
      // The framework factory disposed the failed route connection. Redial the
      // old daemon through the only identity-era wire it has and preserve only
      // its observed contract/boot facts; fragment absence supplies the honest
      // unknown-build fact that drives the existing update nudge.
      return await probePreFragmentKaval(socketPath);
    }
    throw err;
  }
}
