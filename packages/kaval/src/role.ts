/**
 * Host-isolation role STORAGE (juspay/kolu#1334) — the pure read/write primitives
 * for a daemon's role marker. They live in kaval (not padi) because BOTH daemons
 * write their own marker beside their own gate — padi writes `padi-<digest>/role`,
 * the kaval it spawns writes `kaval-<digest>/role` — and padi depends on kaval, so
 * kaval is the lowest kolu daemon both can reach without inverting the arrow. The
 * GUARD that consumes these (resolveBoundStateRoot) builds on padi's state-root
 * identity and lives in `@kolu/padi`'s `role.ts`.
 *
 * A marker is a one-line file (`production` | `dev`) beside a gate, mirroring the
 * `state-root` manifest that already lives in the same rendezvous dir.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The two roles an estate can carry. `production` is the user's live kolu; every
 *  non-production launch (dev server, e2e, a unit test, a bare daemon) is `dev`. */
export type DaemonRole = "production" | "dev";

/** The env var the production wrapper sets and every daemon spawn threads
 *  explicitly (never via the PTY allowlist). Read through {@link selfRole}. */
export const KOLU_ROLE_ENV = "KOLU_ROLE";

/** The marker filename — the same basename in the persistent state-root and beside
 *  each daemon's pid gate in the runtime dir. */
export const ROLE_MARKER_FILE = "role";

/** THIS process's declared role: `production` only when the launch env says so;
 *  everything else is `dev` (the fail-safe default — the guarded case must be the
 *  one that is declared, never the dangerous one). */
export function selfRole(): DaemonRole {
  return process.env[KOLU_ROLE_ENV] === "production" ? "production" : "dev";
}

/** The DISCRIMINATED outcome of reading a role marker (juspay/kolu#1334, F7) — so a
 *  fail-closed guard can tell "genuinely absent" (`missing`, an unmarked dev root)
 *  apart from "present but I cannot trust what it says" (`unreadable`: an EACCES/EIO
 *  read error, OR a body that is neither `production` nor `dev` — INCLUDING an
 *  empty/whitespace one). Collapsing those two to one `undefined` is the fail-OPEN
 *  hole: on a non-default root an unreadable/corrupt/emptied PRODUCTION marker would
 *  read as unmarked and a dev action would be wrongly allowed. The guard REFUSES on
 *  `unreadable` (can't prove not-production). */
export type RoleRead =
  | { kind: "missing" }
  | { kind: "role"; role: DaemonRole }
  | { kind: "unreadable" };

/** Read a role marker file into a {@link RoleRead}. ONLY a genuine ENOENT is
 *  `missing` — honest absence. EVERY other outcome fails closed: any non-ENOENT fs
 *  error (EACCES/EIO) is `unreadable`, and a PRESENT body that is not exactly
 *  `production`/`dev` — INCLUDING an empty or whitespace-only one — is `unreadable`
 *  too (F7). An empty marker is NOT honest absence: a legacy truncated marker, a
 *  failed prior write, or a manually-emptied file on a relocated production root must
 *  never read as "unmarked → a dev action may proceed". The atomic writer below means
 *  a live reader never observes a transient truncation, so the ONLY way to see an
 *  empty body is genuine corruption — which fails closed. */
function readRoleFileResult(path: string): RoleRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    // EACCES / EIO / EPERM: the marker EXISTS (or we can't tell it doesn't) but we
    // cannot read it — fail closed, never treat as unmarked.
    return { kind: "unreadable" };
  }
  return classifyRoleBody(raw);
}

/** Map a marker file's raw body to a {@link RoleRead}. Exactly `production`/`dev`
 *  (after trim) is a role; ANY other present body — empty, whitespace, corrupt — is
 *  `unreadable`, never `missing` (F7). Shared by the sync and async readers so the
 *  "what counts as a trustworthy role" rule can't drift between the two tiers. */
function classifyRoleBody(raw: string): RoleRead {
  const value = raw.trim();
  if (value === "production" || value === "dev") {
    return { kind: "role", role: value };
  }
  // A present body that is not exactly a recognized role — an empty/whitespace file
  // or a corrupt marker — is UNREADABLE, never `missing`. Only a genuine ENOENT above
  // is honest absence (F7); the guards refuse on `unreadable`.
  return { kind: "unreadable" };
}

// ── The PERSISTENT marker on the state-root (relocated prod roots, #1414) ────

/** `<stateRoot>/role`, beside padi's persistent `padi.log`. Only ever holds
 *  `production`; a dev root is left unmarked. */
export function persistentRoleMarkerPath(stateRoot: string): string {
  return join(resolve(stateRoot), ROLE_MARKER_FILE);
}

/** The PERSISTENT marker's discriminated read — fail-closed, so an unreadable/corrupt
 *  marker REFUSES rather than reads as unmarked (F7). The guards consult this. */
export function readPersistentRoleResult(stateRoot: string): RoleRead {
  return readRoleFileResult(persistentRoleMarkerPath(stateRoot));
}

/** Stamp the persistent `production` marker on a state-root (a production
 *  `daemonMain`, or deploy activation). Owner-only; idempotent. Written ATOMICALLY
 *  (F7): a `<path>.tmp` written 0600 then `renameSync`d over the marker, so a
 *  concurrent reader never observes a truncated/empty marker (the in-place
 *  `writeFileSync` truncate opened a transient fail-open window where the marker
 *  read as unmarked). `rename(2)` within one directory is atomic. */
export function writePersistentProductionMarker(stateRoot: string): void {
  const path = persistentRoleMarkerPath(stateRoot);
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, "production\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** Stamp the persistent role of a binder's own state-root — the FUSED shape every
 *  bind site uses, so the "check role, then write" pair can't drift and a dev caller
 *  can't construct the dev-root-poisoning write. Production stamps the marker
 *  ({@link writePersistentProductionMarker}); `dev` is a deliberate no-op (a dev root
 *  is left unmarked — there is no dev persistent marker). Callers pass {@link
 *  selfRole} unconditionally. */
export function stampPersistentRole(stateRoot: string, role: DaemonRole): void {
  if (role === "production") writePersistentProductionMarker(stateRoot);
}

// ── The EPHEMERAL role beside the pid gate (boot-wiped runtime dir) ──────────

/** `<runtimeDir>/role`, beside a daemon's `padi.pid` / `kaval.pid` gate — so it is
 *  boot-wiped exactly when the gate is and can never outlive the holder. */
export function ephemeralRolePath(runtimeDir: string): string {
  return join(runtimeDir, ROLE_MARKER_FILE);
}

/** Write the ephemeral role beside a daemon's gate — UNCONDITIONALLY, with the
 *  daemon's ACTUAL role, before its socket becomes adoptable. Owner-only. */
export function writeEphemeralRole(runtimeDir: string, role: DaemonRole): void {
  writeFileSync(ephemeralRolePath(runtimeDir), `${role}\n`, { mode: 0o600 });
}
