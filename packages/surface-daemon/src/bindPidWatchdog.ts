/**
 * A sibling process that reaps a bound-to-pid daemon when the bind pid dies,
 * even if the daemon cannot run its own event loop or honour SIGTERM
 * (juspay/kolu#2178).
 *
 * `waitForShutdown`'s `boundToPid` poll and its SIGTERM handler live on the
 * daemon's event loop. A wedged kaval (fd exhaustion, `SIGSTOP`, a stuck
 * syscall) can neither poll nor handle the signal — that is the field
 * measurement: TERM left every orphan up, KILL reaped them. This watchdog is
 * a *different* process, so it is not the wedged loop. It is armed only from
 * `daemonProcessMain` (the real-process entry), never from in-process
 * `daemonMain` tests — those share vitest's pid and a SIGKILL would take the
 * runner down.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isHolderLive } from "./pidGate.ts";

/** How often the sibling asks whether the bind pid is still there. Keep
 *  equal to `PID_WATCH_POLL_MS` in daemonMain.ts — asserted in the unit
 *  test so this module does not import the daemon graph. */
export const BIND_WATCH_POLL_MS = 2_000;

/** Grace the sibling gives the in-process `pid-gone` path before SIGKILL.
 *  Bound-to-pid is a test/smoke lifetime — there is no 25 G persist. A CI
 *  daemon's release is expected inside this window; a wedged loop never
 *  starts release and is the SIGKILL case. */
export const BIND_WATCH_TERM_MS = 2_000;

/** Kernel window after SIGKILL. */
export const BIND_WATCH_KILL_MS = 5_000;

export const BIND_WATCH_FLAG = "--bind-pid-watch";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitGone(
  pid: number,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isHolderLive(pid)) return true;
    await sleep(Math.min(intervalMs, deadline - Date.now()));
  }
  return !isHolderLive(pid);
}

/**
 * Wait for the in-process `pid-gone` path to finish, then SIGKILL if the
 * target is still up. The sibling must not SIGTERM: `finish("pid-gone")`
 * has already removed the daemon's SIGTERM handler, so a TERM in that
 * window is the kernel default (exit 143) and aborts `listener.close` /
 * `gate.release` (daemonMain.ts announcement/teardown comment). Field
 * #2178: TERM left every orphan up; KILL reaped them — TERM does not
 * help the wedged case and is the step that damages the healthy one.
 */
export async function killAfterGrace(
  pid: number,
  opts: { graceMs?: number; killMs?: number; intervalMs?: number } = {},
): Promise<"already-gone" | "SIGKILL" | "survived"> {
  const graceMs = opts.graceMs ?? BIND_WATCH_TERM_MS;
  const killMs = opts.killMs ?? BIND_WATCH_KILL_MS;
  const intervalMs = opts.intervalMs ?? 50;
  if (await waitGone(pid, graceMs, intervalMs)) return "already-gone";
  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH"
      ? "already-gone"
      : "survived";
  }
  if (await waitGone(pid, killMs, intervalMs)) return "SIGKILL";
  return "survived";
}

/** The sibling's main loop. First tick is delayed by `pollMs` so an
 *  already-dead bind pid at boot lets `daemonMain` take the clean `pid-gone`
 *  path instead of racing a SIGKILL against a just-started tenure. */
export function runBindPidWatch(opts: {
  bindPid: number;
  targetPid: number;
  pollMs?: number;
  graceMs?: number;
  killMs?: number;
}): void {
  const pollMs = opts.pollMs ?? BIND_WATCH_POLL_MS;
  let ticking = false;
  const tick = (): void => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      try {
        if (!isHolderLive(opts.targetPid)) {
          process.exit(0);
        }
        if (isHolderLive(opts.bindPid)) return;
        const ended = await killAfterGrace(opts.targetPid, {
          graceMs: opts.graceMs,
          killMs: opts.killMs,
        });
        process.exit(ended === "survived" ? 1 : 0);
      } finally {
        ticking = false;
      }
    })();
  };
  setInterval(tick, pollMs);
}

/** Spawn the sibling. `disarm` SIGKILLs it — the clean-exit path, once
 *  `daemonMain` has already resolved. */
export function armBindPidWatchdog(opts: {
  bindPid: number;
  targetPid?: number;
}): { disarm: () => void } {
  const targetPid = opts.targetPid ?? process.pid;
  const self = fileURLToPath(
    new URL("./bindPidWatchdog.cli.ts", import.meta.url),
  );
  // Drop --inspect / --inspect-brk: the sibling would collide on the parent's
  // inspector port, and --inspect-brk would hang it forever.
  const execArgv = process.execArgv.filter((a) => !a.startsWith("--inspect"));
  const loader = execArgv.some(
    (a) => a.includes("tsx") || a.includes("strip-types"),
  )
    ? execArgv
    : tsxLoader();
  const child: ChildProcess = spawn(
    process.execPath,
    [...loader, self, BIND_WATCH_FLAG, String(opts.bindPid), String(targetPid)],
    { detached: true, stdio: "ignore", env: process.env },
  );
  child.on("error", (err) => {
    try {
      process.stderr.write(
        `bindPidWatchdog: sibling spawn failed (${err.message}); backstop is not armed\n`,
      );
    } catch {
      // Narration is best-effort; the daemon must stay up.
    }
  });
  child.unref();
  let armed = true;
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  return {
    disarm: () => {
      if (!armed) return;
      armed = false;
      if (exited || child.exitCode !== null || child.signalCode !== null)
        return;
      if (child.pid === undefined) return;
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // Already gone — the bind pid died and the sibling finished, or the
        // target exited first and the sibling saw it and left.
      }
    },
  };
}

function tsxLoader(): string[] {
  try {
    const href = pathToFileURL(
      createRequire(import.meta.url).resolve("tsx"),
    ).href;
    return ["--import", href];
  } catch {
    return ["--experimental-strip-types"];
  }
}
