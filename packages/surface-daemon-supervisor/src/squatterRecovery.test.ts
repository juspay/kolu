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
import { join } from "node:path";
import { isHolderLive } from "@kolu/surface-daemon";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEndpoint,
  type DaemonConnection,
  DaemonContractSkewError,
  type EndpointStatus,
  isSocketSquatterForeignError,
} from "./endpoint.ts";

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

describe("SQUAT1 — gate-less socket-squatter recovery", () => {
  it("THE squatter: a skewed gate-less holder is identified, recycled, and the fresh daemon binds", async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid"); // deliberately NEVER created → gate-less

    const holderPid = await spawnSocketHolder(socketPath);
    expect(isHolderLive(holderPid)).toBe(true);

    // The injected handshake: the FIRST dial (recovery probing the orphan) skews
    // and self-reports the holder's real pid (attestation 3); the SECOND (the fresh
    // spawn) is compatible.
    let calls = 0;
    const statuses: EndpointStatus<Identity, Meta>[] = [];
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: freshDaemon(socketPath),
      connect: async () => {
        calls += 1;
        if (calls === 1) {
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

    await endpoint.ensure();

    // The squatter is GONE (SIGTERM + waitForPidGone actually reaped it).
    expect(isHolderLive(holderPid)).toBe(false);
    // The endpoint converged to a live connection — never stuck at incompatible.
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
    expect(endpoint.current()?.client).toBe("FRESH");
  });

  it("Foreign holder: a non-kaval process is NEVER killed — loud typed error naming it", async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid");

    const holderPid = await spawnSocketHolder(socketPath);

    const statuses: EndpointStatus<Identity, Meta>[] = [];
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: freshDaemon(socketPath),
      // Never completes the kaval handshake — a plain (non-skew) failure, the way
      // a foreign speaker (or a schema-invalid version response) presents.
      connect: async () => {
        throw new Error("not kaval: connection reset");
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
      adoptConnectAttempts: 2,
      adoptConnectRetryMs: 5,
    });

    await expect(endpoint.ensure()).rejects.toSatisfy(
      isSocketSquatterForeignError,
    );
    // The foreign process is LEFT ALIVE — we never kill what we can't prove is ours.
    expect(isHolderLive(holderPid)).toBe(true);
    // And the endpoint reported `dead`, not a silent hang.
    expect(statuses.map((s) => s.state)).toContain("dead");
    // The error names the culprit's pid + command.
    const err = await endpoint.ensure().catch((e) => e);
    expect(isSocketSquatterForeignError(err)).toBe(true);
    expect(err.holders.some((h: { pid: number }) => h.pid === holderPid)).toBe(
      true,
    );
  });

  it("Pid-absent speaker: a version that fails schema (no self-reported pid) is FOREIGN, not killed", async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid");
    const holderPid = await spawnSocketHolder(socketPath);

    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: freshDaemon(socketPath),
      // A schema-invalid version response surfaces as a plain handshake error
      // (oRPC output validation throws) — the same non-skew path as foreign.
      connect: async () => {
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

    await expect(endpoint.ensure()).rejects.toSatisfy(
      isSocketSquatterForeignError,
    );
    expect(isHolderLive(holderPid)).toBe(true); // never killed
  });

  it("REFUSE policy (adoptOrSpawnOrRefuse / padi): a gate-less skew is left standing + incompatible, NEVER killed (#1313)", async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid"); // gate-less
    const holderPid = await spawnSocketHolder(socketPath);

    const statuses: EndpointStatus<Identity, Meta>[] = [];
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: freshDaemon(socketPath),
      connect: async () => {
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

    const adopted = await endpoint.adoptOrSpawnOrRefuse();
    expect(adopted).toBe(false);
    // A client NEVER SIGTERMs a running (padi) daemon, even a skewed gate-less one.
    expect(isHolderLive(holderPid)).toBe(true);
    // The proven skew is named, not collapsed to dead/degraded.
    expect(statuses.map((s) => s.state)).toContain("incompatible");
    const incompat = statuses.find((s) => s.state === "incompatible");
    expect(incompat?.daemonVersion).toBe("5.0");
    expect(incompat?.requiredVersion).toBe("5.2");
  });

  it("Compatible gate-less holder is ADOPTED, not killed (no PTY-loss regression)", async () => {
    const d = dir();
    const socketPath = join(d, "pty.sock");
    const gatePath = join(d, "kaval.pid");
    const holderPid = await spawnSocketHolder(socketPath);

    const statuses: EndpointStatus<Identity, Meta>[] = [];
    const endpoint = createEndpoint<string, Identity, Meta>({
      hostId: "local",
      gatePath,
      socketPath,
      // The socket is already held by the compatible orphan, so the "spawn" is a
      // no-op that leaves the holder's socket up (as a real fail-to-bind exit does).
      driver: { spawn: async () => {} },
      connect: async () => compatibleConn(),
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpoint.ensure();

    // The compatible holder is preserved (its PTYs survive) — NOT recycled.
    expect(isHolderLive(holderPid)).toBe(true);
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
  });
});
