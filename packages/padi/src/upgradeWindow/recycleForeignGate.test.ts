import { dirname } from "node:path";
/**
 * Recycle vs a foreign gate — pins what master actually does when the new
 * supervisor meets a previous-build (or garbage) gate.
 *
 * Two arms, both driven through the REAL supervisor endpoint (`createEndpoint`
 * → `ensure` = always-recycle boot) against the yesterday-daemon fixture:
 *
 *   (a) current gate shape + accepting socket → the live holder is SIGTERM'd,
 *       a fresh daemon is spawned, and a fresh gate is written by the spawn
 *       path (here the driver's spawn stands in for that write).
 *   (b) foreign/garbage gate shape → `gatePid` returns undefined, so
 *       `liveServingHolder` finds no holder; ensure proceeds to spawn WITHOUT
 *       killing the (unrelated) fixture child. The foreign gate is left for
 *       the fresh daemon's own `acquirePidGate` to reap (malformed → stale →
 *       unlink) — that disposition is pinned here via `acquirePidGate` itself.
 *
 * Named outcomes only: never a silent no-op recycle. Mutate-to-prove: if the
 * current-shape arm stopped killing, the survivor would still be live after
 * ensure; if the foreign arm started killing strangers, the fixture child
 * would die.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { afterEach, expect, it } from "vitest";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { acquirePidGate, gatePid, isHolderLive } from "@kolu/surface-daemon";
import {
  createEndpoint,
  destructiveRecycleSteps,
  type EndpointStatus,
  recycle,
} from "@kolu/surface-daemon-supervisor";
import { plantYesterdayDaemon } from "./yesterdayDaemon.fixture.testlib.ts";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const servers: Server[] = [];
const fixtures: Array<{ dispose: () => Promise<void> }> = [];

afterEach(async () => {
  for (const s of servers.splice(0)) {
    // Destroy accepted peers so close() settles (Node's Server typing omits
    // closeAllConnections on older @types/node; the runtime method exists).
    (
      s as Server & { closeAllConnections?: () => void }
    ).closeAllConnections?.();
    s.close();
  }
  for (const f of fixtures.splice(0)) await f.dispose();
});

type Identity = { staleKey: string };

/** A fake accept-server the driver's spawn "starts" by listening. */
function fakeListen(socketPath: string): {
  server: Server;
  listen: () => Promise<void>;
} {
  const server = createServer((sock) => {
    sock.on("error", () => {});
  });
  return {
    server,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => {
          server.off("error", reject);
          resolve();
        });
      }),
  };
}

describeDaemon("recycle vs a foreign gate (upgrade-window)", () => {
  it("(a) current gate shape: ensure recycles the live holder and spawns fresh", async () => {
    const d = await plantYesterdayDaemon({ gate: { kind: "current" } });
    fixtures.push(d);
    const survivorPid = d.pid as number;
    const survivorExited = new Promise<void>((resolve) => {
      d.child?.once("exit", () => resolve());
    });

    // Close the fixture's accept server BEFORE ensure's post-kill spawn — the
    // driver's spawn re-binds the same path. The gate + live pid are what
    // prove the recycle; the fixture socket only had to be accepting during
    // liveServingHolder's probe (already recorded via plant).
    // Actually: ensure probes socketAccepting while the survivor is live, so
    // keep the fixture server up until after ensure starts, then the kill
    // happens, then spawn needs the path free. Close in the driver.spawn.
    let spawned = false;
    const statuses: EndpointStatus<Identity>[] = [];
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      home: {
        dir: dirname(d.socketPath),
        gatePath: d.gatePath,
        socketPath: d.socketPath,
      },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: {
        spawn: async () => {
          // The recycle must have killed the survivor before we spawn.
          expect(isHolderLive(survivorPid)).toBe(false);
          spawned = true;
          // Free the path the fixture held, then re-bind for the fresh connect.
          await new Promise<void>((resolve) => {
            const srv = d.server as
              | (Server & { closeAllConnections?: () => void })
              | undefined;
            srv?.closeAllConnections?.();
            srv?.close(() => resolve());
            if (!srv) resolve();
          });
          const fresh = fakeListen(d.socketPath);
          servers.push(fresh.server);
          await fresh.listen();
          // Write a fresh current-shape gate naming THIS test process (the
          // real kaval would claim it via acquirePidGate).
          writeFileSync(d.gatePath, `${process.pid}\n`);
        },
      },
      connect: async (_socketPath) => ({
        client: "fresh",
        identity: { staleKey: "fresh" },
        startedAt: Date.now(),
        dispose() {},
        onClose() {},
      }),
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await recycle(endpoint, destructiveRecycleSteps());
    await survivorExited;
    expect(spawned).toBe(true);
    expect(isHolderLive(survivorPid)).toBe(false);
    // Fresh gate is current-shape and names a live pid (this process).
    expect(gatePid(d.gatePath)).toBe(process.pid);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "fresh" });
    expect(statuses.map((s) => s.state)).toContain("connected");
  });

  it("(b) foreign gate shape: ensure does NOT kill the fixture child; acquirePidGate reaps the garbage and proceeds", async () => {
    const d = await plantYesterdayDaemon({
      gate: { kind: "foreign", content: "not-a-pid-at-all\n" },
      // No accepting socket under the foreign gate — liveServingHolder needs
      // BOTH a parsable live pid AND an accepting socket. Foreign → no pid →
      // no holder, so ensure goes straight to spawn.
      withSocket: false,
    });
    fixtures.push(d);
    const fixturePid = d.pid as number;
    let fixtureDied = false;
    d.child?.once("exit", () => {
      fixtureDied = true;
    });

    // Pin the NAMED disposition of a foreign gate under acquirePidGate first:
    // malformed content is treated as stale, unlinked, and the gate is claimed.
    // (This is what a fresh kaval does after ensure spawns it.)
    const foreignContent = readFileSync(d.gatePath, "utf8");
    expect(foreignContent).toBe("not-a-pid-at-all\n");
    expect(gatePid(d.gatePath)).toBeUndefined();

    const claim = acquirePidGate(d.gatePath);
    expect(claim.kind).toBe("acquired");
    expect(gatePid(d.gatePath)).toBe(process.pid);
    if (claim.kind === "acquired") claim.release();

    // Re-plant foreign for the ensure arm (release removed the gate).
    writeFileSync(d.gatePath, "not-a-pid-at-all\n");

    let spawned = false;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      home: {
        dir: dirname(d.socketPath),
        gatePath: d.gatePath,
        socketPath: d.socketPath,
      },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: {
        spawn: async () => {
          spawned = true;
          const fresh = fakeListen(d.socketPath);
          servers.push(fresh.server);
          await fresh.listen();
        },
      },
      connect: async (_socketPath) => ({
        client: "fresh",
        identity: { staleKey: "fresh" },
        startedAt: Date.now(),
        dispose() {},
        onClose() {},
      }),
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
    });

    await recycle(endpoint, destructiveRecycleSteps());
    // Give any (erroneous) SIGTERM a tick to land.
    await new Promise((r) => setTimeout(r, 50));

    expect(spawned).toBe(true);
    // NAMED master behavior: a foreign/unparsable gate is NOT a live holder, so
    // ensure never kills the fixture child. (Killing a stranger would be the
    // silent-wrong path this pin forbids.)
    expect(fixtureDied).toBe(false);
    expect(isHolderLive(fixturePid)).toBe(true);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "fresh" });
  });

  it("garbage gate is reaped by acquirePidGate (named stale-reap, never silent hold)", async () => {
    // Standalone pin of the same disposition the foreign arm relies on — the
    // gate format primitive both generations share. Mutate-to-prove: if
    // gatePid started accepting the garbage, acquire would treat a non-live
    // "pid" differently; today garbage → undefined → stale reap.
    const d = await plantYesterdayDaemon({
      gate: { kind: "foreign", content: '{"v":99}\n' },
      withSocket: false,
    });
    fixtures.push(d);

    expect(gatePid(d.gatePath)).toBeUndefined();
    const gate = acquirePidGate(d.gatePath);
    expect(gate.kind).toBe("acquired");
    expect(gatePid(d.gatePath)).toBe(process.pid);
    if (gate.kind === "acquired") gate.release();
    expect(existsSync(d.gatePath)).toBe(false);
  });
});
