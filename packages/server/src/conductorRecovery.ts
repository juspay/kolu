/**
 * THE TWO THINGS KOLU CAN DO ABOUT A RECORD IT CANNOT READ — `conductor.recoverStore`'s
 * domain half.
 *
 * A persisted record that does not decode used to end in a sentence telling a
 * person to "fix the `works` key to recover": kolu handing its own job back to
 * somebody holding a 300 KB JSON file, in a state directory they have never
 * opened, about a shape only this build knows. That is not a recovery. These
 * two are:
 *
 *  - RESTORE THE NEWEST BACKUP THAT READS — walk the state-backup ring newest
 *    first, decode each snapshot through the REAL migration ladder
 *    (`decodeStateBackup`, the same validation `server/backups/restore` runs),
 *    and take the first one that comes through whole. The newest snapshots
 *    usually carry the corruption, which is exactly why the walk cannot stop
 *    at the top of the ring.
 *  - START WITH THE RECORD EMPTY — move the unreadable value ASIDE into a file
 *    of its own beside `config.json`, named for the record and the moment, and
 *    start that record empty. Never a silent reset: the bytes are still there
 *    and the answer says where.
 *
 * SCOPED TO THE CONDUCTOR'S OWN RECORDS, deliberately. `stateBackups.ts`'s
 * `restoreServerStateBackup` restores a WHOLE snapshot — preferences, the host
 * pool, the works — which is right for a person who opened the restore dialog
 * and picked a row, and wrong here: what they pressed is a button under "kolu
 * could not read the Conductor's saved works", and reverting their fleet and
 * their preferences as a side effect of it is a surprise nobody asked for. So
 * this takes the SAME snapshot, decoded by the same function, and writes only
 * the records the refusal was about. The ring's own `restore` verb carries the
 * walk, so the pre-restore undo snapshot it takes happens here too: a recovery
 * is itself undoable from the backups dialog, exactly as every other restore is.
 *
 * THE SERVER DOES NOT RESTART. The records are written, then the live host is
 * asked to read them again (`ConductorHost.reloadRecords`) — a refusal is
 * all-or-nothing, so a host that is refusing has loaded nothing and a reload is
 * its first read tried again.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConductorState, ConductorStoreKey } from "kolu-common/conductor";
import { ConductorRefused } from "kolu-common/conductorErrors";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  EMPTY_PERSISTED_MEMBERS,
  EMPTY_PERSISTED_WORKS,
} from "kolu-conductor";
import { transcriptFilePath } from "./conductor/transcriptFile.ts";
import { log } from "./log.ts";
import {
  type DecodedStateBackup,
  decodeStateBackup,
  stateBackupRing,
  store,
} from "./state.ts";

/** The live conversation, as the two seams a recovery needs: what it is
 *  refusing right now, and "read your records again". Injected rather than
 *  imported so a test drives a host of its own — the same shape
 *  `stateBackups.ts` takes `restoreWorks` in. */
export interface ConductorRecoveryDeps {
  readonly state: () => ConductorState;
  readonly reload: () => void;
}

/** What each record is called in the answer a person reads. The same nouns
 *  `kolu-conductor`'s refusal uses, in the possessive-free form a sentence
 *  about an ACT wants ("Restored the Conductor's saved works…"). */
const NOUN: Record<ConductorStoreKey, string> = {
  conductor: "the Conductor's saved conversation",
  works: "the Conductor's saved works",
  members: "what kolu remembered about each work's terminals",
  transcript: "the Conductor's saved transcript",
};

/** The refusal every no here is said with.
 *
 *  The TYPE is on the binding rather than on the arrow so TypeScript reads a
 *  call to it as never-returning: that is what lets each refusal below be a
 *  statement, with nothing dead written after it to convince the compiler. */
const refuse: (why: string) => never = (why) => {
  throw new ConductorRefused({ why });
};

/** THE WALK — every snapshot in the ring, newest first, decoded through the
 *  real ladder; the first that comes through whole wins. A snapshot that does
 *  not decode is not an error here (the newest ones usually carry the
 *  corruption that started all this); it is a row to step over, logged. */
function newestThatReads(): {
  file: string;
  savedAtMs: number;
  decoded: DecodedStateBackup;
} {
  const ring = stateBackupRing.list();
  if (ring.length === 0) {
    refuse(
      "kolu has no state backups to restore from — this state directory has never been snapshotted.",
    );
  }
  for (const entry of ring) {
    try {
      const decoded = decodeStateBackup(
        stateBackupRing.read(entry.file),
        entry.file,
      );
      return { file: entry.file, savedAtMs: entry.savedAtMs, decoded };
    } catch (err) {
      log.warn(
        { err, file: entry.file },
        "conductor recovery: a backup did not read, trying the one before it",
      );
    }
  }
  return refuse(
    `no backup reads either — kolu has ${ring.length} saved snapshot${ring.length === 1 ? "" : "s"} of this state directory and none of them can be read by this build. Starting with the record empty keeps the unreadable one in a file of its own.`,
  );
}

/** Keep the unreadable value, then start the record empty.
 *
 *  The three conf keys are COPIED out (the value is JSON in a file holding
 *  three other records, so what is kept is the value alone, pretty-printed and
 *  readable); the transcript is its own file and is MOVED, bytes untouched —
 *  which also covers the arms where those bytes are not JSON at all. */
function keepAsideAndEmpty(key: ConductorStoreKey): string {
  // `<stateRoot>/conductor/unreadable-<key>-<when>.json`: beside the
  // conductor's attachments and its transcript, in the corner the
  // conversation is named after, with the colons taken out of the stamp for
  // the reason the backup ring takes them out of its own names — a file name
  // a person types is a file name without colons in it.
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const path = join(
    dirname(store.path),
    "conductor",
    `unreadable-${key}-${stamp}.json`,
  );
  mkdirSync(dirname(path), { recursive: true });
  if (key === "transcript") {
    renameSync(transcriptFilePath(dirname(store.path)), path);
    return path;
  }
  writeFileSync(path, `${JSON.stringify(store.get(key) ?? null, null, 2)}\n`, {
    mode: 0o600,
  });
  // The store is the one holding the unreadable value, so the write that
  // empties the record goes straight to the key: the live host is refusing,
  // which means it has read nothing and is writing nothing — there is no
  // second writer to fork here, and there will not be one until the reload
  // below hands it the records it can finally read.
  if (key === "works") store.set("works", EMPTY_PERSISTED_WORKS);
  if (key === "members") store.set("members", EMPTY_PERSISTED_MEMBERS);
  if (key === "conductor") store.set("conductor", EMPTY_PERSISTED_CONDUCTOR);
  return path;
}

/** Write back the records a snapshot holds for `key`.
 *
 *  `works` and `members` travel TOGETHER whichever of the two was unreadable —
 *  they are two halves of one restore, and works without the bookkeeping that
 *  goes with their terminals come back as members nobody has ever read, which
 *  rings the conversation about every state it was already told about (the
 *  argument `stateBackups.ts` makes about `restoreWorks`). */
function writeFromBackup(
  key: ConductorStoreKey,
  decoded: DecodedStateBackup,
): string {
  if (key === "conductor") {
    store.set("conductor", decoded.conductor);
    return "the conversation it remembered came back";
  }
  store.set("works", decoded.works);
  store.set("members", decoded.members);
  const works = Object.keys(decoded.works).length;
  const members = Object.keys(decoded.members).length;
  return `${works} piece${works === 1 ? "" : "s"} of work came back, with what kolu knew about ${members} terminal${members === 1 ? "" : "s"}`;
}

/**
 * `conductor.recoverStore` — put a record kolu cannot read back in a state it
 * can, and hand the running conversation its records.
 *
 * Refuses (never crashes) when there is nothing to recover, when the record
 * named is not the one being refused, and when the chosen way cannot work —
 * every one of those is a sentence a person reads and acts on.
 */
export function recoverConductorStore(
  input: { key: ConductorStoreKey; how: "backup" | "empty" },
  deps: ConductorRecoveryDeps,
): { said: string } {
  const unreadable = deps.state().unreadable;
  if (unreadable === null) {
    refuse(
      "There is nothing to recover: kolu can read the Conductor's records.",
    );
  } else if (unreadable.key !== input.key) {
    refuse(
      `kolu is not refusing that record any more — what it cannot read now is ${NOUN[unreadable.key]}.`,
    );
  }
  let did: string;
  if (input.how === "empty") {
    const kept = keepAsideAndEmpty(input.key);
    did = `Kept ${NOUN[input.key]} in ${kept} — nothing was deleted — and started ${input.key === "transcript" ? "an empty transcript" : "with that record empty"}.`;
  } else if (input.key === "transcript") {
    // The ring snapshots `config.json`'s bytes and nothing else (`state.ts`
    // says why: the transcript is most of the conversation's bytes and moves
    // on every keystroke), so there is no saved copy of this file anywhere.
    refuse(
      "kolu's state backups hold config.json and nothing else, so there is no saved copy of the transcript to restore. Starting with an empty transcript keeps the unreadable one in a file of its own.",
    );
  } else {
    const found = newestThatReads();
    // Through the ring's own restore verb, so the CURRENT store is pushed
    // into the ring before anything is written: a recovery is undoable from
    // the backups dialog exactly as every other restore is, and the unreadable
    // value a person may still want is in the ring rather than only in a
    // sentence. `apply` is handed the value the ring read — nothing re-reads
    // the member's path, which the undo snapshot's prune could race.
    const what = stateBackupRing.restore(found.file, (raw) =>
      writeFromBackup(input.key, decodeStateBackup(raw, found.file)),
    );
    log.info(
      { file: found.file, key: input.key },
      "conductor recovery: restored from the newest backup that reads",
    );
    // UTC, to the minute — what a person matches against the row in the
    // backups dialog.
    const taken = new Date(found.savedAtMs)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
    did = `Took the backup from ${taken} UTC (${found.file}), the newest one this build can read: ${what}. The store as it was is in the backup ring too, so this is undoable.`;
  }
  // ...and the running conversation reads its records, with no restart. A
  // reload that trips again means a SECOND record is unreadable — the act
  // above still happened, and the panel is already drawing the next refusal's
  // own two buttons off the state the host just published, so this says both
  // facts rather than throwing one of them away.
  try {
    deps.reload();
  } catch {
    const next = deps.state().refusal;
    return {
      said: `${did} The Conductor still cannot come up: ${next ?? "its records did not read."}`,
    };
  }
  return { said: `${did} The Conductor is up.` };
}
