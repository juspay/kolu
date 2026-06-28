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
 *  unit-tested here so the boundary condition has a home. `lastBeatMs === 0`
 *  is the "no beat yet" sentinel (the heartbeat hasn't run once), never a
 *  stall — the worker must not abort a process that is still starting up. */
export function isStalled(
  lastBeatMs: number,
  nowMs: number,
  thresholdMs: number,
): boolean {
  if (lastBeatMs === 0) return false;
  return nowMs - lastBeatMs > thresholdMs;
}

/** The worker body, kept as a plain-JS string and run with `eval: true` so it
 *  needs no separate file and no TS loader inside the worker (we also clear
 *  `execArgv` so it doesn't inherit the parent's `--import tsx`). The stall
 *  decision is the SAME {@link isStalled}: its source is interpolated in below
 *  so the worker runs the exact predicate the unit test exercises — one
 *  definition, no hand-synced copy. `Atomics.load` reads the value the main
 *  thread `Atomics.store`s. `process.kill(process.pid, "SIGABRT")` terminates
 *  the WHOLE process (same PID across threads) even with the main loop blocked
 *  — `SIGABRT` has no JS handler to wait on, so the kernel's default
 *  disposition fires immediately.
 *
 *  Exported so the child-process test can drive the REAL worker body: an
 *  in-process test can't exercise the abort without killing the test runner. */
export const WATCHDOG_WORKER_SOURCE = `
const { workerData } = require("node:worker_threads");
const beats = new BigInt64Array(workerData.sab);
const thresholdMs = workerData.thresholdMs;
const checkMs = workerData.checkMs;
const isStalled = ${isStalled.toString()};
setInterval(() => {
  const last = Number(Atomics.load(beats, 0));
  if (!isStalled(last, Date.now(), thresholdMs)) return;
  const staleMs = Date.now() - last; // diagnostic display value, not the decision
  // The worker can't reach the main logger; stderr is captured by the
  // service journal. Write SYNCHRONOUSLY to fd 2 — a buffered console.error
  // would race the abort below and lose the line. One structured line, then
  // pull the ripcord.
  require("node:fs").writeSync(2, JSON.stringify({
    level: "fatal",
    subsystem: "event-loop-watchdog",
    msg: "event loop wedged past threshold — aborting for supervisor restart",
    staleMs,
    thresholdMs,
  }) + "\\n");
  process.kill(process.pid, "SIGABRT");
}, checkMs);
`;

/** Start the watchdog. Returns a stop function (used by tests; production
 *  runs it for the process's lifetime). Both the heartbeat interval and the
 *  worker are `unref`'d so the watchdog itself never keeps the process alive
 *  — it only ever shortens a wedge, never extends a clean shutdown. */
export function startEventLoopWatchdog(
  opts: { heartbeatMs?: number; thresholdMs?: number; checkMs?: number } = {},
): () => void {
  const heartbeatMs = opts.heartbeatMs ?? WATCHDOG_HEARTBEAT_MS;
  const thresholdMs = opts.thresholdMs ?? WATCHDOG_STALL_THRESHOLD_MS;
  const checkMs = opts.checkMs ?? WATCHDOG_CHECK_MS;

  // One i64 slot of shared memory: the millis of the last main-loop heartbeat.
  // `Atomics` requires an integer typed array, and `Date.now()` overflows
  // int32, so BigInt64Array is the fit — it holds the timestamp exactly and
  // the cross-thread read/write needs no locking.
  const sab = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT);
  const beats = new BigInt64Array(sab);

  const beat = (): void => {
    Atomics.store(beats, 0, BigInt(Date.now()));
  };
  beat(); // stamp once up front so a slow first tick can't read the 0 sentinel
  const timer = setInterval(beat, heartbeatMs);
  timer.unref();

  const worker = new Worker(WATCHDOG_WORKER_SOURCE, {
    eval: true,
    execArgv: [],
    workerData: { sab, thresholdMs, checkMs },
  });
  worker.unref();

  return () => {
    clearInterval(timer);
    void worker.terminate();
  };
}
