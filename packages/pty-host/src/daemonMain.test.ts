import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import type { Logger } from "kolu-shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseArgv,
  type PtyHostDaemonHandle,
  runPtyHostDaemon,
} from "./daemonMain.ts";
import { servePtyHostRouter } from "./inProcessPtyHost.ts";
import { PTY_HOST_CONTRACT_VERSION } from "./ptyHostSurface.ts";
import type { ptyHostSurface } from "./ptyHostSurface.ts";
import { servePtyHostOverUnixSocket } from "./serveOverSocket.ts";

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const handles: PtyHostDaemonHandle[] = [];
const disposers: Array<() => void> = [];
const tmpDirs: string[] = [];

/** A fresh private (0700, mkdtemp) directory and the socket path inside it —
 *  the dir-privacy gate in `serveOverUnixSocket` is satisfied by mkdtemp. */
function freshSocket(): { socketPath: string; shellDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "kolu-daemon-"));
  tmpDirs.push(dir);
  return {
    socketPath: join(dir, "pty-host.sock"),
    shellDir: join(dir, "shell"),
  };
}

async function start(socketPath: string, shellDir: string, pid?: number) {
  const outcome = await runPtyHostDaemon({
    socketPath,
    shellDir,
    pid,
    version: "test",
    // `just check` runs under a nix devshell (`IN_NIX_SHELL=1`); without a
    // whitelist, `configureNixShellEnv(undefined)` would `process.exit(1)` and
    // tear down the runner. `"default"` is the dev/test choice the harness makes.
    nixEnvWhitelist: "default",
    log: silentLog,
  });
  if (outcome.started) handles.push(outcome.handle);
  return outcome;
}

afterEach(() => {
  for (const d of disposers.splice(0)) d();
  for (const h of handles.splice(0)) h.close();
  for (const d of tmpDirs.splice(0)) spawnSync("rm", ["-rf", d]);
});

describe("parseArgv", () => {
  it("accepts no args (default socket)", () => {
    expect(parseArgv([])).toEqual({ ok: true, socketPath: undefined });
  });

  it("accepts --pty-host-socket PATH (both spellings)", () => {
    expect(parseArgv(["--pty-host-socket", "/run/p.sock"])).toEqual({
      ok: true,
      socketPath: "/run/p.sock",
    });
    expect(parseArgv(["--pty-host-socket=/run/p.sock"])).toEqual({
      ok: true,
      socketPath: "/run/p.sock",
    });
  });

  it("rejects a missing value instead of silently using the default socket", () => {
    expect(parseArgv(["--pty-host-socket"])).toMatchObject({ ok: false });
    // A following flag is not a value.
    expect(parseArgv(["--pty-host-socket", "--other"])).toMatchObject({
      ok: false,
    });
  });

  it("rejects an empty value (both spellings) instead of the default socket", () => {
    // `getRuntimeSocketPath` treats an empty override as absent, so an empty
    // value would silently bind the DEFAULT socket — the exact collision F5 is
    // about. Both the equals-form and the space-separated quoted-empty must fail.
    expect(parseArgv(["--pty-host-socket="])).toMatchObject({ ok: false });
    expect(parseArgv(["--pty-host-socket", ""])).toMatchObject({ ok: false });
  });

  it("rejects an unknown/misspelled flag rather than ignoring it", () => {
    expect(parseArgv(["--pty-host-sockets", "/run/p.sock"])).toMatchObject({
      ok: false,
    });
    expect(parseArgv(["--bogus"])).toMatchObject({ ok: false });
  });
});

describe("runPtyHostDaemon", () => {
  it("serves ptyHostSurface over the socket — system.version round-trips", async () => {
    const { socketPath, shellDir } = freshSocket();
    const outcome = await start(socketPath, shellDir);
    expect(outcome.started).toBe(true);

    const conn = await unixSocketLink<typeof ptyHostSurface.contract>({
      socketPath,
    });
    disposers.push(conn.dispose);

    const version = await conn.client.surface.system.version({});
    expect(version.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
    expect(typeof version.pid).toBe("number");
    // Identity is present in shape (the values are nix-baked env, "" off-nix).
    expect(version.identity).toMatchObject({
      staleKey: expect.any(String),
      navigableCommit: expect.any(String),
    });

    // The served router routes the full surface, not just system.* — a fresh
    // daemon owns no PTYs yet.
    const { entries } = await conn.client.surface.terminal.list({});
    expect(entries).toEqual([]);
  });

  it("refuses a second daemon at the pid-gate while the first is live", async () => {
    const { socketPath, shellDir } = freshSocket();
    const first = await start(socketPath, shellDir);
    if (!first.started) throw new Error("expected the first daemon to start");

    // A contender process (distinct pid) finds the gate held by a live holder.
    const second = await runPtyHostDaemon({
      socketPath,
      shellDir,
      pid: 999_999,
      nixEnvWhitelist: "default",
      log: silentLog,
    });
    expect(second).toEqual({
      started: false,
      reason: "already-running",
      holderPid: first.handle.pid,
    });
  });

  it("the socket refuses a second bind — the already-served tripwire", async () => {
    const { socketPath, shellDir } = freshSocket();
    const first = await start(socketPath, shellDir);
    expect(first.started).toBe(true);

    // Past the gate, the socket is the second line of defence: a direct second
    // bind on the live socket is refused, never silently taken over.
    const second = await servePtyHostOverUnixSocket({
      socketPath,
      router: servePtyHostRouter({ log: silentLog, shellDir, version: "test" }),
      log: silentLog,
    });
    expect(second.listening).toBe(false);
    second.close();
  });

  it("close releases the gate and frees the socket for a fresh start", async () => {
    const { socketPath, shellDir } = freshSocket();
    const first = await start(socketPath, shellDir);
    if (!first.started) throw new Error("expected the first daemon to start");
    first.handle.close();
    handles.length = 0; // already closed

    const second = await start(socketPath, shellDir);
    expect(second.started).toBe(true);
  });
});
