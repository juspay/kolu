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
  type ConvergenceProbe,
  type DaemonConnection,
  DaemonContractSkewError,
  daemonBuild,
  dialSocket,
} from "@kolu/surface-daemon-supervisor";
import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
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
/** Deadline for the `system.version` handshake READ — the socket is already
 *  connected, so a healthy kaval answers in milliseconds; a peer that accepts but
 *  never replies (a foreign squatter, a wedged daemon) must reject here rather than
 *  hang boot. Generous enough that a loaded-box kaval never trips it. */
const HANDSHAKE_READ_DEADLINE_MS = 10_000;

/** Read `system.version` off `client`, bounded by {@link HANDSHAKE_READ_DEADLINE_MS}:
 *  a peer that accepts the unix connection but never answers oRPC (a foreign squatter,
 *  a wedged daemon) would otherwise leave the read pending FOREVER and hang boot. The
 *  deadline is a BAKED constant, never an override knob (fail-fast). `Promise.race`
 *  attaches a handler to the version promise, so a late rejection after the caller's
 *  `socket.destroy()` is not unhandled. Throws on the deadline; the CALLER destroys
 *  the socket (both `connectKaval` and the convergence probe already do, in their own
 *  catch, so error handling stays where each wants it). */
async function readSystemVersionBounded(
  client: PtyHostClient,
): Promise<Awaited<ReturnType<PtyHostClient["surface"]["system"]["version"]>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.surface.system.version({}),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `handshake read exceeded ${HANDSHAKE_READ_DEADLINE_MS}ms deadline`,
              ),
            ),
          HANDSHAKE_READ_DEADLINE_MS,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
    version = await readSystemVersionBounded(client);
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
    // The ONE failure that proves the survivor is incompatible — raise the typed
    // skew error so `adoptOrEnsure` recycles it (retrying can't fix incompatible
    // contracts). Every other reject above stays a plain Error (non-skew). The
    // versions ride as FIELDS (SK2) so every downstream consumer — the typed
    // recycleKaval rethrow, the `incompatible` status arm — reads them
    // structurally, never re-parsing the message prose.
    throw new DaemonContractSkewError({
      subject: "pty-host",
      daemonVersion: version.contractVersion,
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
    client,
    identity: version.identity,
    startedAt: version.startedAt,
    metadata: {
      contractVersion: version.contractVersion,
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
 * The convergence PROBE for kaval — reads the running kaval's identity over
 * `system.version` and returns it to the shared convergence kit (`converge`), which
 * DECIDES the policy (kaval: recycle-on-skew + nudge-human). Distinct from
 * {@link connectKaval} in two load-bearing ways:
 *   - it does NOT judge — it reads `{ contractVersion, identity.staleKey }` and returns
 *     them WITHOUT the compatibility check (Pin 3: identity is read before, and
 *     independent of, the versioned handshake, so a contract skew still yields the
 *     running identity for `decide` to route to `recycle`); the endpoint's own
 *     `connectKaval` still raises `DaemonContractSkewError` at the recycle ENACTMENT.
 *   - it is NON-DRAINABLE (`capability: "not-drainable"`) — kaval has no `drain` verb
 *     (recycling it kills PTYs, so its build-mismatch policy is a human nudge, never an
 *     auto-drain), which the kit enforces at the type level (Pin 1).
 *
 * Returns `null` if no kaval answers (a fresh boot / mid-teardown) — the kit then spawns.
 * `buildId` folds an absent/off-nix `staleKey` to `""` (an honest "unknown", never a
 * fabricated match), exactly as the client-side currency nudge reads it.
 */
export async function probeKavalForConvergence(
  socketPath: string,
): Promise<ConvergenceProbe<"not-drainable"> | null> {
  let socket: Awaited<ReturnType<typeof dialSocket>>;
  try {
    socket = await dialSocket(socketPath);
  } catch {
    return null; // no kaval answering — nothing to converge; the spawn path handles it.
  }
  const client = stdioLink<typeof ptyHostSurface.contract>({
    read: socket,
    write: socket,
  }) as PtyHostClient;
  let version: Awaited<
    ReturnType<PtyHostClient["surface"]["system"]["version"]>
  >;
  try {
    // Bounded like `connectKaval` (F2): converge probes BEFORE the recovery runs, so
    // a silent-accept holder here would hang boot before `adoptOrEnsure` could reach
    // the recovery's foreign refusal. The deadline turns it into a clean `null`.
    version = await readSystemVersionBounded(client);
  } catch {
    socket.destroy();
    return null; // the daemon is there but did not answer the probe — treat as none.
  }
  return {
    capability: "not-drainable",
    identity: {
      contractVersion: version.contractVersion,
      build: daemonBuild(version.identity?.staleKey ?? ""),
    },
    dispose: () => socket.destroy(),
  };
}
