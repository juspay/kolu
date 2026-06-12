/**
 * Block until a pid has truly left the process table — the lock-release barrier
 * the daemon recycle needs.
 *
 * The single-instance pid-gate fights a respawn: a fresh daemon can't acquire
 * the gate (or bind the socket) until the old one is *gone*, not merely sent
 * `SIGTERM`. The #1034 data-loss restart was exactly this race — the respawn was
 * given a fixed 30s and the old, swap-thrashing daemon took ~2min to exit, so no
 * second daemon ever ran. So we poll `kill(pid,0)` → `ESRCH` (real exit), with a
 * **load-aware** ceiling generous enough for a loaded production box, not an idle
 * dev one.
 *
 * Returns `true` once the pid is gone, `false` if the ceiling elapses first
 * (the caller decides what to do with a daemon that won't die — never silently
 * spawn a second one onto a still-held gate).
 */

import { pidIsAlive } from "@kolu/pty-host";
import type { Logger } from "kolu-shared";
import { LOAD_AWARE_CEILING_MS } from "./loadAwareCeiling.ts";

export interface WaitForPidGoneOpts {
  /** Upper bound before giving up. Default 120s — a loaded box with 20 heavy
   *  PTYs under swap can take minutes to tear down (#1034), far past an idle
   *  dev exit. */
  ceilingMs?: number;
  /** Poll interval. Default 250ms — frequent enough that a fast exit is noticed
   *  promptly, cheap enough that a long wait costs nothing. */
  pollMs?: number;
  log?: Logger;
  /** Injectable clock/probe seams for tests (default real time + `pidIsAlive`). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isAlive?: (pid: number) => boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve `true` when `pid` is gone (`kill(pid,0)` → ESRCH), or `false` if it
 *  is still alive after `ceilingMs`. A pid that is already gone resolves `true`
 *  on the first probe. */
export async function waitForPidGone(
  pid: number,
  opts: WaitForPidGoneOpts = {},
): Promise<boolean> {
  const ceilingMs = opts.ceilingMs ?? LOAD_AWARE_CEILING_MS;
  const pollMs = opts.pollMs ?? 250;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const isAlive = opts.isAlive ?? pidIsAlive;

  const deadline = now() + ceilingMs;
  while (isAlive(pid)) {
    if (now() >= deadline) {
      opts.log?.warn(
        { pid, ceilingMs },
        "waitForPidGone: pid still alive at the ceiling — not respawning onto a held gate",
      );
      return false;
    }
    await sleep(pollMs);
  }
  return true;
}
