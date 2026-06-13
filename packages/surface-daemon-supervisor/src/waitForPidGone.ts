/**
 * `waitForPidGone` — block until a pid is no longer a live process.
 *
 * The supervisor's half of the recycle race (#1034's lost race, made
 * deterministic): after asking a daemon to exit (SIGTERM), the supervisor must
 * wait for the OS to actually reap it before spawning a successor — respawning
 * while the old process still holds the gate would just make the new daemon
 * yield to the live survivor (the single-instance gate), and the recycle would
 * silently no-op. So we poll `isHolderLive` (a `kill(pid, 0)` probe, the same
 * primitive the gate uses) until it reports `ESRCH`.
 *
 * The ceiling is **load-aware in spirit, generous in default**: on a loaded box
 * a daemon owning gigabytes of PTY scrollback can take a minute-plus to tear
 * down (#1034's 25G/2-min case), so the default is 120s — long enough that a
 * real exit always wins, short enough that a wedged process surfaces as a
 * bounded failure instead of an unbounded hang. The mechanism is pure
 * lifecycle: it knows pids, not what the daemon holds.
 */
import { isHolderLive } from "@kolu/surface-daemon";

export interface WaitForPidGoneOptions {
  /** Give up after this long and resolve `false`. Default 120_000ms. */
  timeoutMs?: number;
  /** Poll spacing. Default 50ms. */
  intervalMs?: number;
}

/** Resolve `true` once `pid` is gone (`kill(pid, 0)` → `ESRCH`), or `false` if
 *  it is still alive at the timeout. A pid that is already gone resolves `true`
 *  on the first probe without waiting. */
export function waitForPidGone(
  pid: number,
  opts: WaitForPidGoneOptions = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;

  return new Promise<boolean>((resolve) => {
    const probe = (): void => {
      if (!isHolderLive(pid)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(probe, intervalMs);
    };
    probe();
  });
}
