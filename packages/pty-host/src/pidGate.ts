/**
 * The single-instance pid-gate for the surviving pty-host daemon.
 *
 * One daemon per socket: before it binds, the daemon must win an atomic gate
 * keyed to that socket. The gate is a small file holding the live daemon's pid.
 *
 * **Atomic publish (write-temp-then-`link`).** Acquisition writes the *complete*
 * pid into a temp file and then `link(2)`s it into place — `link` fails `EEXIST`
 * if the gate already exists, and the file that becomes visible at the gate path
 * is always the fully-written temp. A racing reader therefore never observes a
 * half-written (empty) gate. The R-4 A2-era `open("wx")`-then-`write` pattern had
 * exactly that empty window: a contender that saw `EEXIST` and then read an
 * empty file would treat the live gate as stale and steal it.
 *
 * **Stale reclamation.** A gate whose holder pid is gone (`kill(pid,0)` →
 * `ESRCH`) is reclaimed — the daemon survives kolu-server restarts, but a host
 * reboot or a crash leaves a dead gate the next daemon must clear. Removal is
 * itself racy (two starters can both see the stale gate); the bounded retry loop
 * re-reads after each clear, so the `link` still arbitrates a single winner.
 *
 * This module is the **acquire** side, owned by the daemon (B1). The server-side
 * *read* (a fresh kolu-server discovering a survivor before B2 swaps the
 * transport) reuses `readPidGate` / `pidIsAlive` / `pidGatePathForSocket` from
 * here — one derivation of the gate path, never two.
 */

import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** The gate path for a given socket path: the socket's directory, the socket's
 *  basename with `.sock` swapped for `.pid`. The daemon (acquire) and a fresh
 *  server (read, B2) both call this, so the path can never drift between them. */
export function pidGatePathForSocket(socketPath: string): string {
  const stem = basename(socketPath).replace(/\.sock$/, "");
  return join(dirname(socketPath), `${stem}.pid`);
}

/** Is `pid` a live process? `kill(pid, 0)` delivers no signal but performs the
 *  permission/existence check: success or `EPERM` (exists, owned by another
 *  user) ⇒ alive; only `ESRCH` (no such process) ⇒ dead. */
export function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH is the ONLY "dead" verdict. EPERM is alive; any other, unexpected
    // probe error is ambiguous — treat it as alive too, so a single-instance gate
    // is never *stolen* on a transient probe failure (the safe side for a lock).
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** The pid recorded in the gate, or `null` if the gate is absent, unreadable,
 *  or malformed (never throws — an unreadable gate reads as "no holder"). */
export function readPidGate(path: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** A held gate. `release()` removes the gate file — but only while it still
 *  holds *our* pid, so a daemon shutting down can never clobber a successor
 *  that already re-acquired the same path. Idempotent. */
export interface PidGate {
  readonly path: string;
  readonly pid: number;
  release(): void;
}

export type AcquireResult =
  | { acquired: true; gate: PidGate }
  | { acquired: false; holderPid: number };

/** Bounded so a pathological clear/relink live-lock throws rather than spins
 *  forever; in practice one retry settles a real stale-reclaim race. */
const MAX_ATTEMPTS = 8;

/**
 * Try to acquire the gate at `path` for `pid` (default `process.pid`).
 *
 * Returns `{ acquired: true, gate }` on success, or `{ acquired: false,
 * holderPid }` when a *live* daemon already holds it. A gate held by a dead pid
 * (or our own stale leftover) is reclaimed and acquisition proceeds.
 */
export function acquirePidGate(
  path: string,
  opts?: { pid?: number },
): AcquireResult {
  const pid = opts?.pid ?? process.pid;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  // The complete pid lives in the temp file before it is ever linked into
  // place, so whatever a reader sees at `path` is always fully written.
  const tmp = `${path}.${pid}.tmp`;
  writeFileSync(tmp, `${pid}\n`, { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        linkSync(tmp, path);
        return { acquired: true, gate: makeGate(path, pid) };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        const holder = readPidGate(path);
        // A live holder that is not us owns the gate — refuse.
        if (holder !== null && holder !== pid && pidIsAlive(holder)) {
          return { acquired: false, holderPid: holder };
        }
        // Stale (dead holder) or our own leftover: clear and re-link. The clear
        // races other starters, so the next `link` re-arbitrates.
        rmSync(path, { force: true });
      }
    }
    throw new Error(
      `pid-gate ${path} stayed contended after ${MAX_ATTEMPTS} attempts`,
    );
  } finally {
    rmSync(tmp, { force: true });
  }
}

function makeGate(path: string, pid: number): PidGate {
  let released = false;
  return {
    path,
    pid,
    release() {
      if (released) return;
      released = true;
      if (readPidGate(path) === pid) rmSync(path, { force: true });
    },
  };
}
