/**
 * The atomic single-instance pid-gate — the daemon side plus the shared file
 * format the supervisor reads from where it lives.
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
 * Everything here runs **inside the daemon**: `acquirePidGate` (kaval's
 * `daemonMain`) plus the two pieces the gate's file format is made of — the pid
 * parse (`gatePid`) and the liveness probe (`isHolderLive`). The supervisor
 * that spawns and watches the daemon (kolu-server, from B2) does not get a
 * reader of its own here; it composes these same primitives where it lives, so
 * the gate's file format — pid as decimal text — stays defined in one place
 * without dragging supervisor code into this daemon-hashed package.
 *
 * No survival, adoption, or env policy lives here: this is pure lifecycle
 * mechanism, parameterized only by the gate path (the scope key).
 */

import {
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

/** The outcome of trying to take the gate. `acquired` hands back a `release`
 *  the daemon calls at teardown; `held` reports the live pid already serving so
 *  the caller can exit cleanly (single-instance success, not an error);
 *  `dir-not-private` means the gate's parent directory is not an owner-only dir
 *  we own — the same security boundary `serveOverUnixSocket` enforces on the
 *  socket, applied at the gate so an attacker-controlled dir can't make us
 *  honor (or plant our pid in) a gate it pre-seeded. */
export type GateAcquisition =
  | { kind: "acquired"; release: () => void }
  | { kind: "held"; pid: number }
  | { kind: "dir-not-private"; dir: string };

/** Is `dir` a private, owner-only directory the current user owns? The gate
 *  shares its parent directory with the socket, and that directory's privacy is
 *  the security boundary for everything it holds (cf. `isPrivateOwnedDir` in
 *  `@kolu/surface/unix-socket`, which guards the socket the same way). On the
 *  stable `/tmp/<app>-$UID` fallback another local user could pre-create the dir
 *  with loose perms and plant a `kaval.pid` holding any live pid; honoring that
 *  gate would let them DoS the daemon (it would exit 0 as "already running")
 *  *before* the socket-side privacy check ever runs. `lstatSync` (NOT
 *  `statSync`) so a symlink is judged as itself and rejected, never followed.
 *  Returns true on platforms without uid semantics (Windows: `process.getuid`
 *  is undefined) — the ACL model there is out of scope. */
function isPrivateOwnedDir(dir: string): boolean {
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return true;
  try {
    const st = lstatSync(dir);
    return st.isDirectory() && st.uid === getuid() && (st.mode & 0o077) === 0;
  } catch {
    // Couldn't stat the dir at all — treat as not-private (refuse) rather than
    // assume it's safe.
    return false;
  }
}

/** Is `pid` a live process? `kill(pid, 0)` sends no signal — it only probes:
 *  success or `EPERM` (exists, not ours) ⇒ alive; `ESRCH` ⇒ gone. The daemon's
 *  stale-reap uses it; the supervisor (B2) composes it with `gatePid` to decide
 *  connect-vs-spawn — same primitive, read from where each side lives. */
export function isHolderLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The gate's raw pid, or `undefined` if the file is absent or malformed. Does
 *  NOT check liveness — that is each reader's job (acquire treats a dead pid as
 *  stale; the supervisor pairs this with `isHolderLive` for a live-only read).
 *  The parse half of the gate's file format, single-sourced here. */
export function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Take the gate for *this* process, atomically. Returns `acquired` (with a
 *  `release` to call at teardown) or `held` (a live daemon already serves —
 *  exit 0). Bounded retry: each pass either acquires, observes a live holder,
 *  or clears one stale gate and tries again; the cap stops an adversarial
 *  unlink/recreate race from spinning forever. */
export function acquirePidGate(gatePath: string): GateAcquisition {
  const dir = dirname(gatePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  // `mkdirSync`'s mode is a no-op on a PRE-EXISTING dir, so verify privacy
  // before trusting (or writing into) anything in it — never honor a gate, nor
  // plant our pid, in a directory another local user could own. This mirrors
  // `serveOverUnixSocket`'s `dir-not-private` refusal, run here at the gate so
  // a pre-seeded `kaval.pid` can't short-circuit us to a bogus "already
  // running" exit before the socket-side check would have refused.
  if (!isPrivateOwnedDir(dir)) {
    return { kind: "dir-not-private", dir };
  }

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
      if (pid !== undefined && isHolderLive(pid)) {
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
