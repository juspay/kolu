/**
 * WHAT SURVIVES A kolu-server RESTART — the conversation, the transcript, and
 * the WORKS.
 *
 * kolu-server is restarted on every upgrade, so a restart is the NORMAL path
 * rather than a crash recovery: a person who was mid-conversation when a new
 * kolu landed should come back to the same conversation, not to an empty panel
 * with a sentence about why. That makes resume the default and these records
 * the things that make it possible.
 *
 * THREE RECORDS, because they survive differently and are written at different
 * cadences:
 *
 *  - {@link PersistedConductorSchema} — the CONVERSATION, in `config.json`'s
 *    `conductor` key: the session to replay, the directory it was opened in,
 *    the model a person chose, and the terminals it has touched. Small, and
 *    rewritten whenever the conversation moves.
 *  - {@link PersistedTranscriptSchema} — the ROWS, in their own file
 *    (`<stateDir>/conductor/transcript.json`). They are what made the state
 *    file large and rewritten at an agent's output cadence, and they are the
 *    one part of the record nothing else in kolu reads.
 *  - {@link PersistedWorksSchema} — the WORKS, in `config.json`'s `works` key.
 *    A piece of work OUTLIVES the conversation that opened it: "New session"
 *    clears the chat and keeps the work, so the work cannot live inside the
 *    conversation's record.
 *
 * WHAT IS IN THE CONVERSATION'S RECORD, and why each of the four:
 *
 *  - `sessionId` — the agent's own id for the conversation, replayed with
 *    `session/load`. It means nothing to any other agent, so a stored id is
 *    only ever handed back to the agent that minted it — and only when the
 *    rows say the conversation had a turn: an id nobody spoke into names
 *    nothing in the agent's store (`conductor.ts`'s `hadATurn`). Whether it
 *    did is read off the transcript, not saved beside the id.
 *  - `cwd` — the directory the session was opened in. It is what makes a stored
 *    session findable at all (Claude scopes its store by prefix), so a
 *    kolu-server whose `$HOME` moved must open a fresh session rather than ask
 *    for one the agent will refuse.
 *  - `model` — the model a person CHOSE. The agent re-asserts its own default
 *    over a resumed conversation's model (`ANTHROPIC_MODEL`, then
 *    `settings.json`, then what the conversation was running), so a choice made
 *    here is the half that loses unless it is re-applied. Only a switch kolu
 *    SAW is remembered: a conversation that never left the machine's default
 *    comes back on the machine's default, because pinning a conversation to
 *    whatever the default resolved to that day would be inventing a choice
 *    nobody made.
 *  - `fleet` — which terminals this conversation has touched, as FLEET REFS
 *    (`host/id`). Membership only; every live fact about those terminals is
 *    read from that host's `terminals` collection, so a stale row cannot
 *    outlive the terminal it names.
 *
 * WHAT IS DELIBERATELY NOT HERE: the phase, the usage, the roster, the open
 * asks, the sign-in attempt. Every one of them is a fact about a subprocess
 * that no longer exists, and a restored one would be a lie with a timestamp on
 * it. They come back from the live agent or they do not come back.
 */

import {
  type ConductorRow,
  ConductorRowSchema,
  type ConductorState,
  ConductorWakeLevelSchema,
} from "kolu-common/conductor";
import type { CellStore } from "@kolu/surface/server";
import { Result, Schema } from "effect";
import { FLEET_WATCH_JOINS } from "kolu-mcp/fleetWatchJoin";
import { WorkMemberSchema, WorkSchema } from "kolu-work";

/** The conversation's SHAPE, as a schema rather than as an interface alone.
 *
 *  `confStore` hands back whatever is on disk under a cast — it decodes
 *  nothing — so without this the conductor would restore a hand-edited (or
 *  half-written) `conductor` key straight into a served cell. Re-validated
 *  where it is READ ({@link readPersistedConductor}), exactly as
 *  `getPersistedHosts` re-validates the server's `hosts` key: a
 *  parseable-but-invalid value is REFUSED loud, never normalized away and
 *  never collapsed to an empty conversation. */
export const PersistedConductorSchema = Schema.Struct({
  sessionId: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** Fleet refs (`<encodedHostKey>/<terminalId>`), not bare ids — one
   *  conversation spans every host, and a bare id would name two terminals on
   *  a two-host fleet. */
  fleet: Schema.Array(Schema.String),
});

/** The record as a value. Derived from the schema rather than declared beside
 *  it, so the two cannot drift into disagreeing about what is on disk. */
export type PersistedConductor = typeof PersistedConductorSchema.Type;

/** An untouched state dir's record: no conversation, nothing to resume. */
export const EMPTY_PERSISTED_CONDUCTOR: PersistedConductor = {
  sessionId: null,
  cwd: "",
  model: null,
  fleet: [],
};

/** THE TRANSCRIPT FILE'S BODY — the rows, and nothing else.
 *
 *  Its own file rather than a key of `config.json` because of what the rows
 *  COST where they were: a streaming answer is one row and six hundred frames,
 *  and the state file holds the host map and the preferences beside them, so
 *  every one of those frames rewrote the whole of kolu's state. The file is
 *  still part of kolu's ONE ladder — `kolu-server`'s `state.ts` stamps and
 *  rewrites it, and a version it does not recognise is refused by name — so a
 *  future change to the row shape is a rung there, never a second ladder here.
 *
 *  `rows` is the WIRE row on the `koluSurface` ladder, read back off a file on
 *  the kolu-server `SCHEMA_VERSION` one — so the first NON-ADDITIVE change to
 *  `ConductorRowSchema` owes that ladder a rung ({@link ROW_CAP} bounds what is
 *  lost); nothing else can repair a file this schema no longer decodes. */
export const PersistedTranscriptSchema = Schema.Struct({
  rows: Schema.Array(ConductorRowSchema),
});
export type PersistedTranscript = typeof PersistedTranscriptSchema.Type;

/** A state dir with no transcript file yet. */
export const EMPTY_PERSISTED_TRANSCRIPT: PersistedTranscript = { rows: [] };

/** ONE MEMBER'S WAKE BOOKKEEPING — today's watch-list entry, now a field of the
 *  member it was always about.
 *
 *  Everything here is a fact a restart cannot re-derive: what kolu last saw the
 *  terminal called, whether an agent was ever seen in it (a terminal that never
 *  held one is silent when it goes), the level the conversation has already
 *  been TOLD about, and the three that say how to read the next sighting — how
 *  the terminal came to be a member, whether anything has been said to the
 *  agent in it, and whether a command was ever seen running in it.
 *
 *  `told` is what makes a restart quiet: kolu looks at every member terminal
 *  again, and one that is still stopped for the reason it was stopped before
 *  the restart does not ring a second time. What is NOT here is the held news —
 *  a restart re-reads the world instead of replaying a queue about one that has
 *  moved on — nor the last reading, which is this process's own.
 *
 *  NO DECODING DEFAULTS, here or on any key: the schema says what the file
 *  holds, and making an older file hold it is the ladder's job (`kolu-server`'s
 *  `state.ts`). A file the ladder did not bring here is refused by name, never
 *  read as a guess. */
export const MemberWatchSchema = Schema.Struct({
  /** What kolu last saw the terminal called — so a wake can name it even when
   *  the host it is on has stopped answering. */
  name: Schema.String,
  /** The agent kolu detected in it, or `null` for a terminal no agent has ever
   *  been seen in. STICKY: an agent that exited leaves a shell behind, and the
   *  fact that one was once there is what makes its death worth telling. */
  agent: Schema.NullOr(Schema.String),
  /** The level the conversation has already been told about, or `null`. */
  told: Schema.NullOr(ConductorWakeLevelSchema),
  /** How this terminal came to be a member — built from the one tuple the word
   *  is spelled in (`kolu-mcp/fleetWatchJoin`), which the fleet face's wire
   *  schema and this module's `WatchJoin` also build from: a join a tool can
   *  record is a join this file can read back. */
  joined: Schema.Literals([...FLEET_WATCH_JOINS]),
  /** Whether the Conductor has said anything to the agent in it. What `ready`
   *  turns on, and therefore worth surviving a restart: an agent briefed before
   *  the restart must not ring as a fresh one after it. */
  spoken: Schema.Boolean,
  /** Whether a non-shell foreground was ever seen in it — the other half of
   *  `ended`, and across a restart the only way to know that the command kolu
   *  typed ever started. */
  ran: Schema.Boolean,
  /** THE WORKTREE kolu last read for this terminal, on its host — where its
   *  work's files are listed from, and where they are copied from when the work
   *  ends. `null` until a reading has said. Remembered because the terminal may
   *  be gone by the time the work ends, and the files outlive it. */
  worktree: Schema.NullOr(Schema.String),
});
export type MemberWatch = typeof MemberWatchSchema.Type;

/** A work's member, as kolu stores it: the model's member ({@link
 *  WorkMemberSchema} — the terminal, its role, when it joined and when it left)
 *  plus the watch's own bookkeeping about that terminal.
 *
 *  SPREAD rather than nested-and-re-declared, so a field added to the model's
 *  member arrives here with no edit, and the stored work decodes into a `Work`
 *  by structural widening — which is what lets every pure fold in `kolu-work`
 *  run over the stored value directly. */
export const StoredMemberSchema = Schema.Struct({
  ...WorkMemberSchema.fields,
  watch: MemberWatchSchema,
});
export type StoredMember = typeof StoredMemberSchema.Type;

/** A work, as kolu stores it: the model's work with stored members. */
export const StoredWorkSchema = Schema.Struct({
  ...WorkSchema.fields,
  members: Schema.Array(StoredMemberSchema),
});
export type StoredWork = typeof StoredWorkSchema.Type;

/** EVERY WORK KOLU REMEMBERS — in progress first, in the order they were
 *  opened, then the finished ones it still keeps (`kolu-work`'s
 *  `FINISHED_KEPT`). The `works` key of `config.json`. */
export const PersistedWorksSchema = Schema.Array(StoredWorkSchema);
export type PersistedWorks = typeof PersistedWorksSchema.Type;

/** The re-validations, compiled once. `decodeUnknownResult` is a BRANCH rather
 *  than a throw, which is what lets each failure arm name the FILE — the one
 *  thing a person holding a corrupt state file has to act on. */
const decodePersisted = Schema.decodeUnknownResult(PersistedConductorSchema);
const decodeTranscript = Schema.decodeUnknownResult(PersistedTranscriptSchema);
const decodeWorks = Schema.decodeUnknownResult(PersistedWorksSchema);

/** Read the remembered conversation out of kolu-server's state, or CRASH naming
 *  the file.
 *
 *  There is no recovery arm on purpose. The two silent alternatives are both
 *  worse than a loud stop: repairing the offending value would hand a person a
 *  record with holes in it and no way to know, and starting empty would throw
 *  away a conversation that is still on disk and still readable by hand.
 *  `conf` itself is fail-fast about an UNPARSEABLE file; this is the
 *  parseable-but-wrong case it cannot see. */
export function readPersistedConductor(
  store: CellStore<PersistedConductor>,
  path: string,
): PersistedConductor {
  const result = decodePersisted(store.get());
  if (Result.isFailure(result)) {
    throw new Error(
      `the remembered conductor in ${path} does not match schema (${String(result.failure)}). Fix the \`conductor\` key to recover.`,
    );
  }
  return result.success;
}

/** Read the transcript file's body, or CRASH naming it — same stance, same
 *  reason, and the dividers collapsed on the way out
 *  ({@link oneDividerPerReset}). */
export function readPersistedTranscript(
  store: CellStore<PersistedTranscript>,
  path: string,
): PersistedTranscript {
  const result = decodeTranscript(store.get());
  if (Result.isFailure(result)) {
    throw new Error(
      `the remembered transcript in ${path} does not match schema (${String(result.failure)}). Fix or delete that file to recover.`,
    );
  }
  return { rows: oneDividerPerReset(result.success.rows) };
}

/** Read the remembered works, or CRASH naming the file.
 *
 *  Loudest of the three on purpose: a work carries the human's DECISIONS, and
 *  there is no second copy of them anywhere. Reading past a bad value would
 *  silently drop a piece of work somebody is in the middle of. */
export function readPersistedWorks(
  store: CellStore<PersistedWorks>,
  path: string,
): PersistedWorks {
  const result = decodeWorks(store.get());
  if (Result.isFailure(result)) {
    throw new Error(
      `the remembered works in ${path} do not match schema (${String(result.failure)}). Fix the \`works\` key to recover.`,
    );
  }
  return result.success;
}

/** Collapse every RUN of consecutive dividers to the first of them.
 *
 *  A divider means one thing — the agent's memory was reset — so a run of
 *  four in a row cannot be four resets with nothing between them: it is one
 *  reset written four times, by however many bring-ups wrote it. The first is
 *  the one kept, because the reset happened at the first; keeping the last
 *  would draw the line later than the event it marks.
 *
 *  On the READ rather than only at the writer, and deliberately: the records
 *  already on disk carry the runs, and a fix that only stopped new ones from
 *  being written would leave every state file that saw the bug showing them
 *  forever. `rows` arrives in `seq` order ({@link transcriptFrom} writes the
 *  host's sorted array), so "consecutive" is a neighbour test and not a sort. */
function oneDividerPerReset(
  rows: ReadonlyArray<ConductorRow>,
): ReadonlyArray<ConductorRow> {
  const kept: ConductorRow[] = [];
  let previousWasDivider = false;
  for (const row of rows) {
    const divider = row.kind === "divider";
    if (!(divider && previousWasDivider)) kept.push(row);
    previousWasDivider = divider;
  }
  return kept.length === rows.length ? rows : kept;
}

/** What to write back after the conversation moved.
 *
 *  Derived from the live state rather than accumulated beside it, so the record
 *  cannot disagree with what a reader is looking at. */
export function persistedFrom(state: ConductorState): PersistedConductor {
  return {
    sessionId: state.sessionId,
    cwd: state.cwd,
    model: state.model?.id ?? null,
    fleet: state.fleet,
  };
}

/** What the transcript FILE holds after the rows moved.
 *
 *  The row cap is a bound on the FILE, not on the panel: a conversation that
 *  has run for a week is still whole in memory, and what a restart brings back
 *  is its tail — which is the half a person scrolls to anyway.
 *
 *  THE ROWS GO THROUGH UNTOUCHED, attachments included, because an attachment
 *  carries no bytes to strip: it is a name, a size and the path kolu-server
 *  wrote the file to. A row restored from here is therefore the same value it
 *  was when it was minted — which is what makes "send again" on an hour-old
 *  message read the same file the first send did. The thumbnail is the only
 *  thing that does not survive, and it never left the browser that drew it. */
export function transcriptFrom(
  rows: ReadonlyArray<ConductorRow>,
): PersistedTranscript {
  return {
    rows: rows.length > ROW_CAP ? rows.slice(rows.length - ROW_CAP) : rows,
  };
}

/** Re-point every remembered attachment at the directory the bytes are in NOW.
 *
 *  An attachment's `path` is ABSOLUTE — the agent is handed it and the harness
 *  reads the file off it — so the one thing that can invalidate a whole
 *  transcript's worth of them is the directory moving underneath. It moves
 *  exactly once: kolu-server's 1.45.0 ladder rung renames the conversation's
 *  corner of the state root when the conversation itself is renamed, and a
 *  record carried across without this would draw chips for files at an address
 *  nothing writes to any more.
 *
 *  GENERIC over the record that holds the rows, because the rows have MOVED:
 *  the 1.45.0 rung is frozen history and runs against a `conductor` key that
 *  still held them, while a live repoint today is of the transcript file. One
 *  rewrite, either carrier.
 *
 *  Pure, and a prefix swap rather than a re-join: a path that does NOT start
 *  at the old corner was not written by this server's attachment writer, and
 *  rebuilding it would be inventing a location for somebody else's file. */
export function repointConductorAttachments<
  T extends { readonly rows: ReadonlyArray<ConductorRow> },
>(record: T, from: string, to: string): T {
  return {
    ...record,
    rows: record.rows.map((row) =>
      row.kind === "user"
        ? {
            ...row,
            attachments: row.attachments.map((one) =>
              one.path.startsWith(from)
                ? { ...one, path: `${to}${one.path.slice(from.length)}` }
                : one,
            ),
          }
        : row,
    ),
  };
}

/** How many transcript rows the file keeps.
 *
 *  Chosen for the file rather than for the screen: a transcript is
 *  reconstructible from the agent's own replay in a way nothing else kolu saves
 *  is, so this is the cheapest thing to bound. Four hundred rows is a long
 *  conversation's tail and a file a person can still open in an editor. */
export const ROW_CAP = 400;
