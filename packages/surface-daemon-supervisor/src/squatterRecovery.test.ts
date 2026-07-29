/**
 * SQUAT1 — the gate-less socket-squatter recovery pins.
 *
 * The wedge: a kaval orphan whose gate file is gone but which still HOLDS the
 * rendezvous socket. `liveServingHolder` is gate-only, so recycle never targets
 * it; the fresh spawn cannot bind and handshakes the orphan into an endless
 * `incompatible` (field case: sincereintent 25494). These pins manufacture the
 * exact state with a REAL child process holding a REAL unix socket — the only way
 * to truthfully exercise the OS socket-holder lookup, the identity cross-check,
 * and the actual SIGTERM + `waitForPidGone`.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { isHolderLive } from "@kolu/surface-daemon";
import { afterEach, expect, it } from "vitest";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import {
  type DaemonConnection,
  DaemonContractSkewError,
  type EndpointStatus,
  isSocketSquatterForeignError,
} from "./endpoint.ts";
import { createEndpointForTest as createEndpoint } from "./createEndpoint.testlib.ts";

import { endpointPrivate } from "./endpoint.private.ts";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

type Identity = { staleKey: string };
type Meta = { contractVersion: string };

const servers: Server[] = [];
const children: number[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) s.close();
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  // Give SIGKILLed children a tick to actually leave before the next case.
  await new Promise((r) => setTimeout(r, 20));
});

function dir(): string {
  return mkdtempSync(join(tmpdir(), "sds-squat-"));
}

/** Spawn a REAL child process that binds `socketPath` and idles until killed —
 *  the gate-less squatter. Resolves its pid once the socket is accepting. The pid
 *  is tracked for teardown. */
function spawnSocketHolder(socketPath: string): Promise<number> {
  // The runtime spawn leash at the fork site itself (F5): this helper forks a real,
  // long-lived child, so a gate-off vitest worker that reached it through indirection
  // throws here rather than forking. A no-op under the gate (where these tests run).
  assertDaemonSpawnAllowed("a gate-less socket squatter");
  const script = `
    const net = require("node:net");
    const srv = net.createServer(() => {});
    srv.listen(process.argv[1], () => process.stdout.write("READY\\n"));
    setInterval(() => {}, 1 << 30);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, socketPath], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.on("error", reject);
    child.stdout?.on("data", (b: Buffer) => {
      if (b.toString().includes("READY") && child.pid !== undefined) {
        children.push(child.pid);
        resolve(child.pid);
      }
    });
  });
}

/** A fresh in-process daemon the driver "spawns" once the squatter is gone — it
 *  clears any stale socket file first (as `serveOverUnixSocket` does), then binds.
 *  This is the successor that must survive: the squatter is already reaped, so no
 *  later `close()` can unlink it (F1 dissolved by removal). */
function freshDaemon(socketPath: string): { spawn: () => Promise<void> } {
  return {
    spawn: async () => {
      try {
        unlinkSync(socketPath);
      } catch {
        // nothing stale to clear
      }
      const server = createServer(() => {});
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => resolve());
      });
    },
  };
}

const compatibleConn = (): DaemonConnection<string, Identity, Meta> => ({
  client: "FRESH",
  identity: { staleKey: "fresh" },
  startedAt: 222,
  metadata: { contractVersion: "5.2" },
  dispose() {},
  onClose() {},
});

describeDaemon("SQUAT1 — gate-less socket-squatter recovery", () => {
  it("THE squatter: a skewed gate-less holder is identified, recycled, and the fresh daemon binds", async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid"); // deliberately NEVER created → gate-less

    const holderPid = await spawnSocketHolder(socketPath);
    expect(isHolderLive(holderPid)).toBe(true);

    // The injected handshake models reality by the holder's LIVENESS: while the
    // skewed orphan is alive it skews on EVERY dial (the identify AND the fresh
    // re-attestation immediately before the kill, self-reporting its real pid);
    // once it's SIGTERM'd, the fresh spawn's dial is compatible.
    const statuses: EndpointStatus<Identity, Meta>[] = [];
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
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
      driver: freshDaemon(socketPath),
      connect: async (_socketPath) => {
        if (isHolderLive(holderPid)) {
          throw new DaemonContractSkewError({
            subject: "pty-host",
            daemonVersion: "5.0",
            requiredVersion: "5.2",
            pid: holderPid, // the orphan names its own pid over the socket
          });
        }
        return compatibleConn();
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
      adoptConnectRetryMs: 5,
    });

    await endpointPrivate(endpoint).ensure();

    // The squatter is GONE (SIGTERM + waitForPidGone actually reaped it).
    expect(isHolderLive(holderPid)).toBe(false);
    // The endpoint converged to a live connection — never stuck at incompatible.
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
    expect(endpoint.current()?.client).toBe("FRESH");
  });

  // 15s — under a saturated localhost CI fanout the OS socket-holder scan +
  // ensure path can exceed vitest's default 5s without being wrong (reran red
  // twice on bd72d3d@x86_64-linux localhost). Keep the pin strict on behaviour.
  it("Foreign holder: a non-kaval process is NEVER killed — loud typed error naming it", {
    timeout: 15_000,
  }, async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid");

    const holderPid = await spawnSocketHolder(socketPath);

    const statuses: EndpointStatus<Identity, Meta>[] = [];
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
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
      driver: freshDaemon(socketPath),
      // Never completes the kaval handshake — a plain (non-skew) failure, the way
      // a foreign speaker (or a schema-invalid version response) presents.
      connect: async (_socketPath) => {
        throw new Error("not kaval: connection reset");
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
      adoptConnectAttempts: 2,
      adoptConnectRetryMs: 5,
    });

    const err = await endpointPrivate(endpoint)
      .ensure()
      .then(
        () => {
          throw new Error("expected the foreign socket holder to be rejected");
        },
        (caught: unknown) => caught,
      );
    expect(isSocketSquatterForeignError(err)).toBe(true);
    if (!isSocketSquatterForeignError(err)) return;

    // The foreign process is LEFT ALIVE — we never kill what we can't prove is ours.
    expect(isHolderLive(holderPid)).toBe(true);
    // And the endpoint reported `dead`, not a silent hang.
    expect(statuses.map((s) => s.state)).toContain("dead");
    // The error names the culprit's pid + command.
    expect(err.holders.some((h: { pid: number }) => h.pid === holderPid)).toBe(
      true,
    );
  });

  it("Pid-absent speaker: a version that fails schema (no self-reported pid) is FOREIGN, not killed", {
    timeout: 15_000,
  }, async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid");
    const holderPid = await spawnSocketHolder(socketPath);

    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
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
      driver: freshDaemon(socketPath),
      // A schema-invalid version response surfaces as a plain handshake error
      // (oRPC output validation throws) — the same non-skew path as foreign.
      connect: async (_socketPath) => {
        throw new Error(
          "pty-host handshake failed — could not read system.version",
        );
      },
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
      adoptConnectAttempts: 1,
      adoptConnectRetryMs: 5,
    });

    await expect(endpointPrivate(endpoint).ensure()).rejects.toSatisfy(
      isSocketSquatterForeignError,
    );
    expect(isHolderLive(holderPid)).toBe(true); // never killed
  });

  const skew = (pid: number): DaemonContractSkewError =>
    new DaemonContractSkewError({
      subject: "pty-host",
      daemonVersion: "5.0",
      requiredVersion: "5.2",
      pid,
    });

  // Real SIGTERM + waitForPidGone under a busy CI host can exceed vitest's
  // default 5s; pin a 15s budget so the OS path, not the timer, is the gate.
  it("F4 seq-1: a gate-less PRIMARY squatter is recovered BEFORE the legacy hint is consulted (not masked)", {
    timeout: 15_000,
  }, async () => {
    const d = dir();
    const primarySock = join(d, "primary.sock");
    const hintSock = join(d, "hint.sock");
    const primaryPid = await spawnSocketHolder(primarySock); // gate-less skew at primary
    let hintDialed = false;
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      home: {
        dir: d,
        gatePath: join(d, "primary.pid"), // gate-less
        socketPath: primarySock,
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
      driver: freshDaemon(primarySock),
      connect: async (_socketPath) =>
        isHolderLive(primaryPid)
          ? Promise.reject(skew(primaryPid))
          : compatibleConn(),
      adoptHint: {
        home: {
          dir: dirname(hintSock),
          gatePath: join(d, "hint.pid"),
          socketPath: hintSock,
        },
        connect: async (_socketPath) => {
          hintDialed = true;
          return compatibleConn();
        },
      },
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
      adoptConnectRetryMs: 5,
    });

    const adopted = await endpointPrivate(endpoint).adoptOrEnsure();
    expect(isHolderLive(primaryPid)).toBe(false); // primary squatter recycled...
    expect(hintDialed).toBe(false); // ...before the hint was ever consulted (not masked)
    expect(adopted.kind).toBe("spawned-fresh"); // fresh spawn at the primary
    expect(endpoint.current()?.client).toBe("FRESH");
  });

  it("F4 seq-2: a gate-less HINT holder is recovered, not abandoned (primary free)", async () => {
    const d = dir();
    const primarySock = join(d, "primary.sock"); // free — nothing holds it
    const hintSock = join(d, "hint.sock");
    const hintPid = await spawnSocketHolder(hintSock); // gate-less skew at the hint
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      home: {
        dir: dirname(primarySock),
        gatePath: join(d, "primary.pid"),
        socketPath: primarySock,
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
      driver: freshDaemon(primarySock),
      connect: async (_socketPath) => compatibleConn(), // the fresh primary spawn
      adoptHint: {
        home: {
          dir: dirname(hintSock),
          gatePath: join(d, "hint.pid"),
          socketPath: hintSock,
        },
        connect: async (_socketPath) =>
          isHolderLive(hintPid)
            ? Promise.reject(skew(hintPid))
            : compatibleConn(),
      },
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
      adoptConnectRetryMs: 5,
    });

    await endpointPrivate(endpoint).adoptOrEnsure();
    // The gate-less hint skew is RECYCLED (kaval policy) — not left abandoned; the
    // follow-on spawn lands at the primary, converging the migration.
    expect(isHolderLive(hintPid)).toBe(false);
    expect(endpoint.current()?.client).toBe("FRESH");
  });

  // Two real recycle waits (adopt + ensure); same 15s budget as F4 seq-1 under
  // parallel CI load on a shared host.
  it("F4: a COMPATIBLE gate-less hint is adopted AND recorded as `held` — a later ensure() targets the hint, not the primary", {
    timeout: 15_000,
  }, async () => {
    const d = dir();
    const primarySock = join(d, "primary.sock"); // free
    const hintSock = join(d, "hint.sock");
    const hintPid = await spawnSocketHolder(hintSock); // gate-less holder at the hint
    let hintSkews = false; // after adoption it becomes a skew for the ensure recycle
    let onAdoptedCalled = false;
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      home: {
        dir: dirname(primarySock),
        gatePath: join(d, "primary.pid"),
        socketPath: primarySock,
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
      driver: freshDaemon(primarySock),
      connect: async (_socketPath) => compatibleConn(), // the primary fresh spawn
      adoptHint: {
        home: {
          dir: dirname(hintSock),
          gatePath: join(d, "hint.pid"),
          socketPath: hintSock,
        },
        connect: async (_socketPath) =>
          hintSkews && isHolderLive(hintPid)
            ? Promise.reject(skew(hintPid))
            : compatibleConn(),
        onAdopted: () => {
          onAdoptedCalled = true;
        },
      },
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
      adoptConnectRetryMs: 5,
    });

    // 1) adopt the compatible gate-less hint (primary is free).
    const adopted = await endpointPrivate(endpoint).adoptOrEnsure();
    expect(adopted.kind).toBe("adopted-resident");
    expect(onAdoptedCalled).toBe(true);
    expect(isHolderLive(hintPid)).toBe(true); // adopted, not killed

    // 2) the hint holder is now a skew; ensure() must operate on the HELD hint and
    //    recycle it — killing the hint child. If `held` had wrongly stayed the
    //    primary, ensure would spawn at the free primary and ABANDON the hint daemon.
    hintSkews = true;
    await endpointPrivate(endpoint).ensure();
    expect(isHolderLive(hintPid)).toBe(false);
  });

  it("REFUSE policy (adoptOrSpawnOrRefuse / padi): a gate-less skew is left standing + incompatible, NEVER killed (#1313)", async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid"); // gate-less
    const holderPid = await spawnSocketHolder(socketPath);

    const statuses: EndpointStatus<Identity, Meta>[] = [];
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
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
      driver: freshDaemon(socketPath),
      connect: async (_socketPath) => {
        throw new DaemonContractSkewError({
          subject: "padiSurface",
          daemonVersion: "5.0",
          requiredVersion: "5.2",
          pid: holderPid,
        });
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
      adoptConnectRetryMs: 5,
    });

    const adopted = await endpointPrivate(endpoint).adoptOrSpawnOrRefuse();
    expect(adopted.kind).not.toBe("adopted-resident");
    // A client NEVER SIGTERMs a running (padi) daemon, even a skewed gate-less one.
    expect(isHolderLive(holderPid)).toBe(true);
    // The proven skew is named, not collapsed to dead/degraded.
    expect(statuses.map((s) => s.state)).toContain("incompatible");
    const incompat = statuses.find((s) => s.state === "incompatible");
    expect(incompat?.daemonVersion).toBe("5.0");
    expect(incompat?.requiredVersion).toBe("5.2");
  });

  it("adoptOrEnsure REPORTS adopted (true) for a compatible gate-less holder — so converge reconciles, not parks (F1)", async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid"); // gate-less
    const holderPid = await spawnSocketHolder(socketPath);

    const statuses: EndpointStatus<Identity, Meta>[] = [];
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
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
      // Never spawns — the recovery adopts the proven connection directly.
      driver: {
        spawn: async () => {
          throw new Error(
            "should not spawn: compatible holder is adopted in place",
          );
        },
      },
      connect: async (_socketPath) => compatibleConn(),
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    const adopted = await endpointPrivate(endpoint).adoptOrEnsure();
    expect(adopted.kind).toBe("adopted-resident"); // NOT a blind false → converge reconciles the session
    expect(isHolderLive(holderPid)).toBe(true); // never killed
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
    expect(endpoint.current()?.client).toBe("FRESH");
  });

  it("Compatible gate-less holder is ADOPTED, not killed (no PTY-loss regression)", async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid");
    const holderPid = await spawnSocketHolder(socketPath);

    const statuses: EndpointStatus<Identity, Meta>[] = [];
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
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
      // The socket is already held by the compatible orphan, so the "spawn" is a
      // no-op that leaves the holder's socket up (as a real fail-to-bind exit does).
      driver: { spawn: async () => {} },
      connect: async (_socketPath) => compatibleConn(),
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpointPrivate(endpoint).ensure();

    // The compatible holder is preserved (its PTYs survive) — NOT recycled.
    expect(isHolderLive(holderPid)).toBe(true);
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
  });
});
