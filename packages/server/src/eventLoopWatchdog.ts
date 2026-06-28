/**
 * Out-of-loop event-loop watchdog — the backstop for an indefinitely wedged
 * server.
 *
 * On 2026-06-28 a synchronous `git rev-parse` on the watcher-install path
 * (since fixed: see `kolu-git`'s `git-dir.ts`) parked the single Node event
 * loop in `waitpid` for 25 minutes. Nothing recovered it because the freeze
 * was total: every HTTP/WebSocket request hung, and an *in-loop* timer can't
 * fire while the loop it lives on is blocked — so a same-thread watchdog
 * could never have noticed or self-exited during the freeze.
 *
 * The fix for a *total* freeze must live OFF the event loop. This runs a tiny
 * `worker_threads` worker on its own loop. The main thread bumps a shared
 * timestamp every {@link WATCHDOG_HEARTBEAT_MS}; the worker reads it on its
 * own cadence and, if the last beat is older than {@link
 * WATCHDOG_STALL_THRESHOLD_MS}, prints a diagnostic and `SIGABRT`s the whole
 * process. A blocked main loop simply stops bumping the timestamp — the
 * worker keeps running and pulls the ripcord. Death is a non-zero exit, so
 * the supervisor (`Restart=on-failure` on systemd, `KeepAlive.Crashed` on
 * launchd) restarts a fresh process. A 25-minute outage becomes a ~minute
 * blip, and `SIGABRT` leaves a core dump for the next postmortem.
 *
 * The timestamp is a MONOTONIC clock reading (`process.hrtime.bigint()`),
 * shared by both threads — NOT wall-clock `Date.now()`. With wall-clock, a
 * laptop sleep/resume or a forward NTP step could leap the clock past the
 * threshold while the loop was perfectly healthy and trip a false abort on
 * every wake. `process.hrtime` reads the same system-wide monotonic source in
 * every worker thread (no per-thread origin, unlike `performance.now()`), never
 * steps with the wall clock, and on Linux/macOS does not advance across
 * suspend — so the watchdog only ever trips on a genuine in-loop wedge.
 *
 * On the abort, the worker also removes this instance's scratch root(s)
 * ({@link startEventLoopWatchdog}'s `cleanupPaths`) synchronously first: the
 * `SIGABRT` default disposition does NOT run the main thread's
 * `process.on('exit')` cleanup, and this abort is now an INTENDED recovery
 * path, so without it every wedge-recovery would orphan a scratch dir (pasted
 * images, dropped files, secrets). The main loop is wedged but the worker's
 * own loop and the filesystem are fine, so a synchronous `rmSync` there works.
 *
 * No override knob by design: the threshold is baked in. The server's loop
 * must never block for tens of seconds in normal operation, so the bound is
 * set far above any legitimate pause and a trip always means a real wedge.
 */

import { Worker } from "node:worker_threads";

/** How often the main loop stamps the heartbeat. Sub-second so the freshest
 *  beat is always recent when healthy; cheap (a single `Atomics.store`). */
export const WATCHDOG_HEARTBEAT_MS = 1_000;

/** How stale the last heartbeat may get before the worker aborts the process.
 *  Far above any legitimate main-loop pause — a trip means the loop is truly
 *  wedged, never merely busy. Bounds a total freeze to roughly this long
 *  instead of "until a human notices". */
export const WATCHDOG_STALL_THRESHOLD_MS = 60_000;

/** How often the worker checks the heartbeat. Detection latency is at most
 *  {@link WATCHDOG_STALL_THRESHOLD_MS} + this. */
export const WATCHDOG_CHECK_MS = 5_000;

/** Pure stall predicate, shared in spirit with the worker's inline check and
 *  unit-tested here so the boundary condition has a home. Unit-agnostic: the
 *  caller passes a consistent clock unit on all three args (production passes
 *  monotonic NANOSECONDS; the unit test passes ms — same arithmetic either
 *  way). `lastBeat === 0` is the "no beat yet" sentinel (the heartbeat hasn't
 *  run once), never a stall — the worker must not abort a process still
 *  starting up. */
export function isStalled(
  lastBeat: number,
  now: number,
  threshold: number,
): boolean {
  if (lastBeat === 0) return false;
  return now - lastBeat > threshold;
}

/** The worker body, kept as a plain-JS string and run with `eval: true` so it
 *  needs no separate file and no TS loader inside the worker (we also clear
 *  `execArgv` so it doesn't inherit the parent's `--import tsx`). The stall
 *  decision is the SAME {@link isStalled}: its source is interpolated in below
 *  so the worker runs the exact predicate the unit test exercises — one
 *  definition, no hand-synced copy. Both sides read `process.hrtime.bigint()`
 *  (monotonic ns), so `thresholdNs` is the threshold in the SAME unit. The
 *  `Atomics.load` reads the value the main thread `Atomics.store`s.
 *  `process.kill(process.pid, "SIGABRT")` terminates the WHOLE process (same
 *  PID across threads) even with the main loop blocked — `SIGABRT` has no JS
 *  handler to wait on, so the kernel's default disposition fires immediately.
 *
 *  Exported so the child-process test can drive the REAL worker body: an
 *  in-process test can't exercise the abort without killing the test runner. */
export const WATCHDOG_WORKER_SOURCE = `
const { workerData } = require("node:worker_threads");
const fs = require("node:fs");
const beats = new BigInt64Array(workerData.sab);
const thresholdNs = workerData.thresholdNs;
const checkMs = workerData.checkMs;
const cleanupPaths = workerData.cleanupPaths || [];
const isStalled = ${isStalled.toString()};
setInterval(() => {
  // Monotonic on BOTH sides: a wall-clock jump (NTP step) or a laptop
  // sleep/resume can't make a healthy loop look stale, because hrtime never
  // steps with the wall clock and doesn't advance across suspend.
  const last = Number(Atomics.load(beats, 0));
  const now = Number(process.hrtime.bigint());
  if (!isStalled(last, now, thresholdNs)) return;
  const staleMs = Math.round((now - last) / 1e6); // diagnostic display value, not the decision
  // The worker can't reach the main logger; stderr is captured by the
  // service journal. Write SYNCHRONOUSLY to fd 2 — a buffered console.error
  // would race the abort below and lose the line. One structured line, then
  // clean up and pull the ripcord.
  fs.writeSync(2, JSON.stringify({
    level: "fatal",
    subsystem: "event-loop-watchdog",
    msg: "event loop wedged past threshold — aborting for supervisor restart",
    staleMs,
    thresholdMs: Math.round(thresholdNs / 1e6),
  }) + "\\n");
  // Synchronous scratch-root cleanup before the abort: SIGABRT does NOT run the
  // main thread's process.on('exit') cleanup, so without this the intended
  // wedge-recovery would orphan this instance's scratch dir. Best-effort —
  // wrapped so a failed unlink still reaches the abort (restarting is the
  // critical action) and is surfaced on stderr rather than swallowed.
  for (const p of cleanupPaths) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch (e) {
      fs.writeSync(2, JSON.stringify({
        level: "error",
        subsystem: "event-loop-watchdog",
        msg: "scratch cleanup before abort failed",
        path: p,
        err: e instanceof Error ? e.message : String(e),
      }) + "\\n");
    }
  }
  process.kill(process.pid, "SIGABRT");
}, checkMs);
`;

/** Start the watchdog. Returns a stop function (used by tests; production
 *  runs it for the process's lifetime). Both the heartbeat interval and the
 *  worker are `unref`'d so the watchdog itself never keeps the process alive
 *  — it only ever shortens a wedge, never extends a clean shutdown. */
export function startEventLoopWatchdog(
  opts: {
    heartbeatMs?: number;
    thresholdMs?: number;
    checkMs?: number;
    /** Absolute paths the worker `rmSync`s synchronously right before the
     *  `SIGABRT`, since that abort bypasses the main thread's
     *  `process.on('exit')` cleanup. Kolu passes its per-instance scratch
     *  root so a wedge-recovery doesn't orphan pasted images / dropped files /
     *  secrets. */
    cleanupPaths?: string[];
  } = {},
): () => void {
  const heartbeatMs = opts.heartbeatMs ?? WATCHDOG_HEARTBEAT_MS;
  const thresholdMs = opts.thresholdMs ?? WATCHDOG_STALL_THRESHOLD_MS;
  const checkMs = opts.checkMs ?? WATCHDOG_CHECK_MS;
  const cleanupPaths = opts.cleanupPaths ?? [];
  // The worker compares in the same monotonic-ns unit the heartbeat stamps.
  const thresholdNs = thresholdMs * 1_000_000;

  // One i64 slot of shared memory: the last main-loop heartbeat as a monotonic
  // `process.hrtime.bigint()` nanosecond reading. `Atomics` requires an integer
  // typed array and the value is a bigint nanosecond count, so BigInt64Array is
  // the fit — it holds the reading exactly and the cross-thread read/write needs
  // no locking.
  const sab = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT);
  const beats = new BigInt64Array(sab);

  const beat = (): void => {
    Atomics.store(beats, 0, process.hrtime.bigint());
  };
  beat(); // stamp once up front so a slow first tick can't read the 0 sentinel
  const timer = setInterval(beat, heartbeatMs);
  timer.unref();

  const worker = new Worker(WATCHDOG_WORKER_SOURCE, {
    eval: true,
    execArgv: [],
    workerData: { sab, thresholdNs, checkMs, cleanupPaths },
  });
  worker.unref();

  return () => {
    clearInterval(timer);
    void worker.terminate();
  };
}
