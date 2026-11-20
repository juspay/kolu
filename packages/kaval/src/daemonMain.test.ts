import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DaemonExit } from "@kolu/surface-daemon";
import { afterEach, describe, expect, it } from "vitest";
import { runKavalDaemon } from "./daemonMain.ts";
import { KAVAL_GATE_FILE, writeStateRootManifest } from "./socketPath.ts";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const started: Array<{ ac: AbortController; exit: Promise<DaemonExit> }> = [];
afterEach(async () => {
  for (const d of started.splice(0)) {
    d.ac.abort();
    await d.exit.catch(() => {});
  }
});

interface Started {
  socketPath: string;
  gatePath: string;
  dir: string;
  ready: Promise<void>;
  exit: Promise<DaemonExit>;
}

function startKaval(opts: { stateRoot?: string }): Started {
  const dir = mkdtempSync(join(tmpdir(), "kaval-selfexit-"));
  const socketPath = join(dir, "pty-host.sock");
  if (opts.stateRoot !== undefined) writeStateRootManifest(dir, opts.stateRoot);
  const ac = new AbortController();
  let resolveReady: () => void;
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });
  const exit = runKavalDaemon({
    socketOverride: socketPath,
    log: silentLog,
    signal: ac.signal,
    stateRootPollMs: 20,
    onReady: () => resolveReady(),
  });
  started.push({ ac, exit });
  return { socketPath, gatePath: join(dir, KAVAL_GATE_FILE), dir, ready, exit };
}

describe("kaval daemon — state-root self-exit", () => {
  it("shuts itself down (socket + gate released) when its state-root is deleted", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "kaval-stateroot-"));
    const d = startKaval({ stateRoot });
    await d.ready;
    expect(existsSync(d.socketPath)).toBe(true);
    expect(existsSync(d.gatePath)).toBe(true);

    rmSync(stateRoot, { recursive: true, force: true });

    const result = await d.exit;
    expect(result).toEqual({ kind: "shutdown", reason: "anchor-gone" });
    expect(existsSync(d.socketPath)).toBe(false);
    expect(existsSync(d.gatePath)).toBe(false);
  }, 15000);

  it("stays up while its state-root exists (no false-trigger on a live root)", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "kaval-stateroot-"));
    const d = startKaval({ stateRoot });
    await d.ready;

    const outcome = await Promise.race([
      d.exit.then(() => "exited" as const),
      sleep(200).then(() => "up" as const),
    ]);
    expect(outcome).toBe("up");
    expect(existsSync(d.socketPath)).toBe(true);
    rmSync(stateRoot, { recursive: true, force: true });
  }, 15000);

  it("never watches a standalone kaval (no state-root manifest)", async () => {
    const d = startKaval({});
    await d.ready;
    const outcome = await Promise.race([
      d.exit.then(() => "exited" as const),
      sleep(200).then(() => "up" as const),
    ]);
    expect(outcome).toBe("up");
    expect(existsSync(d.socketPath)).toBe(true);
  }, 15000);
});
