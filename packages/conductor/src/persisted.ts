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
  type ConductorStoreKey,
} from "kolu-common/conductor";
import type { CellStore } from "@kolu/surface/server";
import { Result, Schema } from "effect";
import { WorkSchema } from "kolu-work";
import { MemberWatchSchema } from "./members.ts";

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

/** EVERY WORK KOLU REMEMBERS — in progress first, in the order they were
 *  opened, then the finished ones it still keeps (the host's own retention
 *  number). The `works` key of `config.json`.
 *
 *  The record itself, unadorned: `kolu-work`'s `Work` and nothing bolted onto
 *  it. What the HOST additionally knows about a member terminal is its own
 *  key ({@link PersistedMembersSchema}) — a watch field inside the record cost
 *  five hand-held invariants and a cast per transition, and made a work's
 *  published value move every time a terminal was renamed. */
export const PersistedWorksSchema = Schema.Array(WorkSchema);
export type PersistedWorks = typeof PersistedWorksSchema.Type;

/** WHAT KOLU KNOWS ABOUT EACH MEMBER TERMINAL, by fleet ref — the `members`
 *  key of `config.json`.
 *
 *  Its own key, beside the works rather than inside them, because it is a
 *  different thing moving on a different clock: a work is what the Conductor
 *  stated and the human decided, while this is the watch's own memory of a
 *  terminal (what it is called, what the conversation was told, whether
 *  anything has been said to it). A reader of the record is never handed it,
 *  and nothing outside this package can act on one.
 *
 *  Keyed by ref, so the member of a work and the terminal the watcher reads
 *  are the same key; an entry whose ref is no longer an active member is
 *  dropped where the membership moves, not reconciled later.
 *
 *  The VALUE is `./members.ts`'s {@link MemberWatchSchema} — the member minus
 *  its two runtime fields, taken by subtraction at the write. */
export const PersistedMembersSchema = Schema.Record(
  Schema.String,
  MemberWatchSchema,
);
export type PersistedMembers = typeof PersistedMembersSchema.Type;

/** A state dir that has never had a member. */
export const EMPTY_PERSISTED_MEMBERS: PersistedMembers = {};

/** The re-validations, compiled once. `decodeUnknownResult` is a BRANCH rather
 *  than a throw, which is what lets each failure arm name the RECORD — the
 *  one thing the screen a person is looking at has to be able to act on. */
const decodePersisted = Schema.decodeUnknownResult(PersistedConductorSchema);
const decodeTranscript = Schema.decodeUnknownResult(PersistedTranscriptSchema);
const decodeWorks = Schema.decodeUnknownResult(PersistedWorksSchema);
const decodeMembers = Schema.decodeUnknownResult(PersistedMembersSchema);

/** WHAT EACH RECORD IS CALLED IN A SENTENCE A PERSON READS, and the pronoun
 *  that follows it. Not the key name: `works` is a JSON key, and a person
 *  whose Conductor will not come up is owed a noun, not a key. */
const RECORD_WORDS: Record<
  ConductorStoreKey,
  { readonly noun: string; readonly them: string }
> = {
  conductor: { noun: "the Conductor's saved conversation", them: "it" },
  works: { noun: "the Conductor's saved works", them: "them" },
  members: {
    noun: "what the Conductor remembered about each work's terminals",
    them: "it",
  },
  transcript: { noun: "the Conductor's saved transcript", them: "it" },
};

/** A REMEMBERED RECORD THIS BUILD CANNOT READ, as a value rather than a
 *  sentence.
 *
 *  Its `message` IS the sentence the Conductor's screen shows, and it says
 *  what happened and nothing else: there is no "fix the `works` key to
 *  recover" in it, because asking a person to hand-edit JSON is not a
 *  recovery — it is kolu handing its job back. What kolu can actually do is
 *  two procedure calls (`conductor.recoverStore`), and the panel draws them
 *  as two buttons off {@link UnreadablePersisted.key} — which is why this is
 *  a class carrying the key and the file rather than a thrown string.
 *
 *  `detail` is what the decode tripped on, verbatim. It rides along for a bug
 *  report, drawn small; it is never the sentence. */
export class UnreadablePersisted extends Error {
  readonly key: ConductorStoreKey;
  readonly path: string;
  readonly detail: string;
  constructor(args: {
    key: ConductorStoreKey;
    /** The file holding the unreadable value. */
    path: string;
    /** Why it could not be read, as a clause — "the saved value is in a shape
     *  this build does not understand", "the file is not valid JSON". */
    why: string;
    detail: string;
  }) {
    const words = RECORD_WORDS[args.key];
    super(
      `kolu could not read ${words.noun} — ${args.why}. Nothing has been changed: ${args.path} still holds ${words.them}.`,
    );
    this.name = "UnreadablePersisted";
    this.key = args.key;
    this.path = args.path;
    this.detail = args.detail;
  }
}

/** The one clause every schema refusal below is said with — a shape this
 *  build does not understand, which is the honest whole of what a decode
 *  failure means to the person reading it. */
const WRONG_SHAPE =
  "the saved value is in a shape this build does not understand";

/** Read the remembered conversation out of kolu-server's state, or REFUSE
 *  naming the record.
 *
 *  There is no silent repair on purpose: patching the offending value would
 *  hand a person a record with holes in it and no way to know, and emptying
 *  it behind their back would throw away a conversation that is still on
 *  disk. The two things that ARE offered — the newest backup that reads, or
 *  starting empty with the unreadable value kept aside in a file of its own —
 *  are the person's to choose, through `conductor.recoverStore`. `conf`
 *  itself is fail-fast about an UNPARSEABLE file; this is the
 *  parseable-but-wrong case it cannot see. */
export function readPersistedConductor(
  store: CellStore<PersistedConductor>,
  path: string,
): PersistedConductor {
  const result = decodePersisted(store.get());
  if (Result.isFailure(result)) {
    throw new UnreadablePersisted({
      key: "conductor",
      path,
      why: WRONG_SHAPE,
      detail: String(result.failure),
    });
  }
  return result.success;
}

/** Read the transcript file's body, or REFUSE naming it — same stance, same
 *  reason, and the dividers collapsed on the way out
 *  ({@link oneDividerPerReset}). */
export function readPersistedTranscript(
  store: CellStore<PersistedTranscript>,
  path: string,
): PersistedTranscript {
  const result = decodeTranscript(store.get());
  if (Result.isFailure(result)) {
    throw new UnreadablePersisted({
      key: "transcript",
      path,
      why: WRONG_SHAPE,
      detail: String(result.failure),
    });
  }
  return { rows: oneDividerPerReset(result.success.rows) };
}

/** Read the remembered works, or REFUSE naming the record.
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
    throw new UnreadablePersisted({
      key: "works",
      path,
      why: WRONG_SHAPE,
      detail: String(result.failure),
    });
  }
  return result.success;
}

/** Read what kolu remembered about each member terminal, or REFUSE naming the
 *  record — the same stance as the works beside it, for the half of a member
 *  that cannot be re-derived: a bad value read past is a restart that rings
 *  the conversation about every member it was already told about. */
export function readPersistedMembers(
  store: CellStore<PersistedMembers>,
  path: string,
): PersistedMembers {
  const result = decodeMembers(store.get());
  if (Result.isFailure(result)) {
    throw new UnreadablePersisted({
      key: "members",
      path,
      why: WRONG_SHAPE,
      detail: String(result.failure),
    });
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
