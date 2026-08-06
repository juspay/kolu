/**
 * kaval's self-liveness falsifier (juspay/kolu#2101 N2).
 *
 * Drives the REAL mechanism end to end below the process boundary: a real
 * `serveOverUnixSocket` listener carrying the real kaval daemon surface, and the
 * real `startKavalSelfLiveness` loop dialing that socket and reading
 * `system.version` over it. The wedge is applied by taking the listener away —
 * the daemon's own address stops answering while the loop keeps running, which is
 * the shape the loop exists to notice.
 *
 * The exit ITSELF (the G2 fault arm ending the tenure non-zero) is pinned across
 * the process boundary in `socketDaemon.test.ts`; here we pin the decision the
 * arm is wired to.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import {
  serveOverUnixSocket,
  type UnixSocketListener,
} from "@kolu/surface/unix-socket";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveKavalDaemonSurface } from "./daemonSurface.ts";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import {
  isResumeAfterSuspension,
  SELF_PROBE_CEILING,
  SELF_PROBE_INTERVAL_MS,
  SUSPENSION_GAP_MS,
  startKavalSelfLiveness,
} from "./selfLiveness.ts";

/** The loop's cadence under test. Small so a streak is milliseconds, not
 *  half a minute; the CEILING under test is the production one. */
const POLL_MS = 20;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function freshSocketPath(): string {
  return join(mkdtempSync(join(tmpdir(), "kaval-selfprobe-")), "pty-host.sock");
}

async function serveRealKaval(socketPath: string): Promise<{
  listener: UnixSocketListener;
  close: () => Promise<void>;
}> {
  const ptyHost = createInProcessPtyHost({
    log: silentLogger,
    rcDir: mkdtempSync(join(tmpdir(), "kaval-selfprobe-rc-")),
    lifetime: { kind: "forever" },
  });
  const surface = serveKavalDaemonSurface({
    ptyHost,
    stateRoot: mkdtempSync(join(tmpdir(), "kaval-selfprobe-sr-")),
  });
  const listener = await serveOverUnixSocket({
    socketPath,
    group: surface.group,
    handlers: surface.handlers,
    log: silentLogger,
  });
  return {
    listener,
    close: async () => {
      listener.close();
      await surface.close();
    },
  };
}

describe("isResumeAfterSuspension — the wall-clock-jump rule", () => {
  it("an on-time tick is not a resume", () => {
    expect(isResumeAfterSuspension(0)).toBe(false);
  });

  it("a tick late by less than the gap is a busy box, not a resume", () => {
    expect(isResumeAfterSuspension(SUSPENSION_GAP_MS)).toBe(false);
  });

  it("a tick late by more than two cadences is a resume", () => {
    expect(isResumeAfterSuspension(SUSPENSION_GAP_MS + 1)).toBe(true);
    expect(isResumeAfterSuspension(3 * 60 * 60 * 1000)).toBe(true);
  });

  it("the gap is derived from the cadence, not picked", () => {
    expect(SUSPENSION_GAP_MS).toBe(SELF_PROBE_INTERVAL_MS * 2);
  });
});

describe("startKavalSelfLiveness — the daemon proves it can serve, or exits", () => {
  const stops: (() => void)[] = [];
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) stop();
    for (const close of closers.splice(0)) await close();
  });

  it("a HEALTHY daemon never self-exits, over many cadences", async () => {
    const socketPath = freshSocketPath();
    const served = await serveRealKaval(socketPath);
    closers.push(served.close);
    const onExhausted = vi.fn();
    stops.push(
      startKavalSelfLiveness({
        socketPath,
        log: silentLogger,
        onExhausted,
        pollMs: POLL_MS,
      }),
    );
    // Many times the ceiling: a loop that mis-classified a healthy round-trip
    // would have exhausted several budgets over this window.
    await sleep(POLL_MS * SELF_PROBE_CEILING * 8);
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("EXITS when its own address stops answering, and only at the ceiling", async () => {
    const socketPath = freshSocketPath();
    const served = await serveRealKaval(socketPath);
    const onExhausted = vi.fn();
    stops.push(
      startKavalSelfLiveness({
        socketPath,
        log: silentLogger,
        onExhausted,
        pollMs: POLL_MS,
      }),
    );
    // Prove it was healthy first, so the exhaustion below is attributable to the
    // wedge and not to a loop that was failing all along.
    await sleep(POLL_MS * 3);
    expect(onExhausted).not.toHaveBeenCalled();

    // The wedge: the daemon's own address stops answering while the loop runs on.
    await served.close();

    await vi.waitFor(() => expect(onExhausted).toHaveBeenCalledTimes(1), {
      timeout: POLL_MS * SELF_PROBE_CEILING * 20,
    });
    // Fires ONCE and then stands down — the fault arm is not re-armed per tick.
    await sleep(POLL_MS * SELF_PROBE_CEILING * 4);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("a DISARMED loop never fires — a clean shutdown cannot race a fault exit", async () => {
    const socketPath = freshSocketPath();
    const served = await serveRealKaval(socketPath);
    const onExhausted = vi.fn();
    const stop = startKavalSelfLiveness({
      socketPath,
      log: silentLogger,
      onExhausted,
      pollMs: POLL_MS,
    });
    // The shutdown order the daemon uses: disarm, THEN take the listener down.
    stop();
    await served.close();
    await sleep(POLL_MS * SELF_PROBE_CEILING * 8);
    expect(onExhausted).not.toHaveBeenCalled();
  });
});
