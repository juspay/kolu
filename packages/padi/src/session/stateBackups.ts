/**
 * padi's face of the state-backup ring (#1658) — the domain half behind
 * `padiSurface.procedures.backups.*`. The generic ring mechanics (snapshot ·
 * dedupe · prune · read) live in `../stateBackup.ts`; THIS module knows what a
 * padi snapshot MEANS: the `session` key is the restorable payload, and its
 * terminal count is the summary a user ranks snapshots by.
 *
 * Restore rides {@link importSession} — the SAME backfill → decode → respawn
 * machinery `session.import` uses (reuse the existing source of truth), so a
 * backup restore inherits every restore invariant (autosave freeze windows,
 * parked-token idempotency, per-spawn compensation) instead of duplicating a
 * second restore path. It never restarts padi: the session is data plus live
 * terminals, and the import path is precisely the "turn data back into live
 * terminals" writer.
 */

import { join } from "node:path";
import { log } from "../log.ts";
import {
  listStateBackups,
  readStateBackup,
  snapshotStateFile,
} from "kolu-shared";
import { importSession } from "./sessionRestore.ts";
import type { PadiStateBackup } from "../surface.ts";
import type { SavedSession } from "../vocab.ts";

/** padi's state file under its state-root — the one path this module derives. */
function padiConfigPath(stateRoot: string): string {
  return join(stateRoot, "config.json");
}

/** Summarize one snapshot for the list: parse it and count the session's
 *  terminals. A snapshot that fails to parse is LISTED as `unreadable` rather
 *  than collapsing the whole enumeration — one corrupt snapshot must not make
 *  the nine good ones unreachable (that would defeat the safety net); the
 *  restore side still refuses it loudly. */
function summarize(
  configPath: string,
  file: string,
): PadiStateBackup["summary"] {
  let raw: unknown;
  try {
    raw = readStateBackup(configPath, file);
  } catch (err) {
    log.error({ err, file }, "state backup snapshot is unreadable");
    return { kind: "unreadable" };
  }
  const session = (raw as { session?: unknown }).session;
  if (
    session !== null &&
    typeof session === "object" &&
    Array.isArray((session as { terminals?: unknown }).terminals)
  ) {
    return {
      kind: "session",
      terminals: (session as { terminals: unknown[] }).terminals.length,
    };
  }
  return { kind: "empty" };
}

/** `backups.list` — the ring, newest first, each snapshot summarized. */
export function listPadiStateBackups(stateRoot: string): {
  backups: PadiStateBackup[];
} {
  const configPath = padiConfigPath(stateRoot);
  return {
    backups: listStateBackups(configPath).map((entry) => ({
      ...entry,
      summary: summarize(configPath, entry.file),
    })),
  };
}

/** `backups.restore` — restore the session one snapshot holds. Fail-fast on
 *  every anomaly (a non-ring name, unreadable bytes, a snapshot with no
 *  session): a restore that proceeds from a bad snapshot is the data-loss class
 *  the ring exists to prevent. The CURRENT state file is pushed into the ring
 *  first, so the restore is itself undoable. */
export async function restorePadiStateBackup(
  stateRoot: string,
  input: {
    file: string;
    resumeAgents?: boolean;
    optOutIds?: readonly string[];
  },
): Promise<{ activeTerminalId: string | null }> {
  const configPath = padiConfigPath(stateRoot);
  const raw = readStateBackup(configPath, input.file);
  const session = (raw as { session?: unknown }).session;
  if (
    session === null ||
    session === undefined ||
    typeof session !== "object"
  ) {
    throw new Error(`state backup ${input.file} holds no session to restore`);
  }
  // Undoability: capture the pre-restore file before the import's persist
  // overwrites it. Fail-soft like every snapshot — a full ring dir must not
  // block the recovery the user is mid-way through.
  snapshotStateFile(configPath, log);
  log.info({ file: input.file }, "restoring session from state backup");
  // The import DECODES (backfill ladder + SavedSessionSchema, fail-fast), so
  // this cast only carries the raw value to the validator, not past it.
  return await importSession({
    session: session as SavedSession,
    resumeAgents: input.resumeAgents,
    ...(input.optOutIds === undefined ? {} : { optOutIds: input.optOutIds }),
  });
}
