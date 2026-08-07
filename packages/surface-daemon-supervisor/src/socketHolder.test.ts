/**
 * The socket-holder inject, end to end against the REAL binary.
 *
 * These pins (gated, real child, real socket) prove the injected reader sits
 * on the binary the composition roots resolve — that osfacts, the fold in
 * `osfacts-client`, and the pid the OS actually reports agree. The fold's own
 * unit pins live beside it, upstream in `client-ts/src/client.test.ts`
 * (juspay/osfacts, which runs them): a suite
 * that only exercised hand-written documents would prove the parse and nothing
 * about the path that runs, which is what this file is for.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { readSocketHoldersForKoluTests } from "./createEndpoint.kolu.testlib.ts";
import type { SocketOccupancy } from "./socketHolder.ts";

/** The reader is an Effect now, and a test IS a process edge — so the run lives
 *  here once rather than at each of the six asks below. */
const readHolders = (socketPath: string): Promise<SocketOccupancy> =>
  Effect.runPromise(readSocketHoldersForKoluTests(socketPath));

const children: number[] = [];
afterEach(async () => {
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // gone
    }
  }
  await new Promise((r) => setTimeout(r, 20));
});

function spawnHolder(socketPath: string): Promise<number> {
  // The runtime spawn leash at the fork site itself (F5): this helper forks a real,
  // long-lived child, so a gate-off vitest worker that reached it through indirection
  // throws here rather than forking. A no-op under the gate (where these tests run).
  assertDaemonSpawnAllowed("a socket-holder child");
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

/** Every pid the reading names, or `[]` on an arm that names nobody. */
async function heldPids(socketPath: string): Promise<number[]> {
  const reading = await readHolders(socketPath);
  return reading.kind === "held" ? reading.holders.map((h) => h.pid) : [];
}

describeDaemon("the injected reader, against the real binary", () => {
  it("names the exact pid + command holding a bound socket path", async () => {
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    const socketPath = join(d, "held.sock");
    const pid = await spawnHolder(socketPath);

    const reading = await readHolders(socketPath);

    expect(reading.kind).toBe("held");
    if (reading.kind !== "held") return;
    const holder = reading.holders.find((h) => h.pid === pid);
    expect(holder).toBeDefined();
    // osfacts' short display name — the executable's basename, the same fact
    // on both platforms (the old reader said `cmdline` on linux and `lsof`'s
    // command name on darwin, so the two never agreed).
    expect(holder?.command).toMatch(/node/i);
  });

  it("names nobody for a path nobody ever bound", async () => {
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));

    expect(await heldPids(join(d, "nobody.sock"))).toEqual([]);
  });

  it("finds a holder whose socket PATH CONTAINS A SPACE", async () => {
    // A caller-supplied `--pty-host-socket` path may contain spaces, and the
    // linux table emits that column unquoted — the parse rule a whitespace
    // split gets wrong, end to end through the real binary.
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    const spaced = join(d, "with space");
    mkdirSync(spaced);
    const socketPath = join(spaced, "held.sock");
    const pid = await spawnHolder(socketPath);

    expect(await heldPids(socketPath)).toContain(pid);
  });

  it("stops naming the holder once it exits (no stale pid)", async () => {
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    const socketPath = join(d, "held.sock");
    const pid = await spawnHolder(socketPath);
    expect(await heldPids(socketPath)).toContain(pid);

    process.kill(pid, "SIGKILL");
    children.splice(children.indexOf(pid), 1);
    // Wait for the kernel to drop the socket binding. The FILE survives — a
    // reader answering from the filesystem would still name the dead pid.
    await new Promise((r) => setTimeout(r, 80));

    expect(await heldPids(socketPath)).not.toContain(pid);
  });
});
