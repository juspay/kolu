/**
 * The daemon CLIENT half — the blocks the `@kolu/surface-daemon-supervisor`
 * reference and "How to recycle and upgrade a daemon" embed. The endpoint state
 * machine takes the daemon from nothing to a live, handshaken connection;
 * `converge` decides a live upgrade by a declared policy and enacts it.
 *
 * Typechecked, never executed — the endpoint/converge calls live inside
 * functions so nothing spawns at compile time.
 */

import {
  buildSurfaceFace,
  type StreamingProcedure,
  type SurfaceFace,
} from "@kolu/surface/client";
import { composeSurfaceContracts } from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import {
  type ConvergenceIdentity,
  controlCoreSurface,
  daemonBuild,
  daemonHome,
  readBakedIdentity,
  stderrLogger,
} from "@kolu/surface-daemon";
import {
  converge,
  type ConvergencePolicy,
  createEndpoint,
  type DaemonConnection,
  dialSocket,
  probeDaemonIdentity,
  recycle,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import { Effect, Option, Stream } from "effect";
import { type Load, surface } from "./surface";

// Same home declaration the daemon uses — disagreement about gate/socket impossible.
const home = daemonHome({ app: "fleet-top", placement: "state" });
const daemonEntry = "/nix/store/…/bin/fleet-top-daemon";

// A supervisor's DETACHED spawn runs the daemon under `cfg.env` ALONE — no parent
// env is layered under it (that would leak the supervisor's ambient identity into
// the daemon). So `cfg.env` must be the COMPLETE child env: compose it from a fixed
// allowlist of the vars the daemon needs to run, never the whole parent env. (kolu's
// own supervisors mine `kolu-pty`'s `SPAWN_ENV_ALLOWLIST`; a standalone consumer
// names its own base, as here.)
function spawnEnvBase(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["HOME", "PATH", "SHELL", "TERM", "LANG"]) {
    const v = process.env[key];
    if (v != null) env[key] = v;
  }
  return env;
}

/** The two siblings the daemon serves, composed into ONE flat group: every
 *  member at `surface/<key>/<member>/<verb>`. The dialled face is built from the
 *  SAME composition, so client and server cannot disagree about a tag. */
const daemonSurfaces = composeSurfaceContracts({
  app: surface,
  control: controlCoreSurface,
});
/** The client the endpoint holds — the structural member face. There is no
 *  contract type to be generic over; per-member precision lives in the
 *  spec-derived bound hooks a Solid consumer builds. */
type TopClient = SurfaceFace;
/** What "identity" means for this daemon — enough to prove the link answered. */
interface TopIdentity {
  loadOne: number;
}

/** A snapshot-then-deltas member opens with its snapshot, so `runHead` IS the
 *  one-shot read — and it interrupts the subscription as soon as it lands. */
function snapshot<T>(
  stream: Stream.Stream<T, unknown>,
  what: string,
): Effect.Effect<T, Error> {
  return Stream.runHead(stream).pipe(
    // The endpoint's `connect` declares `Error`, so an upstream failure of any
    // shape is normalised here rather than widening the contract.
    Effect.mapError((cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
    ),
    Effect.flatMap((head) =>
      Option.isNone(head)
        ? Effect.fail(
            new Error(`${what}: stream closed before its snapshot frame`),
          )
        : Effect.succeed(head.value),
    ),
  );
}

// `connect` is the supervisor's soul: dial the socket, prove the link answers by
// reading a first frame, and stamp the identity the endpoint reports. It is an
// EFFECT: the endpoint composes it into its own fibers, so a boot the supervisor
// gives up on tears the half-made connection down instead of abandoning it.
function connectTop(
  socketPath: string,
): Effect.Effect<DaemonConnection<TopClient, TopIdentity>, Error> {
  return Effect.gen(function* () {
    const socket = yield* dialSocket(socketPath);
    // A connected unix socket IS a Duplex, and the framing is the same ndjson
    // `serveOverUnixSocket` serves — so the stdio link carries it verbatim.
    // `stdioLink` is a Promise-shaped constructor by contract, so it is LIFTED
    // here rather than run.
    const link = yield* Effect.promise(() =>
      stdioLink({
        group: daemonSurfaces.group,
        read: socket,
        write: socket,
      }),
    );
    // The `app` SIBLING's own face: the sibling `Surface` value already carries
    // the `surface/app/` tag prefix, so the face never learns it is scoped.
    const client = buildSurfaceFace(daemonSurfaces.siblings.app, link.dispatch);
    const load = yield* snapshot(
      (client.surface.load?.get as StreamingProcedure<undefined, Load>)(
        undefined,
      ),
      "app.load",
    );
    const closeCbs: Array<() => void> = [];
    let closed = false;
    socket.once("close", () => {
      closed = true;
      for (const cb of closeCbs) cb();
    });
    return {
      client,
      identity: { loadOne: load.one },
      startedAt: Date.now(),
      // Release the LINK's scope first (it holds the protocol's fibers), then
      // drop the socket — dropping the socket alone would leak them.
      dispose: () => {
        void link.dispose().finally(() => socket.destroy());
      },
      onClose: (cb) => (closed ? cb() : closeCbs.push(cb)),
    };
  });
}

// Both OS-fact injects are Effects — `processIdentityAsync(bin)` and
// `osfactsSocketHolders(bin)` from `osfacts-client`, bound to ONE resolved
// binary path. The daemon half's SYNC `ReadProcessIdentity` is a different
// inject for a different job (the gate claim); it does not fit here.
export function bootSupervisor(
  readProcessIdentity: import("@kolu/surface-daemon-supervisor").ReadProcessIdentityAsync,
  readSocketHolders: import("@kolu/surface-daemon-supervisor").ReadSocketHolders,
): Effect.Effect<void, unknown> {
  // #region endpoint
  const policy: ConvergencePolicy<"not-drainable"> = {
    capability: "not-drainable",
    baked,
    onContractSkew: { kind: "recycle" },
    onBuildMismatch: { kind: "nudge-human" },
  };

  const endpoint = createEndpoint<TopClient, TopIdentity>({
    hostId: "local",
    home, // SAME call as the daemon — disagreement impossible
    readProcessIdentity,
    readSocketHolders, // osfacts-client's osfactsSocketHolders(<the same resolved bin>)
    policy,
    probe: probeDaemonIdentity({ capability: "not-drainable" }),
    driver: survivableSpawnDriver({
      binPath: daemonEntry,
      args: [],
      // COMPLETE child env for the detached spawn: the daemon's base plus its
      // locator vars. A partial env here would spawn a daemon with no PATH/HOME.
      env: {
        ...spawnEnvBase(),
        FLEET_TOP_GATE: home.gatePath,
        FLEET_TOP_SOCKET: home.socketPath,
      },
      unitPrefix: "fleet-top",
    }),
    // the framework hands you the path
    connect: (socketPath) => connectTop(socketPath),
    log: stderrLogger(),
    onStatus: (hostId, status) =>
      process.stderr.write(`[supervisor] ${hostId}: ${status.state}\n`),
  });

  return Effect.gen(function* () {
    // #region converge
    // The only boot verb — policy (who I am + how I converge) is fixed on the endpoint.
    const outcome = yield* converge(endpoint);
    // #endregion converge
    process.stderr.write(`converge outcome: ${outcome.kind}\n`);

    // The live recycle: deliberate replace under a connected client.
    yield* recycle(endpoint, {
      capture: Effect.succeed(undefined),
      drain: () => Effect.void,
      reattach: () => Effect.void,
    });
  });
  // #endregion endpoint
}

// The supervisor's OWN baked expectation — the daemon it would spawn.
const baked: ConvergenceIdentity = {
  contractVersion: "1.0",
  build: daemonBuild(readBakedIdentity("FLEET_TOP").staleKey),
};
