/**
 * Process-liveness probe + a single-instance pid-gate.
 *
 * Shared by the pty-host daemon (which *acquires* the gate to enforce
 * single-instance) and kolu-server (which *reads* it to find the surviving
 * daemon's pid for reattach, and waits on its exit before respawning). Kept in
 * kolu-shared because both sides need the exact same semantics and neither may
 * depend on the other.
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

/**
 * Is `pid` a live process? Uses `kill(pid, 0)` — the canonical existence check
 * that sends no signal:
 *   - `ESRCH` → no such process → false (gone).
 *   - `EPERM` → exists but we may not signal it → true (alive).
 *   - any other outcome → true (fail safe: never call a process gone when
 *     unsure, or a respawn would race a still-live owner).
 */
export function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export interface PidGate {
  /** The pid written into the gate (the acquiring process). */
  readonly pid: number;
  /** Remove the pid file — but only if it is still ours, so we never unlink a
   *  successor's gate. Idempotent; safe to call from a process `exit` handler. */
  release(): void;
}

export type AcquirePidGateResult =
  | { kind: "acquired"; gate: PidGate }
  | { kind: "held"; byPid: number };

/** Read the raw pid an existing gate file claims (no liveness check), or null
 *  if the file is absent or malformed. */
function rawGatePid(path: string): number | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const pid = Number.parseInt(text.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * The gate's *live* owner, or null when it is absent or stale (the claimed pid
 * is no longer running — e.g. a `SIGKILL`ed daemon that never got to unlink).
 * This is what the server reads to decide "reattach to a survivor" vs "spawn
 * fresh".
 */
export function readPidGate(path: string): number | null {
  const pid = rawGatePid(path);
  return pid !== null && pidIsAlive(pid) ? pid : null;
}

function makeGate(path: string, pid: number): PidGate {
  let released = false;
  return {
    pid,
    release() {
      if (released) return;
      released = true;
      try {
        if (rawGatePid(path) === pid) unlinkSync(path);
      } catch {
        // Already gone, or replaced by a successor — nothing ours to remove.
      }
    },
  };
}

/**
 * Acquire the single-instance gate at `path`.
 *
 * The gate is an `O_EXCL` pid file whose *liveness is the lock*: a competitor
 * that finds the file probes the pid inside — alive ⇒ `held`, gone ⇒ stale, so
 * it reclaims the file and takes over. Deliberately not an `flock`: a `kill -9`
 * daemon leaves a stale file (reclaimable) rather than an flock that outlives
 * the dead holder, which is the failure mode the `O_EXCL`+liveness pairing
 * avoids. The two-attempt loop closes the create⇄reclaim race with a
 * concurrent starter; a genuine concurrent winner is reported as `held`.
 */
export function acquirePidGate(path: string): AcquirePidGateResult {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd: number;
    try {
      fd = openSync(path, "wx", 0o600); // O_CREAT | O_EXCL | O_WRONLY
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const owner = readPidGate(path);
      if (owner !== null) return { kind: "held", byPid: owner };
      // Stale file (no live owner) — reclaim it and retry the exclusive create.
      try {
        unlinkSync(path);
      } catch {
        // A racing starter already reclaimed it; the retry will observe theirs.
      }
      continue;
    }
    try {
      writeSync(fd, `${process.pid}\n`);
    } finally {
      closeSync(fd);
    }
    return { kind: "acquired", gate: makeGate(path, process.pid) };
  }
  // Both attempts lost to a concurrent winner that is still holding the gate.
  return { kind: "held", byPid: readPidGate(path) ?? -1 };
}
