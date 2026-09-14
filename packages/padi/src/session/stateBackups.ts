/**
 * padi's face of the state-backup ring (#1658) — the domain half behind
 * `padiSurface.procedures.backups.*`. The generic ring mechanics (snapshot ·
 * dedupe · prune · read · undoable restore) live in `kolu-shared`'s
 * `stateBackup.ts`; THIS module knows what a padi snapshot MEANS: the `session`
 * key is the restorable payload, and its terminal count is the summary a user
 * ranks snapshots by.
 *
 * Restore rides {@link importSession} — the SAME backfill → decode → respawn
 * machinery `session.import` uses (reuse the existing source of truth), so a
 * backup restore inherits every restore invariant (autosave freeze windows,
 * parked-token idempotency, per-spawn compensation) instead of duplicating a
 * second restore path. It never restarts padi: the session is data plus live
 * terminals, and the import path is precisely the "turn data back into live
 * terminals" writer.
 */

import type { PadiStateBackup, SavedSession } from "@kolu/padi-client/surface";
import type { StateBackupEntry } from "kolu-shared/state-backup";
import { log } from "../log.ts";
import { importSession } from "./sessionRestore.ts";
import { padiStateBackupRing } from "./stateStore.ts";

/** The ring's own entry shape and the wire's agree field-for-field — the
 *  `...entry` spread below type-checks BECAUSE of this line, not by coincidence
 *  (`@kolu/padi` may not import `kolu-common`, so one shared schema is not
 *  reachable; this is the tie that is). */
type _RingEntryMatchesWire =
  StateBackupEntry extends Omit<PadiStateBackup, "summary">
    ? true
    : ["wire shape drifted from kolu-shared's StateBackupEntry"];
const _ringEntryMatchesWire: _RingEntryMatchesWire = true;
void _ringEntryMatchesWire;

/** Summarize one PARSED snapshot: count the session's terminals. A snapshot that
 *  fails to parse never reaches here — the ring lists it as `unreadable` rather
 *  than collapsing the whole enumeration (one corrupt snapshot must not make the
 *  nine good ones unreachable); the restore side still refuses it loudly. */
function summarize(raw: unknown): PadiStateBackup["summary"] {
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
  return {
    backups: padiStateBackupRing(stateRoot).listWith<
      PadiStateBackup["summary"]
    >(summarize, { kind: "unreadable" }),
  };
}

/** `backups.restore` — restore the session one snapshot holds. Fail-fast on
 *  every anomaly (a non-ring name, unreadable bytes, a failed undo snapshot, a
 *  snapshot with no session): a restore that proceeds from a bad snapshot is the
 *  data-loss class the ring exists to prevent. The ring pushes the CURRENT state
 *  file into itself first, so the restore is itself undoable. */
export async function restorePadiStateBackup(
  stateRoot: string,
  input: {
    file: string;
    resumeAgents?: boolean;
    optOutIds?: readonly string[];
  },
): Promise<void> {
  await padiStateBackupRing(stateRoot).restore(input.file, async (raw) => {
    const session = (raw as { session?: unknown }).session;
    if (
      session === null ||
      session === undefined ||
      typeof session !== "object"
    ) {
      throw new Error(`state backup ${input.file} holds no session to restore`);
    }
    log.info({ file: input.file }, "restoring session from state backup");
    // The import DECODES (backfill ladder + SavedSessionSchema, fail-fast), so
    // this cast only carries the raw value to the validator, not past it.
    await importSession({
      session: session as SavedSession,
      resumeAgents: input.resumeAgents,
      ...(input.optOutIds === undefined ? {} : { optOutIds: input.optOutIds }),
    });
  });
}
