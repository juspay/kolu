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

export interface ConductorRecoveryDeps {
  readonly state: () => ConductorState;
  readonly reload: () => void;
}

const NOUN: Record<ConductorStoreKey, string> = {
  conductor: "the Conductor's saved conversation",
  works: "the Conductor's saved works",
  members: "what kolu remembered about each work's terminals",
  transcript: "the Conductor's saved transcript",
};

function refuse(why: string): never {
  throw new ConductorRefused({ why });
}

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

function keepAsideAndEmpty(key: ConductorStoreKey): string {
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
  if (key === "works") store.set("works", EMPTY_PERSISTED_WORKS);
  if (key === "members") store.set("members", EMPTY_PERSISTED_MEMBERS);
  if (key === "conductor") store.set("conductor", EMPTY_PERSISTED_CONDUCTOR);
  return path;
}

type WorkRecord = Pick<DecodedStateBackup, "works" | "members">;

function writeWorkRecord(record: WorkRecord): string {
  store.set("works", record.works);
  store.set("members", record.members);
  const works = Object.keys(record.works).length;
  const members = Object.keys(record.members).length;
  return `${works} piece${works === 1 ? "" : "s"} of work came back, with what kolu knew about ${members} terminal${members === 1 ? "" : "s"}`;
}

function writeFromBackup(
  key: ConductorStoreKey,
  decoded: DecodedStateBackup,
): string {
  if (key === "conductor") {
    store.set("conductor", decoded.conductor);
    return "the conversation it remembered came back";
  }
  return writeWorkRecord(decoded);
}

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
    refuse(
      "kolu's state backups hold config.json and nothing else, so there is no saved copy of the transcript to restore. Starting with an empty transcript keeps the unreadable one in a file of its own.",
    );
  } else {
    const found = newestThatReads();
    const what = stateBackupRing.restore(found.file, (raw) =>
      writeFromBackup(input.key, decodeStateBackup(raw, found.file)),
    );
    log.info(
      { file: found.file, key: input.key },
      "conductor recovery: restored from the newest backup that reads",
    );
    const taken = new Date(found.savedAtMs)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
    did = `Took the backup from ${taken} UTC (${found.file}), the newest one this build can read: ${what}. The store as it was is in the backup ring too, so this is undoable.`;
  }
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
