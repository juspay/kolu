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

async function until(
  cond: () => Promise<boolean>,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

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

  it("a PTY survives a client disconnect; a fresh client reattaches by id with scrollback", async () => {
    const res = await start();
    if (res.kind !== "serving") throw new Error("expected serving");
    live.push(res.daemon);

    // Client A — a server that spawns a terminal and runs a marked command.
    const a = await unixSocketLink<typeof ptyHostSurface.contract>({
      socketPath,
    });
    const { id } = await a.client.surface.terminal.spawn({ cwd: dir });
    await a.client.surface.terminal.write({
      id,
      data: "echo MARK-REATTACH-42\n",
    });
    await until(
      async () =>
        (await a.client.surface.terminal.getScreenText({ id })).text.includes(
          "MARK-REATTACH-42",
        ),
      "the marker to appear in client A",
    );
    // The server goes away (a deploy) — but the daemon (and the PTY) survive.
    a.dispose();

    // Client B — the freshly-restarted server. The PTY is still there, by id,
    // with its scrollback intact: this IS what surviving a server restart means.
    const b = await unixSocketLink<typeof ptyHostSurface.contract>({
      socketPath,
    });
    try {
      const { entries } = await b.client.surface.terminal.list({});
      expect(entries.map((e) => e.id)).toContain(id);
      const { text } = await b.client.surface.terminal.getScreenText({ id });
      expect(text).toContain("MARK-REATTACH-42");
      await b.client.surface.terminal.kill({ id });
    } finally {
      b.dispose();
    }
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
