/**
 * The atomic single-instance pid-gate — both sides of one file format.
 *
 * A "surface daemon" (kaval today, `odu serve` next) must run at most once per
 * scope. The gate is a small file at a scope-keyed path whose content is the
 * holder's pid. Acquisition is atomic by construction: write the pid to a
 * private temp file, then `link(2)` it onto the gate path — `link` fails with
 * `EEXIST` if the gate already exists, so two racers cannot both believe they
 * acquired it (unlike a check-then-write, which has a window). On `EEXIST` the
 * loser reads the gate and liveness-probes the holder; a *live* holder means
 * "already running" (the caller exits 0), a *dead* one means a crashed
 * predecessor left a stale gate, which is unlinked and retried.
 *
 * Two sides, one home:
 *   - `acquirePidGate` runs **inside the daemon** (kaval's `daemonMain`).
 *   - `readPidGate` runs **inside the supervisor** that spawns and watches the
 *     daemon (kolu-server, from B2). Co-locating them keeps the gate's file
 *     format — pid as decimal text — defined in exactly one place.
 *
 * No survival, adoption, or env policy lives here: this is pure lifecycle
 * mechanism, parameterized only by the gate path (the scope key).
 */

import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

/** The outcome of trying to take the gate. `acquired` hands back a `release`
 *  the daemon calls at teardown; `held` reports the live pid already serving so
 *  the caller can exit cleanly (single-instance success, not an error). */
export type GateAcquisition =
  | { kind: "acquired"; release: () => void }
  | { kind: "held"; pid: number };

/** Is `pid` a live process? `kill(pid, 0)` sends no signal — it only probes:
 *  success or `EPERM` (exists, not ours) ⇒ alive; `ESRCH` ⇒ gone. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The gate's raw pid, or `undefined` if the file is absent or malformed. Does
 *  NOT check liveness — that is the two readers' job (acquire treats a dead pid
 *  as stale; `readPidGate` returns only a live one). */
function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** The supervisor side: the pid of the *live* daemon currently holding the
 *  gate, or `undefined` if none does (no file, malformed, or a stale holder).
 *  kolu-server's endpoint (B2) uses this to decide connect-vs-spawn. */
export function readPidGate(gatePath: string): number | undefined {
  const pid = gatePid(gatePath);
  return pid !== undefined && processAlive(pid) ? pid : undefined;
}

/** Take the gate for *this* process, atomically. Returns `acquired` (with a
 *  `release` to call at teardown) or `held` (a live daemon already serves —
 *  exit 0). Bounded retry: each pass either acquires, observes a live holder,
 *  or clears one stale gate and tries again; the cap stops an adversarial
 *  unlink/recreate race from spinning forever. */
export function acquirePidGate(gatePath: string): GateAcquisition {
  mkdirSync(dirname(gatePath), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 100; attempt++) {
    // A per-process, per-attempt temp file we hard-link onto the gate. Unique
    // by pid+attempt, so no two racers (distinct pids) or retries collide.
    const tmp = `${gatePath}.tmp.${process.pid}.${attempt}`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, `${process.pid}\n`);
    } finally {
      closeSync(fd);
    }

    try {
      // Atomic claim: succeeds iff the gate did not exist a moment ago.
      linkSync(tmp, gatePath);
      unlinkSync(tmp);
      let released = false;
      return {
        kind: "acquired",
        release: () => {
          if (released) return;
          released = true;
          // Remove the gate only while it is still ours — never unlink a
          // successor's gate (we may be releasing late, after a stale-reap
          // handed the gate to another process).
          if (gatePid(gatePath) === process.pid) {
            try {
              unlinkSync(gatePath);
            } catch {
              // Already gone — fine.
            }
          }
        },
      };
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // Best-effort temp cleanup.
      }
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      // The gate exists. A live holder wins; a dead one is stale — reap it and
      // retry. (Concurrent reapers are safe: ENOENT on unlink just means a
      // peer reaped first, and the next pass re-reads the new state.)
      const pid = gatePid(gatePath);
      if (pid !== undefined && processAlive(pid)) {
        return { kind: "held", pid };
      }
      try {
        unlinkSync(gatePath);
      } catch {
        // A peer reaped it first; retry.
      }
    }
  }

  throw new Error(
    `could not acquire pid-gate at ${gatePath} after repeated contention`,
  );
}
