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
import { buildSurfaceFace } from "@kolu/surface/client";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import type { SurfaceDispatch } from "@kolu/surface/link";
import {
  type ControlCoreProbeClient,
  type ConvergenceProbe,
  type DaemonConnection,
  DaemonContractSkewError,
  dialSocket,
  isNoListenerError,
  probeDaemonIdentity,
  readControlCoreHello,
} from "@kolu/surface-daemon-supervisor";
import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
import { withTimeout } from "../withTimeout.ts";
import {
  kavalControlSurface,
  kavalDaemonGroup,
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostClient,
  type PtyHostIdentity,
  ptyHostClientOver,
} from "kaval";

export { isNoListenerError };

/** An off-Nix kaval reports the honest-unknown raw identity (both fields empty).
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
  /** The tag-keyed dispatch of THIS connection's link — the transport seam the
   * stable `ptyHostClient` face forwards onto. It rides the metadata channel
   * (padi's own, process-internal) rather than the supervisor's generic
   * `identity`/`client` slots because it is a fact about padi's wire, not
   * something the spine models: the spine's `client` is already the per-dial
   * typed face, and padi additionally needs the raw seam under it so ONE face
   * built at import time can address whatever connection is current. Never
   * projected onto `DaemonStatus` or any wire shape. */
  dispatch: SurfaceDispatch;
  /** The connected daemon's own pid from the already-validated
   * `system.version` handshake. Kept internal to padi's endpoint metadata so
   * process-local consumers can identify this exact connection generation;
   * never projected onto `DaemonStatus` or added to a wire shape. */
  pid: number;
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

const UNKNOWN_KAVAL_IDENTITY: PtyHostIdentity = Object.freeze({
  staleKey: "",
  navigableCommit: "",
});

interface KavalHandshake {
  hello: KavalControlHello;
  version: KavalSystemVersion;
}

/** The two typed faces over ONE dialed dispatch — the flat-tag successor of the
 *  combined-contract client. `kavalDaemonGroup` carries BOTH siblings' tags, so a
 *  single link answers the pty-host handshake AND the frozen control core. */
interface KavalFaces {
  pty: PtyHostClient;
  control: ControlCoreProbeClient;
}

/** Interpret the wire handshake without owning its transport. The caller has
 * one failure boundary that releases the socket for every rejected handshake.
 *
 * The `pre-fragment` arm is GONE with the protocol epoch (PLAN D6): a kaval that
 * predates the frozen fragment also predates this wire, so its first frame is
 * undecodable and a dial never reaches route resolution at all. Such a peer is
 * the supervisor's `unspeakable-protocol` observation, never a handshake this
 * function can interpret — so the frozen hello is now REQUIRED, and its absence
 * is the loud failure it always was for a same-epoch peer. */
async function readKavalHandshake(faces: KavalFaces): Promise<KavalHandshake> {
  let hello: KavalControlHello;
  try {
    hello = await readControlCoreHello(faces.control);
  } catch (err) {
    throw new Error(
      `pty-host handshake failed — could not read control.core.hello (${(err as Error).message})`,
    );
  }

  let version: KavalSystemVersion;
  try {
    version = await readSystemVersionBounded(faces.pty);
  } catch (err) {
    throw new Error(
      `pty-host handshake failed — could not read system.version (${(err as Error).message})`,
    );
  }

  const reportedContractVersion = hello.surfaceVersion;
  if (hello.surfaceVersion !== version.contractVersion) {
    throw new Error(
      `pty-host handshake failed — control-core reports surface ${hello.surfaceVersion} but system.version reports ${version.contractVersion}`,
    );
  }
  if (hello.startedAt !== version.startedAt) {
    throw new Error(
      `pty-host handshake failed — control-core reports boot ${hello.startedAt} but system.version reports ${version.startedAt}`,
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

  return { hello, version };
}

/** Open ONE link over the whole kaval daemon group and build both faces over its
 *  single dispatch. `dispose()` is ASYNC and is the ONLY thing that frees the
 *  link's protocol fibers — destroying the socket alone leaks one per dial. */
async function openKavalFaces(socket: Socket): Promise<{
  faces: KavalFaces;
  dispatch: SurfaceDispatch;
  dispose: () => Promise<void>;
}> {
  const link = await stdioLink({
    group: kavalDaemonGroup,
    read: socket,
    write: socket,
  });
  // `SurfaceFace` is deliberately STRUCTURAL (D2), so reaching the frozen core's
  // verbs costs one cast — to the shape the shared hello reader already names.
  const control = buildSurfaceFace(kavalControlSurface, link.dispatch).surface
    .core as unknown as ControlCoreProbeClient["surface"]["control"]["core"];
  return {
    faces: {
      pty: ptyHostClientOver(link.dispatch),
      control: { surface: { control: { core: control } } },
    },
    dispatch: link.dispatch,
    dispose: () => link.dispose(),
  };
}

/** Project the frozen optional fields into Kaval's established raw identity.
 * The shared hello reader has already rejected a partial pair; absent or empty
 * fields are one honest unknown fact. The frozen wire itself remains unchanged. */
function projectKavalIdentity(hello: KavalControlHello): PtyHostIdentity {
  return hello.buildId && hello.commit
    ? { staleKey: hello.buildId, navigableCommit: hello.commit }
    : UNKNOWN_KAVAL_IDENTITY;
}

export async function connectKaval(
  socketPath: string,
): Promise<KavalConnection> {
  const socket = await dialSocket(socketPath);
  const { faces, dispatch, dispose } = await openKavalFaces(socket);

  let handshake: KavalHandshake;
  try {
    handshake = await readKavalHandshake(faces);
  } catch (err) {
    await dispose();
    socket.destroy();
    throw err;
  }

  const { hello, version } = handshake;
  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    client: faces.pty,
    identity: projectKavalIdentity(hello),
    startedAt: hello.startedAt,
    metadata: {
      contractVersion: hello.surfaceVersion,
      // SPREAD, never `lifetime: version.lifetime` (#17): `system.version`
      // declares `lifetime` as `Schema.optionalKey`, so a survivor kaval that
      // predates the field decodes with the key ABSENT and this read is
      // `undefined`. That value is mirrored onto `DaemonStatus.lifetime` —
      // `optionalKey` there too — whose every wire push ENCODES it, and an
      // `optionalKey` rejects a present `undefined` where zod's `.optional()`
      // took either. Keeping the key absent here is what keeps that mirror legal.
      ...(version.lifetime !== undefined && { lifetime: version.lifetime }),
      pid: version.pid,
      dispatch,
    },
    // `DaemonConnection.dispose` is a SYNCHRONOUS seam (the supervisor tears
    // down from paths that cannot await), so the link release is FIRED here
    // rather than awaited — it is the only thing that frees the protocol
    // fibers, and it must never replace the reason a caller is tearing down.
    // Same shape `connectPadi` makes, for the same reason.
    dispose: () => {
      void dispose().catch(() => {
        /* best-effort — a link already disposed is fine */
      });
      socket.destroy();
    },
    onClose: (cb) => {
      if (closed) queueMicrotask(cb);
      else socket.once("close", cb);
    },
  };
}

/**
 * The convergence PROBE for kaval — reads identity through the frozen
 * control-core fragment only, before the versioned pty-host handshake. The shared
 * factory owns dial, timeout, transport disposal, and honest no-listener null.
 *
 * The pre-fragment REDIAL that used to sit behind this is GONE (PLAN D6): a kaval
 * without the frozen route also predates this protocol epoch, so its first frame
 * is undecodable and the factory raises `UnspeakableProtocolError` — the
 * supervisor's observation, not a fallback this module can take. Every handshake
 * failure now propagates, which is what the factory already documents.
 */
export const probeKavalForConvergence: (
  socketPath: string,
) => Promise<ConvergenceProbe<"not-drainable"> | null> = probeDaemonIdentity({
  capability: "not-drainable",
});
