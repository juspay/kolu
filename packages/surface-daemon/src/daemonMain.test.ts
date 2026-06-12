/**
 * The daemon skeleton's lifecycle — driven entirely in-process, no real signals
 * and no forked children: the gate short-circuit, the serve→abort path, the
 * idle-timeout path, and the readiness hook. (A real spawned `kaval` over its
 * socket is exercised in kaval's e2e; this pins the mechanism in isolation,
 * including the `idleTimeout` lifetime that kaval itself never uses — the proof
 * the skeleton is parameterized, not a single program's internals.)
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type DaemonSpec, daemonMain } from "./daemonMain.ts";
import type { Logger } from "./logger.ts";
import { gatePid, isHolderLive } from "./pidGate.ts";

/** The supervisor's read, composed from the shared primitives: the live
 *  holder's pid, or `undefined` (absent, malformed, or stale). */
function liveHolder(gatePath: string): number | undefined {
  const pid = gatePid(gatePath);
  return pid !== undefined && isHolderLive(pid) ? pid : undefined;
}

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// The router is never invoked in these tests (no RPC is made) — only bound —
// so an empty object stands in for a real surface router.
const noRouter = {} as DaemonSpec["router"];

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

function liveChild(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  children.push(child);
  if (child.pid === undefined) throw new Error("child failed to start");
  return child.pid;
}

/** A fresh private (0700) dir with gate + socket paths under it. */
function paths(): { dir: string; gatePath: string; socketPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "kaval-daemon-"));
  return {
    dir,
    gatePath: join(dir, "daemon.pid"),
    socketPath: join(dir, "daemon.sock"),
  };
}

describe("daemonMain", () => {
  it("yields to a live instance without serving (already-running)", async () => {
    const { gatePath, socketPath } = paths();
    const otherPid = liveChild();
    writeFileSync(gatePath, `${otherPid}\n`);

    const exit = await daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "forever" },
      log: silentLog,
    });

    expect(exit).toEqual({ kind: "already-running", pid: otherPid });
    // It never bound a socket of its own.
    expect(existsSync(socketPath)).toBe(false);
  });

  it("serves, then shuts down on abort — releasing the gate and socket", async () => {
    const { gatePath, socketPath } = paths();
    const ac = new AbortController();
    let ready!: () => void;
    const readyP = new Promise<void>((r) => {
      ready = r;
    });

    const exitP = daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "forever" },
      log: silentLog,
      signal: ac.signal,
      onReady: () => ready(),
    });

    await readyP;
    expect(liveHolder(gatePath)).toBe(process.pid); // gate held while serving
    ac.abort();

    expect(await exitP).toEqual({ kind: "shutdown", reason: "abort" });
    expect(liveHolder(gatePath)).toBeUndefined(); // gate released
    expect(existsSync(socketPath)).toBe(false); // socket removed
  });

  it("shuts down on continuous idleness (idleTimeout)", async () => {
    const { gatePath, socketPath } = paths();
    const exit = await daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "idleTimeout", ms: 30, isIdle: () => true },
      log: silentLog,
    });
    expect(exit).toEqual({ kind: "shutdown", reason: "idle" });
    expect(liveHolder(gatePath)).toBeUndefined();
  });

  it("does not time out while activity keeps it busy", async () => {
    const { gatePath, socketPath } = paths();
    let busy = true;
    const ac = new AbortController();
    let ready!: () => void;
    const readyP = new Promise<void>((r) => {
      ready = r;
    });

    const exitP = daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "idleTimeout", ms: 20, isIdle: () => !busy },
      log: silentLog,
      signal: ac.signal,
      onReady: () => ready(),
    });

    await readyP;
    // Stay busy well past the idle window, then confirm it is still serving.
    await new Promise((r) => setTimeout(r, 80));
    expect(liveHolder(gatePath)).toBe(process.pid);
    busy = false; // now let it go idle
    expect(await exitP).toEqual({ kind: "shutdown", reason: "idle" });
  });

  it("fires onReady with the socket path and pid once listening", async () => {
    const { gatePath, socketPath } = paths();
    const ac = new AbortController();
    const seen: Array<{ socketPath: string; pid: number }> = [];

    const exitP = daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "forever" },
      log: silentLog,
      signal: ac.signal,
      onReady: (info) => seen.push(info),
    });

    // Give the bind a beat, then tear down.
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await exitP;

    expect(seen).toEqual([{ socketPath, pid: process.pid }]);
  });
});
