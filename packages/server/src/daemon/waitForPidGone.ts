/**
 * waitForPidGone — block until a process id is no longer alive.
 *
 * This is the lock-release barrier the daemon-restart sequence waits on between
 * draining the old daemon and spawning the new one. Its absence is exactly what
 * lost the session in the #1034 postmortem: the respawn raced the slow exit of a
 * 13.5h-old, 25G daemon on a thrashing box, the single-instance lock was still
 * held, and the new daemon never came up — leaving an empty canvas. The barrier
 * makes "kill before the old one is actually gone, then fail to respawn"
 * structurally impossible: callers `await` a `"gone"` verdict (or an honest
 * `"timeout"`) before they touch the pid-gate.
 *
 * Liveness is probed with `kill(pid, 0)` — the canonical "does this process
 * exist?" syscall that sends no signal:
 *   - `ESRCH` → no such process → gone.
 *   - `EPERM` → the process exists but we may not signal it → still alive.
 *   - success / any other error → assume alive (fail safe: never report a
 *     process gone when we are unsure, or the respawn would race it again).
 *
 * The timeout ceiling is the caller's to set and is deliberately load-aware:
 * sized for a loaded production box (20 heavy PTYs + a tsx cold-start under
 * swap ≫ 30s), never an idle dev one (hard constraint #3 of the postmortem).
 */

import { pidIsAlive } from "kolu-shared";

/** A process-liveness probe. Injectable so the barrier is unit-testable without
 *  spawning real processes; the default uses `kill(pid, 0)` (`pidIsAlive`). */
export type IsAlive = (pid: number) => boolean;

export interface WaitForPidGoneOptions {
  /** Load-aware ceiling (ms). The barrier resolves `"timeout"` once exceeded —
   *  the caller then surfaces an honest degraded state, never a silent void. */
  timeoutMs: number;
  /** Poll interval (ms) between liveness probes. Default 100. */
  pollMs?: number;
  /** Liveness probe. Default: `kill(pid, 0)` classified per the rules above. */
  isAlive?: IsAlive;
  /** Cancellable sleep, injectable for deterministic fake-timer tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type WaitForPidGoneResult = "gone" | "timeout";

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve `"gone"` once `pid` stops being alive, or `"timeout"` once
 * `timeoutMs` elapses — whichever comes first. A `pid` that is already gone on
 * the first probe resolves `"gone"` immediately (no wasted poll).
 */
export async function waitForPidGone(
  pid: number,
  opts: WaitForPidGoneOptions,
): Promise<WaitForPidGoneResult> {
  const { timeoutMs } = opts;
  const pollMs = opts.pollMs ?? 100;
  const isAlive = opts.isAlive ?? pidIsAlive;
  const sleep = opts.sleep ?? realSleep;

  const deadline = Date.now() + timeoutMs;
  // Probe-first: an already-dead pid returns before we ever sleep.
  while (isAlive(pid)) {
    if (Date.now() >= deadline) return "timeout";
    await sleep(pollMs);
  }
  return "gone";
}
