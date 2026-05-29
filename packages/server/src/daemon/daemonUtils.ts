/**
 * Daemon-startup primitives — the single-instance gate and the exec-arg
 * filter the `kolu --stdio` PTY-host daemon needs at boot.
 *
 * These live apart from `./supervisor.ts` (the kolu-server-facing
 * connect/spawn/version API) because they change on a different axis: the
 * pid-file strategy (lock file vs `flock(2)` vs pidfd) and the node
 * exec-flag policy evolve independently of how kolu-server talks to a
 * running daemon. Both the daemon entrypoint (`../agent/main.ts`) and the
 * supervisor import from here, so neither owns the other's concern.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

/** Atomically claim the pid file. Returns true if this process is the
 *  authoritative owner; false if another live daemon already owns it.
 *  Stale pid files (recorded pid no longer alive) are cleaned up and the
 *  gate is retried — keeps the gate working across crashes without external
 *  cleanup.
 *
 *  Called by the daemon entrypoint before binding the socket so only one
 *  daemon per `$KOLU_STATE_DIR` ever owns the PTYs. */
export function tryAcquirePidFile(pidFile: string): boolean {
  mkdirSync(dirname(pidFile), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const fd = openSync(pidFile, "wx", 0o600);
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    let recordedPid = 0;
    try {
      recordedPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    } catch {
      // Unreadable; treat as stale.
    }
    if (Number.isFinite(recordedPid) && recordedPid > 0) {
      try {
        process.kill(recordedPid, 0);
        return false; // Another daemon is alive.
      } catch (sigErr) {
        if ((sigErr as NodeJS.ErrnoException).code !== "ESRCH") throw sigErr;
        // Stale — owner is gone. Fall through to unlink + retry.
      }
    }
    try {
      unlinkSync(pidFile);
    } catch {
      // Race: another process unlinked it first; loop and retry create.
    }
  }
  // Couldn't claim after several attempts — treat as already-owned.
  return false;
}

/** node exec flags the daemon must NOT inherit. `--watch` would make the
 *  detached daemon restart on source edits — killing every PTY mid-dev, the
 *  exact opposite of R-4's point. `--inspect*` would make it try to bind
 *  this process's debug port and fail to start. We keep only the
 *  loader/import flags that let node run the TS entry. */
const DROP_EXEC_FLAG =
  /^--(watch|watch-path|watch-preserve-output|inspect|inspect-brk|inspect-port|inspect-wait|debug|debug-brk)\b/;

/** Strip dev-only flags from `process.execArgv`, preserving each kept flag's
 *  space-separated value (e.g. `--import tsx`). Exported for unit testing
 *  the filter in isolation. */
export function daemonExecArgv(execArgv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const tok = execArgv[i] as string;
    if (!tok.startsWith("-")) {
      out.push(tok);
      continue;
    }
    // A following non-flag token is this flag's value (`--import tsx`).
    const next = execArgv[i + 1];
    const hasValue =
      !tok.includes("=") && next !== undefined && !next.startsWith("-");
    if (!DROP_EXEC_FLAG.test(tok)) {
      out.push(tok);
      if (hasValue) out.push(next as string);
    }
    if (hasValue) i++; // consume the value regardless of keep/drop
  }
  return out;
}
