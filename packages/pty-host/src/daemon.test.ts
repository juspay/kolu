import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { type Logger, readPidGate } from "kolu-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PtyHostDaemon, runPtyHostDaemon } from "./daemon.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";

const log = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

describe("runPtyHostDaemon", () => {
  let dir: string;
  let socketPath: string;
  let pidPath: string;
  let prevXdg: string | undefined;
  const live: PtyHostDaemon[] = [];

  function start() {
    return runPtyHostDaemon({ socketPath, pidPath, version: "test", log });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kolu-daemon-")); // mkdtemp ⇒ 0700 dir
    socketPath = join(dir, "pty-host.sock");
    pidPath = join(dir, "pty-host.pid");
    // Keep the daemon's default temp root off the real $XDG_RUNTIME_DIR.
    prevXdg = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = dir;
  });
  afterEach(() => {
    for (const d of live.splice(0)) d.close();
    if (prevXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the contract over the socket and writes its pid into the gate", async () => {
    const res = await start();
    expect(res.kind).toBe("serving");
    if (res.kind !== "serving") return;
    live.push(res.daemon);

    expect(readPidGate(pidPath)).toBe(process.pid);

    const conn = await unixSocketLink<typeof ptyHostSurface.contract>({
      socketPath,
    });
    try {
      const version = await conn.client.surface.system.version({});
      expect(version.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
    } finally {
      conn.dispose();
    }
  });

  it("stands down when a live daemon already holds the gate", async () => {
    const first = await start();
    expect(first.kind).toBe("serving");
    if (first.kind === "serving") live.push(first.daemon);

    const second = await start();
    expect(second).toEqual({ kind: "already-running", pid: process.pid });
  });

  it("close() releases the gate and frees the socket for a fresh daemon", async () => {
    const first = await start();
    if (first.kind !== "serving") throw new Error("expected serving");
    first.daemon.close();
    expect(readPidGate(pidPath)).toBeNull();

    // The socket + gate are free, so a fresh daemon can bind again.
    const again = await start();
    expect(again.kind).toBe("serving");
    if (again.kind === "serving") live.push(again.daemon);
  });
});
