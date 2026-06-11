import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PtyHostDaemon, runPtyHostDaemon } from "@kolu/pty-host";
import type { Logger } from "kolu-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DaemonHandle, ensureDaemon } from "./daemonHandle.ts";

const log = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

/** An in-process stand-in for the daemon process: each `spawn()` binds the
 *  socket via the real serve loop; `kill()` closes it and flips liveness so the
 *  wait barrier sees the pid go away (the gate's real pid is the test process,
 *  which never dies, so liveness is injected). */
function fakeDaemonProcess(socketPath: string, pidPath: string) {
  let current: PtyHostDaemon | null = null;
  let killed = false;
  const spawns = vi.fn(async () => {
    killed = false;
    const res = await runPtyHostDaemon({
      socketPath,
      pidPath,
      version: "test",
      log,
    });
    if (res.kind !== "serving") throw new Error(`spawn failed: ${res.kind}`);
    current = res.daemon;
  });
  return {
    spawnDaemon: spawns,
    killDaemon: () => {
      current?.close();
      current = null;
      killed = true;
    },
    isAlive: () => !killed,
    stop: () => current?.close(),
  };
}

describe("ensureDaemon", () => {
  let dir: string;
  let socketPath: string;
  let pidPath: string;
  let prevXdg: string | undefined;
  let handle: DaemonHandle | null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kolu-handle-"));
    socketPath = join(dir, "pty-host.sock");
    pidPath = join(dir, "pty-host.pid");
    prevXdg = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = dir;
    handle = null;
  });
  afterEach(() => {
    handle?.dispose();
    if (prevXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  });

  const fast = { connectTimeoutMs: 5000, pidGoneTimeoutMs: 5000, pollMs: 10 };

  it("spawns a daemon when none survives, then serves the contract", async () => {
    const proc = fakeDaemonProcess(socketPath, pidPath);
    handle = await ensureDaemon({ socketPath, pidPath, log, ...proc, ...fast });

    expect(proc.spawnDaemon).toHaveBeenCalledTimes(1);
    expect(handle.state()).toBe("connected");
    const v = await handle.client.surface.system.version({});
    expect(v.contractVersion).toBeDefined();
  });

  it("reattaches to a surviving daemon without spawning", async () => {
    // A daemon is already up (a prior server left it running).
    const survivor = await runPtyHostDaemon({
      socketPath,
      pidPath,
      version: "test",
      log,
    });
    if (survivor.kind !== "serving") throw new Error("survivor failed");

    const proc = fakeDaemonProcess(socketPath, pidPath);
    handle = await ensureDaemon({ socketPath, pidPath, log, ...proc, ...fast });

    expect(proc.spawnDaemon).not.toHaveBeenCalled();
    const v = await handle.client.surface.system.version({});
    expect(v.contractVersion).toBeDefined();
    survivor.daemon.close();
  });

  it("restart kills the old daemon, waits for exit, respawns, and the stable client follows", async () => {
    const proc = fakeDaemonProcess(socketPath, pidPath);
    handle = await ensureDaemon({ socketPath, pidPath, log, ...proc, ...fast });
    const client = handle.client; // captured once — must survive the restart
    expect(
      (await client.surface.system.version({})).contractVersion,
    ).toBeDefined();

    const verdict = await handle.restart();
    expect(verdict).toBe("ok");
    expect(proc.spawnDaemon).toHaveBeenCalledTimes(2); // initial + respawn
    expect(handle.state()).toBe("connected");
    // The reference captured before the restart still reaches the new daemon.
    expect(
      (await client.surface.system.version({})).contractVersion,
    ).toBeDefined();
  });

  it("degrades but keeps the live connection when the old daemon never exits", async () => {
    const proc = fakeDaemonProcess(socketPath, pidPath);
    handle = await ensureDaemon({
      socketPath,
      pidPath,
      log,
      spawnDaemon: proc.spawnDaemon,
      // killDaemon is a no-op and isAlive stays true → the barrier times out.
      killDaemon: () => {},
      isAlive: () => true,
      ...fast,
      pidGoneTimeoutMs: 60,
    });
    const client = handle.client;
    const verdict = await handle.restart();
    expect(verdict).toBe("failed");
    expect(handle.state()).toBe("degraded");
    // The barrier timed out because the OLD daemon is still alive — so its
    // connection must NOT have been torn down. The handle stays usable
    // (terminals keep working); the UI surfaces degraded + offers a retry.
    expect(
      (await client.surface.system.version({})).contractVersion,
    ).toBeDefined();
    proc.stop();
  });
});
