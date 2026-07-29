/**
 * The daemon CLIENT half — the blocks the `@kolu/surface-daemon-supervisor`
 * reference and "How to recycle and upgrade a daemon" embed. The endpoint state
 * machine takes the daemon from nothing to a live, handshaken connection;
 * `converge` decides a live upgrade by a declared policy and enacts it.
 *
 * Typechecked, never executed — the endpoint/converge calls live inside
 * functions so nothing spawns at compile time.
 */

import type { ContractRouterClient } from "@orpc/contract";
import {
  type ConvergenceIdentity,
  controlCoreSurface,
  daemonBuild,
  daemonHome,
  readBakedIdentity,
  stderrLogger,
} from "@kolu/surface-daemon";
import { composeSurfaceContracts } from "@kolu/surface/define";
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
import { stdioLink } from "@kolu/surface/links/stdio";
import { surface } from "./surface";

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

/** The contract-typed client the endpoint holds. */
const daemonContract = composeSurfaceContracts({
  app: surface,
  control: controlCoreSurface,
});
type TopClient = ContractRouterClient<typeof daemonContract>;
/** What "identity" means for this daemon — enough to prove the link answered. */
interface TopIdentity {
  loadOne: number;
}

async function firstFrame<T>(
  src: AsyncIterable<T> | Promise<AsyncIterable<T>>,
): Promise<T> {
  for await (const frame of await src) return frame;
  throw new Error("stream closed before its snapshot frame");
}

// `connect` is the supervisor's soul: dial the socket, prove the link answers by
// reading a first frame, and stamp the identity the endpoint reports.
async function connectTop(
  socketPath: string,
): Promise<DaemonConnection<TopClient, TopIdentity>> {
  const socket = await dialSocket(socketPath);
  const client: TopClient = stdioLink<typeof daemonContract>({
    read: socket,
    write: socket,
  });
  const load = await firstFrame(client.surface.app.load.get({}));
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
    dispose: () => socket.destroy(),
    onClose: (cb) => (closed ? cb() : closeCbs.push(cb)),
  };
}

export async function bootSupervisor(
  readProcessIdentity: (
    pid: number,
  ) => Promise<import("@kolu/surface-daemon").ProcessIdentity | undefined>,
): Promise<void> {
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

  // #region converge
  // The only boot verb — policy (who I am + how I converge) is fixed on the endpoint.
  const outcome = await converge(endpoint);
  // #endregion converge
  process.stderr.write(`converge outcome: ${outcome.kind}\n`);

  // The live recycle: deliberate replace under a connected client.
  await recycle(endpoint, {
    capture: async () => undefined,
    drain: async () => {},
    reattach: async () => {},
  });
  // #endregion endpoint
}

// The supervisor's OWN baked expectation — the daemon it would spawn.
const baked: ConvergenceIdentity = {
  contractVersion: "1.0",
  build: daemonBuild(readBakedIdentity("FLEET_TOP").staleKey),
};
