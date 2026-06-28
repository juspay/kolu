import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WATCHDOG_WORKER_SOURCE,
  isStalled,
  startEventLoopWatchdog,
} from "./eventLoopWatchdog.ts";

describe("isStalled", () => {
  it("treats the 0 sentinel as not-yet-started, never a stall", () => {
    // The heartbeat hasn't run once; aborting here would kill a starting-up
    // process before it ever served.
    expect(isStalled(0, 1_000_000, 100)).toBe(false);
  });

  it("is false at or under the threshold, true strictly over it", () => {
    const now = 1_000_000;
    expect(isStalled(now - 50, now, 100)).toBe(false); // well under
    expect(isStalled(now - 100, now, 100)).toBe(false); // exactly at: not >
    expect(isStalled(now - 101, now, 100)).toBe(true); // one ms over
    expect(isStalled(now - 5_000, now, 100)).toBe(true); // long over
  });
});

describe("startEventLoopWatchdog", () => {
  it("starts and stops cleanly without aborting a healthy process", async () => {
    // Threshold far above the test's lifetime so a healthy loop never trips.
    const stop = startEventLoopWatchdog({
      heartbeatMs: 20,
      thresholdMs: 60_000,
      checkMs: 20,
    });
    await new Promise((r) => setTimeout(r, 150));
    stop();
    // Reaching here at all means the watchdog neither threw on start nor
    // aborted the (healthy) test process.
    expect(true).toBe(true);
  });
});

// The faithful proof of the core win: a process whose main loop wedges is
// killed by the worker so a supervisor can restart it. It must run in a CHILD
// process — exercising the abort in-process would kill the test runner. The
// child drives the REAL `WATCHDOG_WORKER_SOURCE`, then blocks its main loop
// forever; the worker must `SIGABRT` it.
describe("the watchdog aborts a wedged process", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-abort-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("SIGABRTs a child whose event loop is blocked past the threshold", {
    timeout: 15_000,
  }, async () => {
    // Plain ESM (.mjs) so the child needs no TS loader — it builds the worker
    // from the real source handed in via env, stamps the heartbeat once, then
    // wedges its main loop so the stamp can never refresh.
    // A scratch dir + sentinel file the worker must remove before it aborts
    // (the SIGABRT path's stand-in for `process.on('exit')` cleanup).
    const scratchDir = path.join(tmpDir, "scratch-root");
    fs.mkdirSync(scratchDir);
    fs.writeFileSync(path.join(scratchDir, "secret.txt"), "pasted image bytes");

    const fixture = `
import { Worker } from "node:worker_threads";
const sab = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT);
const beats = new BigInt64Array(sab);
// Single monotonic heartbeat; the wedge never refreshes it. Must be the SAME
// clock the worker reads (process.hrtime.bigint, not Date.now).
beats[0] = process.hrtime.bigint();
new Worker(process.env.WD_SRC, {
  eval: true,
  execArgv: [],
  workerData: {
    sab,
    thresholdNs: 200 * 1_000_000,
    checkMs: 50,
    cleanupPaths: [process.env.WD_SCRATCH],
  },
});
// Wedge the main loop. The heartbeat interval can't fire, so the stamp goes
// stale and the worker must abort us.
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {}
`;
    const fixturePath = path.join(tmpDir, "wedge.mjs");
    fs.writeFileSync(fixturePath, fixture);

    const child = spawn(process.execPath, [fixturePath], {
      env: {
        ...process.env,
        WD_SRC: WATCHDOG_WORKER_SOURCE,
        WD_SCRATCH: scratchDir,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("watchdog did not abort the wedged child in time"));
      }, 6_000);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });

    // Killed by a signal (SIGABRT), not a clean exit — the worker pulled the
    // ripcord on the wedged loop.
    expect(result.signal === "SIGABRT" || result.code === null).toBe(true);
    // And it explained itself on stderr for the journal/postmortem.
    expect(stderr).toContain("event loop wedged");
    expect(stderr).toContain("event-loop-watchdog");
    // And it cleaned this instance's scratch root before aborting — the SIGABRT
    // path's stand-in for the `process.on('exit')` cleanup it bypasses.
    expect(fs.existsSync(scratchDir)).toBe(false);
  });
});
