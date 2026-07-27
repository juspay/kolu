/**
 * Pins kaval's state-root self-exit (zombie hygiene): a padi-spawned kaval whose
 * ephemeral state-root is deleted out from under it — an e2e/nix-shell run's temp
 * dir removed when the shell exits — must reap ITSELF rather than linger as a
 * leaked daemon holding a socket forever. The mechanism is the spine's ANCHOR
 * invariant (`@kolu/surface-daemon`, juspay/kolu#2010); what these pin is kaval's
 * WIRING of it — the anchor thunk that re-reads the `state-root` manifest padi
 * writes beside kaval's socket, reaped through the spine's normal teardown
 * (socket unlinked, gate released).
 *
 * A standalone kaval has NO manifest, so its anchor thunk stays `undefined` and
 * it is deliberately never reaped — its reason to exist isn't tied to any
 * state-root. These run the REAL `runKavalDaemon` in-process with a tiny poll
 * interval so the reap is observable in milliseconds.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DaemonExit, Logger } from "@kolu/surface-daemon";
import { afterEach, describe, expect, it } from "vitest";
import { runKavalDaemon } from "./daemonMain.ts";
import { KAVAL_GATE_FILE, writeStateRootManifest } from "./socketPath.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as Logger;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// Every daemon a test starts, tracked so a failing assertion can't leave it
// running: `afterEach` aborts each and awaits its clean exit.
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

/** Start a real kaval daemon on a fresh temp rendezvous dir, polling its
 *  state-root every 20ms. Optionally seed the `state-root` manifest first. */
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

    // Delete the state-root out from under the daemon — the nix-shell/e2e teardown.
    rmSync(stateRoot, { recursive: true, force: true });

    // The daemon reaps itself: its promise resolves as the spine's anchor-gone
    // shutdown and the socket + gate are gone (torn down via the normal path).
    const result = await d.exit;
    expect(result).toEqual({ kind: "shutdown", reason: "anchor-gone" });
    expect(existsSync(d.socketPath)).toBe(false);
    expect(existsSync(d.gatePath)).toBe(false);
  }, 15000);

  it("stays up while its state-root exists (no false-trigger on a live root)", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "kaval-stateroot-"));
    const d = startKaval({ stateRoot });
    await d.ready;

    // Well past several poll intervals (20ms each), the daemon is STILL serving —
    // a live state-root must never trip the self-exit.
    const outcome = await Promise.race([
      d.exit.then(() => "exited" as const),
      sleep(200).then(() => "up" as const),
    ]);
    expect(outcome).toBe("up");
    expect(existsSync(d.socketPath)).toBe(true);
    rmSync(stateRoot, { recursive: true, force: true }); // afterEach reaps the daemon
  }, 15000);

  it("never watches a standalone kaval (no state-root manifest)", async () => {
    // No manifest written — a bare `kaval` daemon. The watcher finds nothing to
    // watch and never self-exits, even across many poll intervals.
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
