/**
 * State-file backup ring (juspay/kolu#1658) — timestamped, rotated snapshots of
 * a conf-backed `config.json`, taken at boot (and on a slow daily tick) BEFORE
 * the store is first written.
 *
 * Both persisted stores ride this one module: padi's state-root Conf
 * (`session/stateStore.ts`) and kolu-server's config store
 * (`packages/server/src/state.ts`, via the existing `kolu-server → @kolu/padi`
 * dependency edge — the arrow padi's own doc comment pins never points back).
 * The ring exists because `conf`'s atomic write protects against HALF-written
 * files, not against a bug persisting a bad-but-valid value (the #1658
 * incident: an out-of-band kaval restart emptied the registry and autosave
 * persisted the emptied session over the real one, with no history to recover
 * from).
 *
 * FAIL-SOFT — deliberately, and only here. The project doctrine is fail-fast,
 * but the backup is a safety net, not a gate: a snapshot failure must log
 * loudly and let the boot proceed (a padi that refuses to start because its
 * backup dir is unwritable would turn the safety net into an outage). The
 * RESTORE path ({@link readStateBackup}) is the opposite — it throws on every
 * anomaly, because a restore that silently proceeds from a corrupt backup is
 * the very data-loss class the ring exists to prevent.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** How many snapshots the ring keeps — the newest N survive a prune. */
export const STATE_BACKUP_RING_SIZE = 10;

/** The in-process re-snapshot cadence — one slow tick so a long-running daemon's
 *  newest backup never ages past a day (the boot snapshot alone would). The
 *  byte-identical dedupe makes an unchanged tick a no-op. */
export const STATE_BACKUP_TICK_MS = 24 * 60 * 60 * 1000;

/** The subdirectory of the state dir the ring lives in. */
const BACKUP_SUBDIR = "backups";

/** A backup file name: `config.<fs-safe UTC stamp>.json` (+ a `-N` bump on a
 *  same-millisecond collision). Restore inputs cross the wire as bare file
 *  names, so {@link readStateBackup} re-validates against this exact shape —
 *  path traversal is unspellable. */
const BACKUP_FILE_RE = /^config\.[0-9TZ-]+\.json$/;

/** The minimal logging face this module needs — pino-compatible, taken as a
 *  parameter so kolu-server passes its own logger rather than padi's. */
export interface StateBackupLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Where `configPath`'s ring lives: a `backups/` sibling of the state file. */
export function stateBackupDir(configPath: string): string {
  return join(dirname(configPath), BACKUP_SUBDIR);
}

/** One snapshot in the ring, newest first in a {@link listStateBackups} answer. */
export interface StateBackupEntry {
  /** Bare file name under `backups/` — the stable handle a restore names. */
  file: string;
  /** When the snapshot was taken (the copy's mtime), in epoch ms ON THE CLOCK OF
   *  THE HOST THAT TOOK IT — a consumer on another host must treat it as a
   *  foreign-clock reading (the same discipline as `PadiIdentity.startedAt`). */
  savedAtMs: number;
  /** Snapshot size in bytes. */
  sizeBytes: number;
}

/** The outcome of one snapshot attempt — a typed answer (never a throw) so the
 *  boot call site can log it and the tests can pin each acceptance case. */
export type SnapshotOutcome =
  | { kind: "created"; file: string }
  | { kind: "unchanged" }
  | { kind: "no-state-file" }
  | { kind: "failed" };

/** Take one snapshot of `configPath` into its ring: skip when the file is
 *  absent (fresh install) or byte-identical to the newest backup (quick
 *  restarts must not churn copies), otherwise copy it to a timestamped name and
 *  prune the ring to {@link STATE_BACKUP_RING_SIZE}. FAIL-SOFT: any error logs
 *  loudly and answers `failed` — see the module doc for why this one path may
 *  not throw. */
export function snapshotStateFile(
  configPath: string,
  log: StateBackupLog,
): SnapshotOutcome {
  try {
    if (!existsSync(configPath)) return { kind: "no-state-file" };
    const dir = stateBackupDir(configPath);
    mkdirSync(dir, { recursive: true });
    const current = readFileSync(configPath);
    const newest = listStateBackups(configPath)[0];
    if (newest && current.equals(readFileSync(join(dir, newest.file)))) {
      return { kind: "unchanged" };
    }
    // Fs-safe UTC stamp (":"/"." are path-hostile on some filesystems); a
    // same-millisecond sibling bumps a counter rather than overwriting.
    const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
    let file = `config.${stamp}.json`;
    for (let n = 2; existsSync(join(dir, file)); n += 1) {
      file = `config.${stamp}-${n}.json`;
    }
    copyFileSync(configPath, join(dir, file));
    for (const stale of listStateBackups(configPath).slice(
      STATE_BACKUP_RING_SIZE,
    )) {
      unlinkSync(join(dir, stale.file));
    }
    log.info({ file, dir }, "state backup snapshot taken");
    return { kind: "created", file };
  } catch (err) {
    log.error(
      { err, configPath },
      "state backup snapshot FAILED — continuing without one (the backup is a safety net, not a boot gate)",
    );
    return { kind: "failed" };
  }
}

/** Enumerate `configPath`'s ring, newest first (by snapshot mtime). A missing
 *  ring dir is an empty ring, not an error — every store predates its first
 *  snapshot once. */
export function listStateBackups(configPath: string): StateBackupEntry[] {
  const dir = stateBackupDir(configPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => BACKUP_FILE_RE.test(file))
    .map((file) => {
      const stat = statSync(join(dir, file));
      return { file, savedAtMs: stat.mtimeMs, sizeBytes: stat.size };
    })
    .sort((a, b) => b.savedAtMs - a.savedAtMs);
}

/** Read one snapshot's JSON — the RESTORE side, so every anomaly throws: a
 *  name that isn't a ring member's (the input crossed the wire), a missing
 *  file, unparseable bytes. The caller owns validating the parsed value
 *  against its own schema. */
export function readStateBackup(configPath: string, file: string): unknown {
  if (basename(file) !== file || !BACKUP_FILE_RE.test(file)) {
    throw new Error(`not a state-backup file name: ${JSON.stringify(file)}`);
  }
  const path = join(stateBackupDir(configPath), file);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/** Arm the slow re-snapshot tick — `unref`'d, so a live diagnostic safety net
 *  never holds the process open. Returns the disarm. */
export function startStateBackupTicker(
  configPath: string,
  log: StateBackupLog,
): () => void {
  const timer = setInterval(
    () => snapshotStateFile(configPath, log),
    STATE_BACKUP_TICK_MS,
  );
  timer.unref();
  return () => clearInterval(timer);
}
