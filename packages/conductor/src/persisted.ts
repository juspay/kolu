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
import {
  InvalidWorkStore,
  memberSchemaWith,
  parseStore,
  type Work,
  type WorkId,
  WorkSchema,
} from "kolu-work";
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

/** EVERY WORK KOLU REMEMBERS — the `works` key of `config.json`, a JSON
 *  OBJECT keyed by the work's own id (`workIdOf` of its key).
 *
 *  An object rather than an array, and that is the whole of what makes "one
 *  work per branch" true: two works with one key cannot both be in it. The
 *  value is `kolu-work`'s `Work`, unadorned. What the HOST additionally knows
 *  about a member terminal rides in the `members` key
 *  ({@link PersistedMembersSchema}), where the membership itself now lives. */
export const PersistedWorksSchema = Schema.Record(Schema.String, WorkSchema);
export type PersistedWorks = typeof PersistedWorksSchema.Type;

/** EVERY MEMBER TERMINAL, by fleet ref — the `members` key of `config.json`.
 *
 *  ONE MAP, holding both halves of a member: what the model says it is (which
 *  work, which role, since when, where it is working — `kolu-work`'s
 *  `WorkMemberSchema`) and the WATCH'S own memory of that terminal (what it
 *  is called, what the conversation was told, whether anything has been said
 *  to it). They are one row because they are one thing, and because a
 *  terminal with one row is a terminal in one work.
 *
 *  There is no `leftAt`: a member is in this map or it is not, and that it
 *  left is an event on the work's timeline. */
export const PersistedMemberSchema = memberSchemaWith(MemberWatchSchema);
export type PersistedMember = typeof PersistedMemberSchema.Type;

export const PersistedMembersSchema = Schema.Record(
  Schema.String,
  PersistedMemberSchema,
);
export type PersistedMembers = typeof PersistedMembersSchema.Type;

/** A state dir that has never had a piece of work, or a member. */
export const EMPTY_PERSISTED_WORKS: PersistedWorks = {};
export const EMPTY_PERSISTED_MEMBERS: PersistedMembers = {};

/** The re-validations, compiled once. `decodeUnknownResult` is a BRANCH rather
 *  than a throw, which is what lets each failure arm name the RECORD — the
 *  one thing the screen a person is looking at has to be able to act on. */
const decodePersisted = Schema.decodeUnknownResult(PersistedConductorSchema);
const decodeTranscript = Schema.decodeUnknownResult(PersistedTranscriptSchema);
const decodeWorks = Schema.decodeUnknownResult(PersistedWorksSchema);
const decodeMembers = Schema.decodeUnknownResult(PersistedMembersSchema);

/** EVERY REMEMBERED RECORD'S IDENTITY, IN ONE TABLE keyed by its store key:
 *  what it is CALLED in a sentence a person reads (not the JSON key — `works`
 *  is a key, and a person whose Conductor will not come up is owed a noun),
 *  the pronoun that follows it, whether the state-backup ring covers it at
 *  all, and the file its unreadable value is kept aside in.
 *
 *  One table rather than four facts spread across three packages: the screen
 *  offers "restore the newest backup" only where there IS one, and quotes the
 *  kept-aside path rather than describing it. */
export const RECORD_FACTS: Record<
  ConductorStoreKey,
  {
    readonly noun: string;
    readonly them: string;
    /** Whether the state-backup ring snapshots this record. The transcript is
     *  deliberately outside it (it is most of the conversation's bytes and
     *  moves on every keystroke), so there is no backup to offer for it. */
    readonly inBackups: boolean;
    /** The file `recoverStore { how: "empty" }` keeps the unreadable value
     *  in, under `<stateRoot>/conductor/`. Stable, so the confirm can quote
     *  the exact path before anything is written. */
    readonly keptFile: string;
  }
> = {
  conductor: {
    noun: "the Conductor's saved conversation",
    them: "it",
    inBackups: true,
    keptFile: "unreadable-conductor.json",
  },
  works: {
    noun: "the Conductor's saved works",
    them: "them",
    inBackups: true,
    keptFile: "unreadable-works.json",
  },
  members: {
    noun: "what the Conductor remembered about each work's terminals",
    them: "it",
    inBackups: true,
    keptFile: "unreadable-members.json",
  },
  transcript: {
    noun: "the Conductor's saved transcript",
    them: "it",
    inBackups: false,
    keptFile: "unreadable-transcript.json",
  },
};

/** WHERE A RECORD'S UNREADABLE VALUE WOULD BE KEPT — the one spelling, read
 *  by the refusal a person sees and by the recovery that writes it. */
export const keptAsidePath = (
  stateRoot: string,
  key: ConductorStoreKey,
): string => `${stateRoot}/conductor/${RECORD_FACTS[key].keptFile}`;

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
  /** Where `recoverStore { how: "empty" }` would keep the unreadable value —
   *  quoted verbatim in the confirm, so nobody has to guess. */
  readonly keepsAt: string;
  /** Whether there is a backup to offer at all ({@link RECORD_FACTS}). */
  readonly inBackups: boolean;
  readonly detail: string;
  constructor(args: {
    key: ConductorStoreKey;
    /** The file holding the unreadable value. */
    path: string;
    /** The state root, for the kept-aside path. */
    stateRoot: string;
    /** Why it could not be read, as a clause — "the saved value is in a shape
     *  this build does not understand", "the file is not valid JSON". */
    why: string;
    detail: string;
  }) {
    const facts = RECORD_FACTS[args.key];
    super(
      `kolu could not read ${facts.noun} — ${args.why}. Nothing has been changed: ${args.path} still holds ${facts.them}.`,
    );
    this.name = "UnreadablePersisted";
    this.key = args.key;
    this.path = args.path;
    this.keepsAt = keptAsidePath(args.stateRoot, args.key);
    this.inBackups = facts.inBackups;
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
  stateRoot: string,
): PersistedConductor {
  const result = decodePersisted(store.get());
  if (Result.isFailure(result)) {
    throw new UnreadablePersisted({
      key: "conductor",
      path,
      stateRoot,
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
  stateRoot: string,
): PersistedTranscript {
  const result = decodeTranscript(store.get());
  if (Result.isFailure(result)) {
    throw new UnreadablePersisted({
      key: "transcript",
      path,
      stateRoot,
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
  stateRoot: string,
): PersistedWorks {
  const result = decodeWorks(store.get());
  if (Result.isFailure(result)) {
    throw new UnreadablePersisted({
      key: "works",
      path,
      stateRoot,
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
  stateRoot: string,
): PersistedMembers {
  const result = decodeMembers(store.get());
  if (Result.isFailure(result)) {
    throw new UnreadablePersisted({
      key: "members",
      path,
      stateRoot,
      why: WRONG_SHAPE,
      detail: String(result.failure),
    });
  }
  return result.success;
}

/** THE TWO RECORDS, READ TOGETHER AND PARSED AS ONE — the decoder going
 *  through `kolu-work`'s one smart constructor.
 *
 *  Neither record means anything without the other: a member names a work,
 *  and a work's being open is what makes that membership legal. So the rules
 *  JSON cannot state (the key is the work's own identity, every member's work
 *  exists and is open, one planner and one implementor) are checked HERE, at
 *  the only place a store arrives from disk — and a store that breaks one is
 *  refused by name, with the sentence that says which, exactly as a shape
 *  this build cannot read is. The recovery screen offers the same two ways
 *  back. */
export function parsePersistedStore(
  works: PersistedWorks,
  members: PersistedMembers,
  path: string,
  stateRoot: string,
): {
  readonly works: ReadonlyMap<WorkId, Work>;
  readonly members: PersistedMembers;
} {
  try {
    const parsed = parseStore(works, members);
    return { works: parsed.works, members };
  } catch (err) {
    if (!(err instanceof InvalidWorkStore)) throw err;
    throw new UnreadablePersisted({
      key: "works",
      path,
      stateRoot,
      why: `the saved works and their terminals break a rule the model holds (${err.why})`,
      detail: err.why,
    });
  }
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
