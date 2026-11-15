/**
 * THE CONVERSATION'S TRANSCRIPT, as a file of its own —
 * `<stateDir>/conductor/transcript.json`, and the `CellStore` the conductor
 * writes it through.
 *
 * The rows used to be a key inside `config.json`. They were 90% of its bytes
 * on a real machine, and `conf` rewrites the WHOLE file on every `set` — so
 * every keystroke of a transcript re-serialized the fleet, the preferences and
 * the host map with it. Moving them out is one write of the rows where there
 * used to be one write of everything.
 *
 * ## It is part of the ONE ladder
 *
 * This file does NOT get a migration ladder of its own. It carries the version
 * `kolu-server`'s `state.ts` hands it ({@link TRANSCRIPT_FILE_VERSION}, passed
 * in rather than imported so the ladder stays the only place that says what
 * number the state root is at), and the rule is one sentence: A FUTURE CHANGE
 * TO THE ROW SHAPE IS A RUNG IN `state.ts` THAT REWRITES THIS FILE, and that
 * rung's number becomes the new `TRANSCRIPT_FILE_VERSION`. A file stamped with
 * anything else is REFUSED BY NAME — never read as a guess, never re-shaped on
 * the fly. That is the same fail-fast the conf store gives the rest of the
 * state root (`dev/skills/state/SKILL.md`), spelled for a file conf does not
 * own.
 *
 * ## Why a plain file rather than a second `Conf`
 *
 * A `Conf` would bring a second ladder, a second version line and a second set
 * of defaults for one array — exactly the "one schema, one ladder" rule's
 * failure mode. What is actually needed is an atomic owner-only write, which is
 * ten lines: temp file in the same directory (so the rename cannot cross a
 * filesystem), `0600` because a transcript carries whatever a person pasted
 * into it, then `renameSync` — a reader either sees the previous whole file or
 * the next one.
 *
 * The rows are NOT in the state-backup ring: it snapshots `config.json` alone
 * (`stateBackups.ts`), and a transcript is the one piece of this state root
 * that is re-readable from nowhere and worth nothing to a restore.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CellStore } from "@kolu/surface/server";
import { type PersistedTranscript, UnreadablePersisted } from "kolu-conductor";

/** Where the rows live, under the state root (`<KOLU_STATE_DIR>`) — beside the
 *  conductor's attachments, in the corner the conversation is named after. */
export function transcriptFilePath(stateRoot: string): string {
  return join(stateRoot, "conductor", "transcript.json");
}

/** The file's body as JSON: the stamp, then the rows verbatim. `rows` is
 *  `unknown` here because this layer is BYTES — the row shape is
 *  `PersistedTranscriptSchema`'s business, re-validated where it is read
 *  (`kolu-conductor`'s `readPersistedTranscript`), exactly as the `conductor`
 *  key is. */
interface TranscriptFileBody {
  readonly version: string;
  readonly rows: ReadonlyArray<unknown>;
}

/** Write the rows atomically, owner-only, stamped with `version`.
 *
 *  Exported because the 1.50.0 rung writes this file too — the ladder is what
 *  MOVED the rows here, so it must be able to put them there, through the same
 *  one writer rather than a copy of it. */
export function writeTranscriptFile(
  path: string,
  version: string,
  rows: ReadonlyArray<unknown>,
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body: TranscriptFileBody = { version, rows };
  // The temp name is this process's and this instant's: two kolu-servers over
  // one state root is already a fight over `config.json`, and the point of the
  // temp file is only that the RENAME is atomic — a reader never sees half a
  // transcript.
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(body), { mode: 0o600 });
  renameSync(temp, path);
}

/** Read the rows, or REFUSE naming the file — as an
 *  {@link UnreadablePersisted}, the same value the schema readers raise, so
 *  every way this file can be unreadable reaches the Conductor's screen as
 *  the same two buttons.
 *
 *  A MISSING file is a conversation that has not said anything yet (a fresh
 *  state root, or one whose ladder wrote no rows) — `{rows: []}`, not an
 *  error. Anything else is refused: unreadable JSON, a body that is not an
 *  object, or — the one this module exists to enforce — a `version` that is
 *  not the one this build writes.
 *
 *  NONE of the refusals tells anybody to delete the file. The version arm
 *  used to ("delete it to start the conversation's scrollback over"), which
 *  is kolu asking a person to do kolu's job with `rm`: *Start with an empty
 *  transcript* does exactly that, keeps the bytes in a file of its own, and
 *  says where it put them. */
export function readTranscriptFile(
  path: string,
  version: string,
  stateRoot: string,
): { readonly rows: ReadonlyArray<unknown> } {
  const refuse = (why: string, detail: string): never => {
    throw new UnreadablePersisted({
      key: "transcript",
      path,
      stateRoot,
      why,
      detail,
    });
  };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { rows: [] };
    return refuse("the file could not be read", String(err));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return refuse("the file is not valid JSON", String(err));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return refuse(
      "the file does not hold what a transcript is written as",
      "the file's top level is not an object",
    );
  }
  const body = parsed as { version?: unknown; rows?: unknown };
  if (body.version !== version) {
    // The one this module exists to enforce. The transcript file rides
    // kolu-server's one migration ladder (`state.ts`): a build that changes
    // the row shape rewrites this file in its rung, so a file stamped with
    // anything else did not come through the ladder and nothing here can
    // repair it by guessing.
    return refuse(
      `it was written by a build that stamped it ${JSON.stringify(body.version)}, and this one reads ${JSON.stringify(version)}`,
      `transcript file version ${JSON.stringify(body.version)} ≠ ${JSON.stringify(version)}`,
    );
  }
  if (!Array.isArray(body.rows)) {
    return refuse(
      "the file does not hold what a transcript is written as",
      "the file has no `rows` array",
    );
  }
  return { rows: body.rows };
}

/** The conductor's `transcript` dependency: one `CellStore` over the file.
 *
 *  Shaped exactly like `confStore`'s cells (get the whole value, set the whole
 *  value) so the conversation cannot tell which of its two records is a conf
 *  key and which is a file — and so the DECODING stays where every other
 *  persisted record's does, in the reader that re-validates it
 *  (`readPersistedTranscript`). */
export function transcriptFileStore(
  stateRoot: string,
  version: string,
): CellStore<PersistedTranscript> {
  const path = transcriptFilePath(stateRoot);
  return {
    get: () =>
      readTranscriptFile(path, version, stateRoot) as PersistedTranscript,
    set: (value) => {
      writeTranscriptFile(path, version, value.rows);
    },
  };
}
