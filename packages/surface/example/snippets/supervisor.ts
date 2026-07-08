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
  daemonBuild,
  readBakedIdentity,
  stderrLogger,
} from "@kolu/surface-daemon";
import {
  converge,
  type ConvergencePolicy,
  createBuildDrainFence,
  createEndpoint,
  type DaemonConnection,
  dialSocket,
  type PlainProbe,
  restart,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import { stdioLink } from "@kolu/surface/links/stdio";
import type { surface } from "./surface";

const GATE_PATH = "/run/fleet-top/daemon.pid";
const SOCKET_PATH = "/run/fleet-top/daemon.sock";
const daemonEntry = "/nix/store/…/bin/fleet-top-daemon";

/** The contract-typed client the endpoint holds. */
type TopClient = ContractRouterClient<typeof surface.contract>;
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
  const client: TopClient = stdioLink<typeof surface.contract>({
    read: socket,
    write: socket,
  });
  const load = await firstFrame(client.surface.load.get({}));
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

export async function bootSupervisor(): Promise<void> {
  // #region endpoint
  const endpoint = createEndpoint<TopClient, TopIdentity>({
    hostId: "local",
    gatePath: GATE_PATH,
    socketPath: SOCKET_PATH,
    driver: survivableSpawnDriver({
      binPath: daemonEntry,
      args: [],
      env: { FLEET_TOP_GATE: GATE_PATH, FLEET_TOP_SOCKET: SOCKET_PATH },
      unitPrefix: "fleet-top",
    }),
    connect: () => connectTop(SOCKET_PATH), // dial + identity handshake
    log: stderrLogger(),
    onStatus: (hostId, status) =>
      process.stderr.write(`[supervisor] ${hostId}: ${status.state}\n`),
  });

  await endpoint.ensure(); // always-recycle boot = spawn → connect

  // The live recycle: kill the daemon under a connected client and stand a fresh
  // one up. Every step is required; the degenerate steps make no survival promise.
  await restart(endpoint, {
    capture: async () => undefined,
    drain: async () => {},
    reattach: async () => {},
  });
  // #endregion endpoint

  await upgradeInPlace(endpoint);
}

// The supervisor's OWN baked expectation — the daemon it would spawn.
const baked: ConvergenceIdentity = {
  contractVersion: "1.0",
  build: daemonBuild(readBakedIdentity("FLEET_TOP").staleKey),
};

// Read the running daemon's identity over a version-agnostic channel, so a skew
// can't hide it. A daemon with no drain verb yields a `not-drainable` probe.
async function probeIdentity(socketPath: string): Promise<PlainProbe | null> {
  const socket = await dialSocket(socketPath);
  return {
    capability: "not-drainable",
    identity: baked,
    dispose: () => socket.destroy(),
  };
}

async function upgradeInPlace(
  endpoint: Parameters<typeof converge>[0]["endpoint"],
): Promise<void> {
  // #region converge
  // recycle-on-skew (kaval): a mismatched daemon is killed and respawned; a
  // same-contract build change is reported to a human rather than auto-recycled.
  const policy: ConvergencePolicy<"not-drainable"> = {
    capability: "not-drainable",
    onContractSkew: { kind: "recycle" },
    onBuildMismatch: { kind: "nudge-human" },
  };

  const outcome = await converge({
    endpoint,
    baked, // expected build id + contract version
    probe: () => probeIdentity(SOCKET_PATH), // identity over a version-agnostic channel
    policy,
    buildFence: createBuildDrainFence(), // once-per-boot drain fence
    log: stderrLogger(),
  });
  // #endregion converge
  process.stderr.write(`converge outcome: ${outcome.kind}\n`);
}
