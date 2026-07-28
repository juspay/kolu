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
import { createConnection } from "node:net";
import { dirname } from "node:path";
import { isPrivateOwnedDir } from "./privateOwnedDir.ts";

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
 *  `release` to call at teardown) or `held` (a live process owns the PID in the
 *  gate file — call {@link confirmHeldGate} with the co-located socket to tell a
 *  real daemon from a reboot-stale PID reuse). Bounded retry: each pass either
 *  acquires, observes a live holder, or clears one stale gate and tries again. */
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

      // The gate exists. A live holder wins at this layer; a dead one is stale —
      // reap and retry. (Confirm with {@link confirmHeldGate} that a co-located
      // socket is actually serving — reboot can reuse a PID while the socket is
      // dead.) Concurrent reapers are safe: ENOENT on unlink just means a peer
      // reaped first.
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

/**
 * Probe the co-located socket:
 *   - `serving` — accept works (real daemon)
 *   - `dead` — socket inode present but connect fails (stale after crash/reboot)
 *   - `absent` — no socket file yet (holder may still be starting — do NOT reclaim)
 */
export function socketServeState(
  socketPath: string,
): Promise<"serving" | "dead" | "absent"> {
  try {
    if (!lstatSync(socketPath).isSocket()) return Promise.resolve("dead");
  } catch {
    return Promise.resolve("absent");
  }
  return new Promise((resolve) => {
    const sock = createConnection(socketPath);
    const done = (v: "serving" | "dead") => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(v);
    };
    sock.once("connect", () => done("serving"));
    sock.once("error", () => done("dead"));
  });
}

/** @deprecated prefer {@link socketServeState} — true only when actively serving */
export async function socketIsServing(socketPath: string): Promise<boolean> {
  return (await socketServeState(socketPath)) === "serving";
}

/**
 * After {@link acquirePidGate} returns `held`, distinguish:
 *   - socket **serving** → real daemon, keep held
 *   - socket **absent** → holder still booting (gate-first fence); keep held
 *   - socket **dead** → stale gate (reboot PID reuse / crashed daemon); reclaim
 *
 * Reclaiming on "absent" would race a legitimate gate-first boot and let a
 * second process past the single-instance fence (the F12 regression).
 */
export async function confirmHeldGate(
  held: Extract<GateAcquisition, { kind: "held" }>,
  gatePath: string,
  socketPath: string,
): Promise<GateAcquisition> {
  const state = await socketServeState(socketPath);
  if (state !== "dead") return held;
  try {
    unlinkSync(gatePath);
  } catch {
    // Peer already reaped — fall through to re-acquire.
  }
  return acquirePidGate(gatePath);
}
