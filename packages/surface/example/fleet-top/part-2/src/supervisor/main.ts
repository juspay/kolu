/**
 * The supervisor — spawn, watch, and LIVE-recycle the daemon.
 *
 * `createEndpoint` is the supervisor half of the spine (it runs in the CLIENT,
 * never the daemon). It takes the daemon from nothing to a live, handshaken
 * connection and reports every transition:
 *
 *   connecting → connected      (recycled, socket up, handshake passed)
 *   connecting → dead           (couldn't spawn / connect)
 *   connected  → degraded       (the daemon died mid-session)
 *
 * `converge(endpoint)` is the only boot verb: a live survivor is killed, then a
 * fresh daemon is spawned — every boot exercises kill → `waitForPidGone` →
 * spawn → connect (composed from `@kolu/surface-daemon`'s gate primitives).
 * `survivableSpawnDriver` launches the daemon so it OUTLIVES us (systemd-run
 * --user under a service; detached + unref otherwise).
 *
 * The finale is the LIVE recycle under a connected client: `recycle` runs the
 * fixed `capture → drain → recycle → reattach` sequence. This demo makes no
 * survival promise, so it supplies the degenerate steps (B2's boot recycle);
 * part 3's remote fan-out is where the same sequence carries real per-host
 * session state. The client we hold reconnects on the far side of the recycle.
 */

import { fileURLToPath } from "node:url";
import type { StreamingProcedure } from "@kolu/surface/client";
import { stderrLogger } from "@kolu/surface-daemon";
import {
  converge,
  createEndpoint,
  recycle,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import { Effect, Option, Stream } from "effect";
import {
  bakedOsFactsBin,
  osfactsSocketHolders,
  processIdentityAsync,
} from "osfacts-client";
import { GATE_PATH, HOME, SOCKET_PATH } from "../common/paths";
import type { Memory } from "../common/surface";
import { connectTop, type TopClient, type TopIdentity } from "./connect";

/** The first frame of a snapshot-then-deltas member. */
async function snapshot<T>(
  stream: Stream.Stream<T, unknown>,
  what: string,
): Promise<T> {
  const head = await Effect.runPromise(Stream.runHead(stream));
  if (Option.isNone(head)) {
    throw new Error(`${what}: stream closed before its snapshot frame`);
  }
  return head.value;
}

async function main(): Promise<void> {
  const log = stderrLogger();

  // The daemon binary the driver spawns. In a Nix build this is the realised
  // executable; from source we point `node` at the daemon entry through tsx.
  const daemonEntry = fileURLToPath(
    new URL("../daemon/main.ts", import.meta.url),
  );

  // ONE axis — where this program's osfacts binary lives — resolved ONCE, here,
  // and bound to BOTH OS-fact injects below: a missing bake is a loud boot
  // failure rather than a surprise mid-recovery, and there is only one place to
  // change when the bake moves.
  const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");

  const endpoint = createEndpoint<TopClient, TopIdentity>({
    hostId: "local",
    home: HOME, // SAME home declaration as the daemon — disagreement impossible
    // Async on a supervisor path, so the osfacts spawn never blocks the loop.
    readProcessIdentity: (pid) => processIdentityAsync(osfactsBin, pid),
    // The second OS-fact inject: who holds the rendezvous socket, for the
    // recovery that runs when the gate no longer names the daemon.
    readSocketHolders: osfactsSocketHolders(osfactsBin),
    policy: {
      capability: "not-drainable",
      baked: {
        contractVersion: "1.0",
        build: { kind: "known", id: "fleet-top" },
      },
      onContractSkew: { kind: "recycle" },
      onBuildMismatch: { kind: "nudge-human" },
    },
    probe: async () => null,
    driver: survivableSpawnDriver({
      binPath: process.execPath, // node
      args: ["--import", "tsx/esm", daemonEntry],
      env: {
        FLEET_TOP_GATE: GATE_PATH,
        FLEET_TOP_SOCKET: SOCKET_PATH,
      },
      unitPrefix: "fleet-top",
      // Launched from source (tsx), not a built binary — so the driver forces
      // the detached branch even under a systemd session, and (as an actual from-source
      // launch) must inherit our ambient env (node/PATH/HOME) to run from source. A built
      // binary would omit `fromSource` and pass a complete env.
      fromSource: { inheritParentEnv: true },
    }),
    // the framework hands you the path
    connect: (socketPath) => connectTop(socketPath),
    log,
    onStatus: (hostId, status) =>
      process.stderr.write(`[supervisor] ${hostId}: ${status.state}\n`),
  });

  // Boot: always-recycle → spawn → connect. Throws (after reporting `dead`) if
  // it cannot bring the daemon up.
  await converge(endpoint);

  const conn = endpoint.current();
  if (conn === undefined)
    throw new Error("endpoint connected but current() is undefined");
  const mem = await snapshot(
    (conn.client.surface.memory?.get as StreamingProcedure<undefined, Memory>)(
      undefined,
    ),
    "memory",
  );
  process.stderr.write(
    `[supervisor] connected — daemon reports ${conn.identity.cores} cores, ` +
      `${(mem.used / 1e9).toFixed(1)} GB used\n`,
  );

  // The LIVE recycle: kill the daemon under us and stand a fresh one up, with
  // the status held at one honest "restarting". Degenerate steps — nothing to
  // preserve in this part.
  await recycle(endpoint, {
    capture: async () => undefined,
    drain: async () => {},
    reattach: async () => {},
  });
  process.stderr.write("[supervisor] live recycle complete\n");

  endpoint.current()?.dispose();
}

main().catch((err) => {
  process.stderr.write(`supervisor fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
