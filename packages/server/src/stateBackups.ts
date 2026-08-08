/**
 * kolu-server's face of the state-backup ring (#1658) — the domain half behind
 * the `server/backups/*` root procedures. The generic ring mechanics live in
 * `kolu-shared` (shared with padi's own ring); THIS module knows
 * what a kolu-server snapshot MEANS: `preferences` / `hosts` / `viewerMode`,
 * with the fleet size as the summary (`hosts` is the store's real user data).
 *
 * Restore is IN-PROCESS — no server restart. Unlike padi's session (data that
 * maps to live terminal processes, restored through the import/respawn
 * machinery), this store is plain data served from cells: the snapshot is
 * validated through the real migration ladder on a scratch copy
 * (`decodeStateBackupFile`), `preferences`/`viewerMode` are pushed through
 * their cells' server-internal writers (every connected client updates
 * reactively, and the cell write persists through the same conf path as any
 * other change), and the host pool is CONVERGED onto the snapshot's fleet
 * through the same pool add/remove the selector strip uses — membership is a
 * pool fact with the pool as its one writer, so a restore that wrote the
 * `hosts` key behind the pool's back would fork that authority.
 */

import {
  listStateBackups,
  readStateBackup,
  snapshotStateFile,
  stateBackupPath,
} from "kolu-shared";
import type { Preferences, ViewerMode } from "kolu-common/surface";
import type {
  ServerBackupsList,
  ServerStateBackup,
} from "kolu-common/contract";
import { log } from "./log.ts";
import { decodeStateBackupFile, store } from "./state.ts";

/** Summarize one snapshot for the list — parse it and count the fleet. A
 *  snapshot that fails to parse is LISTED as `unreadable` rather than
 *  collapsing the enumeration (one corrupt snapshot must not hide the good
 *  ones); the restore side still refuses it loudly. */
function summarize(file: string): ServerStateBackup["summary"] {
  let raw: unknown;
  try {
    raw = readStateBackup(store.path, file);
  } catch (err) {
    log.error({ err, file }, "state backup snapshot is unreadable");
    return { kind: "unreadable" };
  }
  const hosts = (raw as { hosts?: unknown }).hosts;
  // A pre-W10 snapshot has no `hosts` key — an honest zero-guest fleet.
  return { kind: "state", hosts: Array.isArray(hosts) ? hosts.length : 0 };
}

/** `server/backups/list` — the ring, newest first, each snapshot summarized. */
export function listServerStateBackups(): ServerBackupsList {
  return {
    backups: listStateBackups(store.path).map((entry) => ({
      ...entry,
      summary: summarize(entry.file),
    })),
  };
}

/** The seams a restore drives, injected from the boot (`index.ts`) — the cell
 *  writers `implementKoluSurface` returns and the pool's own membership verbs. */
export interface RestoreServerStateBackupDeps {
  /** Server-internal cell writers — publish to every client AND persist through
   *  the same conf path as a wire write (dedupe + `onWrite` policy nudge ride
   *  along). */
  setPreferences: (value: Preferences) => void;
  setViewerMode: (value: ViewerMode) => void;
  /** The persisted guest fleet (encoded keys) as of now — the convergence
   *  baseline. */
  currentHostKeys: () => readonly string[];
  /** The pool's own membership verbs, by ENCODED key — the same path the
   *  strip's `hosts/add` / `hosts/remove` take, persist hook included. */
  addHostKey: (key: string) => Promise<void>;
  removeHostKey: (key: string) => Promise<void>;
}

/** `server/backups/restore` — restore one ring snapshot in-process. Fail-fast
 *  on every anomaly BEFORE anything is applied (name gate, scratch-migrate,
 *  schema decode); the current file is pushed into the ring first so the
 *  restore is itself undoable. Host-pool convergence attempts EVERY diff and
 *  then throws one aggregate naming the failures — a partially-converged fleet
 *  must surface, never collapse to a silent success. */
export async function restoreServerStateBackup(
  input: { file: string },
  deps: RestoreServerStateBackupDeps,
): Promise<void> {
  const backupPath = stateBackupPath(store.path, input.file);
  // Validate FULLY before applying anything — a throw here leaves the live
  // state untouched.
  const decoded = decodeStateBackupFile(backupPath);
  // Undoability: capture the pre-restore file before the cell writes and the
  // pool's persist hook overwrite it. Fail-soft like every snapshot.
  snapshotStateFile(store.path, log);
  log.info({ file: input.file }, "restoring server state from backup");
  deps.setPreferences(decoded.preferences);
  deps.setViewerMode(decoded.viewerMode);

  // Converge the pool onto the snapshot's fleet. Adds first (a dial failure
  // must not leave the fleet emptier than either state), then removes.
  const target = new Set(decoded.hosts);
  const current = new Set(deps.currentHostKeys());
  const failures: string[] = [];
  for (const key of decoded.hosts) {
    if (current.has(key)) continue;
    try {
      await deps.addHostKey(key);
    } catch (err) {
      log.error({ err, host: key }, "state restore: host add failed");
      failures.push(
        `add ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  for (const key of current) {
    if (target.has(key)) continue;
    try {
      await deps.removeHostKey(key);
    } catch (err) {
      log.error({ err, host: key }, "state restore: host remove failed");
      failures.push(
        `remove ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `state restored, but the host pool did not fully converge — ${failures.join("; ")}`,
    );
  }
}
