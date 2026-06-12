import { fileURLToPath } from "node:url";
import { pidGatePathForSocket, pidIsAlive, readPidGate } from "@kolu/pty-host";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DaemonStatus } from "kolu-common/surface";
import type { Logger } from "kolu-shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type LocalPtyHostEndpoint, ensureLocalEndpoint } from "./endpoint.ts";

// The real daemon, run through the tsx dev launcher (production bakes the nix
// wrapper) — so this exercises the actual spawn → connect → recycle path, not a
// mock. KOLU_PTY_HOST_BIN is what the local driver execs.
const DEV_DAEMON = fileURLToPath(
  new URL("../../../pty-host/bin/kolu-pty-host", import.meta.url),
);

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const endpoints: LocalPtyHostEndpoint[] = [];
const sockets: string[] = [];

let savedBin: string | undefined;
let savedInvocation: string | undefined;
beforeAll(() => {
  savedBin = process.env.KOLU_PTY_HOST_BIN;
  process.env.KOLU_PTY_HOST_BIN = DEV_DAEMON;
  // Force the detached spawn path, not systemd-run: that survival mechanism
  // needs a real user manager (verified by the prod spike + e2e), which a CI
  // unit sandbox may lack. Unsetting INVOCATION_ID makes this test exercise the
  // endpoint's spawn→connect→recycle→survive logic deterministically anywhere a
  // child can be spawned.
  savedInvocation = process.env.INVOCATION_ID;
  delete process.env.INVOCATION_ID;
});
afterAll(() => {
  if (savedBin === undefined) delete process.env.KOLU_PTY_HOST_BIN;
  else process.env.KOLU_PTY_HOST_BIN = savedBin;
  if (savedInvocation !== undefined)
    process.env.INVOCATION_ID = savedInvocation;
});

function freshSocket(): string {
  const dir = mkdtempSync(join(tmpdir(), "kolu-endpoint-"));
  const socketPath = join(dir, "pty-host.sock");
  sockets.push(socketPath);
  return socketPath;
}

/** Reap any daemon a test left alive (it survives `dispose()` by design). */
function reap(socketPath: string): void {
  const pid = readPidGate(pidGatePathForSocket(socketPath));
  if (pid !== null) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

afterEach(async () => {
  for (const e of endpoints.splice(0)) e.dispose();
  for (const s of sockets.splice(0)) reap(s);
  // Give SIGKILLs a beat to land before the next test reuses the runtime.
  await new Promise((r) => setTimeout(r, 50));
});

describe("ensureLocalEndpoint (real daemon)", () => {
  it("spawns + connects the daemon and publishes connected", async () => {
    const socketPath = freshSocket();
    const statuses: DaemonStatus[] = [];
    const endpoint = await ensureLocalEndpoint({
      socketPath,
      log: silentLog,
      publishStatus: (s) => statuses.push(s),
    });
    endpoints.push(endpoint);

    // First transition is connecting; the terminal state is connected.
    expect(statuses[0]?.state).toBe("connecting");
    const last = statuses.at(-1);
    expect(last?.state).toBe("connected");
    expect(typeof last?.startedAt).toBe("number");

    // The injected client really talks to the daemon over the socket.
    const { entries } = await endpoint.client.surface.terminal.list({});
    expect(entries).toEqual([]);

    // The daemon holds its single-instance gate.
    const pid = readPidGate(pidGatePathForSocket(socketPath));
    expect(pid).not.toBeNull();
    expect(pidIsAlive(pid as number)).toBe(true);
  }, 30_000);

  it("recycles a surviving daemon: a fresh endpoint kills it and respawns", async () => {
    const socketPath = freshSocket();
    const first = await ensureLocalEndpoint({
      socketPath,
      log: silentLog,
      publishStatus: () => {},
    });
    const firstPid = readPidGate(pidGatePathForSocket(socketPath));
    expect(firstPid).not.toBeNull();
    // The first endpoint's client is dropped, but the daemon SURVIVES — the
    // recycle must kill it, not adopt it.
    first.dispose();

    const second = await ensureLocalEndpoint({
      socketPath,
      log: silentLog,
      publishStatus: () => {},
    });
    endpoints.push(second);
    const secondPid = readPidGate(pidGatePathForSocket(socketPath));

    expect(secondPid).not.toBeNull();
    expect(secondPid).not.toBe(firstPid); // a genuinely fresh daemon
    expect(pidIsAlive(firstPid as number)).toBe(false); // old one recycled
    // The new daemon serves.
    await expect(
      second.client.surface.system.heartbeat({}),
    ).resolves.toBeDefined();
  }, 30_000);

  it("dispose drops our client but does NOT kill the surviving daemon", async () => {
    const socketPath = freshSocket();
    const endpoint = await ensureLocalEndpoint({
      socketPath,
      log: silentLog,
      publishStatus: () => {},
    });
    const pid = readPidGate(pidGatePathForSocket(socketPath));
    endpoint.dispose();
    // The daemon outlives the server — that is the whole point of Phase B.
    expect(pidIsAlive(pid as number)).toBe(true);
  }, 30_000);
});
