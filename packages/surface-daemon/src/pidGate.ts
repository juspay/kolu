/**
 * The atomic single-instance pid-gate — the daemon side plus the shared file
 * format the supervisor reads from where it lives.
 *
 * A "surface daemon" (kaval today, `odu serve` next) must run at most once per
 * scope. The gate is a small file at a scope-keyed path whose content is the
 * holder's pid and (from this generation) process-start instant. Acquisition is
 * atomic by construction: write that identity to a private temp file, then
 * `link(2)` it onto the gate path — `link` fails with `EEXIST` if the gate
 * already exists, so two racers cannot both believe they acquired it. On
 * `EEXIST` the loser reads the gate and liveness-probes the holder; a *live*
 * holder means "already running" (the caller exits 0), a *dead* one means a
 * crashed predecessor left a stale gate, which is unlinked and retried.
 *
 * ## The pid-first tolerant-reader law
 *
 * **The first token of a gate file is the pid, in every generation, and
 * readers ignore anything after it.** A one-field legacy gate is simply an
 * older gate — pid usable, start time unknown. A two-field gate is
 * `${pid}\t${startUnixUs}\n`. A future third field must still yield the pid
 * to today's reader. Never refuse a shape whose first token is a valid pid
 * (that refusal is the #2011 brick).
 *
 * Process-start comparison uses a ±2 s tolerance: the start instant is derived
 * from `/proc/stat` btime at read time, and NTP steps / suspend / VM pauses
 * shift it by whole seconds — strict equality would misread a live daemon as
 * pid-reuse.
 *
 * OS process traversal is **injected** via {@link ReadProcessIdentity}; this
 * package never imports osfacts. Composition roots (kaval, padi, kolu-server,
 * drishti) supply the reader.
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

/** A PID is not an identity: after exit the kernel can reuse it. The process
 * start instant makes gate ownership stable across that reuse. Canonical home
 * of this type — osfacts-client returns the structural twin without naming it. */
export interface ProcessIdentity {
  pid: number;
  startUnixUs: number;
}

/** Resolve a PID to its current start-qualified identity. `undefined` means the
 * process is gone (ESRCH/ENOENT) — an honest domain answer. Any other failure
 * (osfacts unreadable, parse error) must throw at the composition root. */
export type ReadProcessIdentity = (pid: number) => ProcessIdentity | undefined;

/**
 * ±2 seconds in microseconds. Start instants come from `/proc/stat` btime at
 * read time; NTP / suspend / VM pauses shift that by whole seconds.
 */
export const START_TIME_TOLERANCE_US = 2_000_000;

/** Do two start instants name the same process under the gate's clock tolerance? */
export function startTimesMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= START_TIME_TOLERANCE_US;
}

/** A gate read keeps absence, I/O failure, and a present-but-unparseable body
 * distinct. A valid first-token pid is always accepted (the pid-first law);
 * `startUnixUs` is present only when the second field parses as a positive
 * integer. */
export type GateIdentityRead =
  | {
      kind: "ok";
      pid: number;
      /** Set when the second tab-field is a valid positive integer. */
      startUnixUs?: number;
    }
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "malformed" };

/** Is `pid` a live process? `kill(pid, 0)` sends no signal — it only probes:
 *  success or `EPERM` (exists, not ours) ⇒ alive; `ESRCH` ⇒ gone. Used for
 *  one-field (legacy) gates where start time is unknown, and as a cheap probe
 *  elsewhere. */
export function isHolderLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Read the gate under the pid-first law. Never refuses a shape whose first
 * token is a valid pid — that refusal is the #2011 brick. */
export function readGateIdentity(gatePath: string): GateIdentityRead {
  let contents: string;
  try {
    contents = readFileSync(gatePath, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "unreadable" };
  }

  const fields = contents.trim().split("\t");
  const pid = Number(fields[0]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return { kind: "malformed" };

  if (fields.length >= 2) {
    const startUnixUs = Number(fields[1]);
    if (Number.isSafeInteger(startUnixUs) && startUnixUs > 0) {
      return { kind: "ok", pid, startUnixUs };
    }
    // Second field present but not a start time — still a valid pid (the law
    // says ignore anything after the first token). Treat as one-field.
  }
  return { kind: "ok", pid };
}

/** Full two-field identity when present; `undefined` for absent / unreadable /
 * one-field / malformed. Ownership checks that need start time use this;
 * recycle kill targets that only need the pid use {@link gatePid}. */
export function gateIdentity(gatePath: string): ProcessIdentity | undefined {
  const read = readGateIdentity(gatePath);
  if (read.kind !== "ok" || read.startUnixUs === undefined) return undefined;
  return { pid: read.pid, startUnixUs: read.startUnixUs };
}

/** The gate's raw pid, or `undefined` if the file is absent, unreadable, or
 * the first token is not a positive integer. Does NOT check liveness. This is
 * the frozen rollback contract: a two-field write must still yield the pid to
 * a legacy `parseInt`-style reader, and our reader must yield the pid of a
 * one-field legacy gate (the #2011 fix). */
export function gatePid(gatePath: string): number | undefined {
  const read = readGateIdentity(gatePath);
  return read.kind === "ok" ? read.pid : undefined;
}

/** True when `current` is the same process `recorded` named, under tolerance. */
export function identitiesMatch(
  recorded: ProcessIdentity,
  current: ProcessIdentity,
): boolean {
  return (
    recorded.pid === current.pid &&
    startTimesMatch(recorded.startUnixUs, current.startUnixUs)
  );
}

/**
 * Is the gate's recorded holder still the live process it names?
 *
 * - **Two-field:** compare with the injected identity reader (±2 s). Match →
 *   the holder's pid; mismatch / dead → `undefined` (reap).
 * - **One-field:** start time unknown — fall back to `kill(0)` only (cannot
 *   prove pid-reuse). Status quo for old gates; not a weaker default for new
 *   ones.
 */
export function liveHolderPid(
  gatePath: string,
  readProcessIdentity: ReadProcessIdentity,
): number | undefined {
  const read = readGateIdentity(gatePath);
  if (read.kind !== "ok") return undefined;

  if (read.startUnixUs !== undefined) {
    const current = readProcessIdentity(read.pid);
    if (current === undefined) return undefined;
    return identitiesMatch(
      { pid: read.pid, startUnixUs: read.startUnixUs },
      current,
    )
      ? read.pid
      : undefined;
  }

  return isHolderLive(read.pid) ? read.pid : undefined;
}

/** Take the gate for *this* process, atomically. Returns `acquired` (with a
 *  `release` to call at teardown) or `held` (a live process owns the gate).
 *  Bounded retry: each pass either acquires, observes a live holder, or clears
 *  one stale gate and tries again. */
export function acquirePidGate(
  gatePath: string,
  self: ProcessIdentity,
  readProcessIdentity: ReadProcessIdentity,
): GateAcquisition {
  if (self.pid !== process.pid) {
    throw new Error(
      `pid-gate identity pid ${self.pid} does not match this process ${process.pid}`,
    );
  }
  const dir = dirname(gatePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  // `mkdirSync`'s mode is a no-op on a PRE-EXISTING dir, so verify privacy
  // before trusting (or writing into) anything in it — never honor a gate, nor
  // plant our pid, in a directory another local user could own. This mirrors
  // `serveOverUnixSocket`'s `dir-not-private` refusal, run here at the gate so
  // a pre-seeded `kaval.pid` can't short-circuit us to a bogus "already
  // running" exit before the socket-side privacy check would have refused.
  if (!isPrivateOwnedDir(dir)) {
    return { kind: "dir-not-private", dir };
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    // A per-process, per-attempt temp file we hard-link onto the gate. Unique
    // by pid+attempt, so no two racers (distinct pids) or retries collide.
    const tmp = `${gatePath}.tmp.${process.pid}.${attempt}`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, `${self.pid}\t${self.startUnixUs}\n`);
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
          const recorded = gateIdentity(gatePath);
          if (recorded !== undefined && identitiesMatch(recorded, self)) {
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

      // The gate exists. A live matching holder wins; a dead / mismatched one
      // is stale — reap and retry. (Confirm one-field holders with
      // {@link confirmHeldGate}: socket dead → reclaim; socket absent →
      // mid-boot wait. Two-field match is identity-truth — never reclaim on
      // socket state at this layer.)
      const holder = liveHolderPid(gatePath, readProcessIdentity);
      if (holder !== undefined) {
        return { kind: "held", pid: holder };
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

/**
 * After {@link acquirePidGate} returns `held`, apply the one-field (legacy)
 * socket fence — or skip it when the gate file is two-field:
 *   - **two-field** → identity is truth; keep held (never reclaim on socket)
 *   - socket **serving** → real daemon, keep held
 *   - socket **absent** → holder still booting (gate-first fence); keep held
 *   - socket **dead** → stale one-field gate (reboot PID reuse / crash); reclaim
 *
 * Generation is re-read from the gate file (the source of truth) — not carried
 * as a flag on `held`. Reclaiming on "absent" would race a legitimate
 * gate-first boot and let a second process past the single-instance fence
 * (the F12 regression). Prefer {@link claimPidGate} at call sites: it composes
 * acquire + this confirm so the sequence is not a convention.
 */
export async function confirmHeldGate(
  held: Extract<GateAcquisition, { kind: "held" }>,
  gatePath: string,
  socketPath: string,
  self: ProcessIdentity,
  readProcessIdentity: ReadProcessIdentity,
): Promise<GateAcquisition> {
  // Two-field: identity is truth — never reclaim on socket state.
  const read = readGateIdentity(gatePath);
  if (read.kind === "ok" && read.startUnixUs !== undefined) return held;

  const state = await socketServeState(socketPath);
  if (state !== "dead") return held;
  try {
    unlinkSync(gatePath);
  } catch {
    // Peer already reaped — fall through to re-acquire.
  }
  return acquirePidGate(gatePath, self, readProcessIdentity);
}

/**
 * Full single-instance claim: atomic {@link acquirePidGate}, then
 * {@link confirmHeldGate} when held. One named sequence for every composition
 * root (daemonMain, padi's pre-side-effect claim) so the acquire→confirm
 * ordering is not a call-site convention.
 */
export async function claimPidGate(
  gatePath: string,
  socketPath: string,
  self: ProcessIdentity,
  readProcessIdentity: ReadProcessIdentity,
): Promise<GateAcquisition> {
  const gate = acquirePidGate(gatePath, self, readProcessIdentity);
  if (gate.kind !== "held") return gate;
  return confirmHeldGate(gate, gatePath, socketPath, self, readProcessIdentity);
}
