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
  type StoreFault,
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
  /** Whether the standing prompt has already gone out under a message of
   *  THIS conversation. */
  taught: Schema.Boolean,
});

export type PersistedConductor = typeof PersistedConductorSchema.Type;

/** An untouched state dir's record: no conversation, nothing to resume. */
export const EMPTY_PERSISTED_CONDUCTOR: PersistedConductor = {
  sessionId: null,
  cwd: "",
  model: null,
  fleet: [],
  taught: false,
};

/** THE TRANSCRIPT FILE'S BODY — the rows, and nothing else.
 *
 *  The file is part of kolu's ONE ladder — `kolu-server`'s `stateLadder.ts`
 *  stamps and rewrites it, and a version it does not recognise is refused by
 *  name — so a future change to the row shape is a rung there, never a second
 *  ladder here.
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
 *  to it).
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

const decodePersisted = Schema.decodeUnknownResult(PersistedConductorSchema);
const decodeTranscript = Schema.decodeUnknownResult(PersistedTranscriptSchema);
const decodeWorks = Schema.decodeUnknownResult(PersistedWorksSchema);
const decodeMembers = Schema.decodeUnknownResult(PersistedMembersSchema);

/** EVERY REMEMBERED RECORD'S IDENTITY, IN ONE TABLE keyed by its store key:
 *  what it is CALLED in a sentence a person reads (not the JSON key — `works`
 *  is a key, and a person whose Conductor will not come up is owed a noun),
 *  the pronoun that follows it, whether the state-backup ring covers it at
 *  all, and the file its unreadable value is kept aside in. */
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
 *  what happened and nothing else. What kolu can actually do is two procedure
 *  calls (`conductor.recoverStore`), and the panel draws them as two buttons
 *  off {@link UnreadablePersisted.key} — which is why this is a class carrying
 *  the key and the file rather than a thrown string.
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

const WRONG_SHAPE =
  "the saved value is in a shape this build does not understand";

/** Read one remembered record, or REFUSE naming it.
 *
 *  There is no silent repair on purpose: patching the offending value would
 *  hand a person a record with holes in it and no way to know, and emptying
 *  it behind their back would throw away a conversation that is still on
 *  disk. The two things that ARE offered — the newest backup that reads, or
 *  starting empty with the unreadable value kept aside in a file of its own —
 *  are the person's to choose, through `conductor.recoverStore`. */
const readRecord = <A>(
  key: ConductorStoreKey,
  decode: (value: unknown) => Result.Result<A, unknown>,
  store: CellStore<A>,
  path: string,
  stateRoot: string,
): A => {
  const result = decode(store.get());
  if (Result.isFailure(result)) {
    throw new UnreadablePersisted({
      key,
      path,
      stateRoot,
      why: WRONG_SHAPE,
      detail: String(result.failure),
    });
  }
  return result.success;
};

/** Read the remembered conversation out of kolu-server's state, or REFUSE
 *  naming the record. */
export function readPersistedConductor(
  store: CellStore<PersistedConductor>,
  path: string,
  stateRoot: string,
): PersistedConductor {
  return readRecord("conductor", decodePersisted, store, path, stateRoot);
}

/** Read the transcript file's body, or REFUSE naming it — with the dividers
 *  collapsed on the way out ({@link oneDividerPerReset}). */
export function readPersistedTranscript(
  store: CellStore<PersistedTranscript>,
  path: string,
  stateRoot: string,
): PersistedTranscript {
  const read = readRecord(
    "transcript",
    decodeTranscript,
    store,
    path,
    stateRoot,
  );
  return { rows: oneDividerPerReset(read.rows) };
}

/** Read the remembered works, or REFUSE naming the record. */
export function readPersistedWorks(
  store: CellStore<PersistedWorks>,
  path: string,
  stateRoot: string,
): PersistedWorks {
  return readRecord("works", decodeWorks, store, path, stateRoot);
}

/** Read what kolu remembered about each member terminal, or REFUSE naming the
 *  record. */
export function readPersistedMembers(
  store: CellStore<PersistedMembers>,
  path: string,
  stateRoot: string,
): PersistedMembers {
  return readRecord("members", decodeMembers, store, path, stateRoot);
}

const faultClause = (fault: StoreFault): string => {
  switch (fault.kind) {
    case "key-mismatch":
      return `a piece of work is stored under ${JSON.stringify(fault.filedAs)} but says it is ${JSON.stringify(fault.says)} — a work is identified by its branch, and the key it is filed under has to be that same identity`;
    case "no-such-work":
      return `the terminal ${JSON.stringify(fault.terminal)} is recorded as a member of ${JSON.stringify(fault.work)}, and there is no such piece of work — a member belongs to a work kolu holds`;
    case "work-ended":
      return `the terminal ${JSON.stringify(fault.terminal)} is recorded as a member of «${fault.title}», which has ended — a work that ends takes its members with it, so a finished work has no terminals`;
    case "role-taken":
      return `«${fault.title}» has two terminals in the ${fault.role} role (${JSON.stringify(fault.held)} and ${JSON.stringify(fault.second)}) — a piece of work has one planner and one implementor`;
  }
};

/** THE TWO RECORDS, READ TOGETHER AND PARSED AS ONE — the decoder going
 *  through `kolu-work`'s one smart constructor.
 *
 *  The rules JSON cannot state (the key is the work's own identity, every
 *  member's work exists and is open, one planner and one implementor) are
 *  checked HERE, at the only place a store arrives from disk — and a store
 *  that breaks one is refused by name, the model answering WHICH rule and
 *  which rows, with {@link faultClause} turning that into the sentence. */
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
      why: faultClause(err.fault),
      detail: JSON.stringify(err.fault),
    });
  }
}
/** Collapse every RUN of consecutive dividers to the first of them. The first
 *  is the one kept, because the reset happened at the first.
 *
 *  `rows` arrives in `seq` order ({@link transcriptFrom} writes the host's
 *  sorted array), so "consecutive" is a neighbour test and not a sort. */
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
 *  cannot disagree with what a reader is looking at — except `taught`, which a
 *  reader never sees: the conductor holds it and hands it in here. */
export function persistedFrom(
  state: ConductorState,
  taught: boolean,
): PersistedConductor {
  return {
    sessionId: state.sessionId,
    cwd: state.cwd,
    model: state.model?.id ?? null,
    fleet: state.fleet,
    taught,
  };
}

/** What the transcript FILE holds after the rows moved.
 *
 *  The row cap is a bound on the FILE, not on the panel: a conversation that
 *  has run for a week is still whole in memory, and what a restart brings back
 *  is its tail.
 *
 *  THE ROWS GO THROUGH UNTOUCHED, attachments included, because an attachment
 *  carries no bytes to strip: it is a name, a size and the path kolu-server
 *  wrote the file to. A row restored from here is therefore the same value it
 *  was when it was minted. The thumbnail is the only thing that does not
 *  survive. */
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
 *  transcript's worth of them is the directory moving underneath.
 *
 *  GENERIC over the record that holds the rows, because the rows have MOVED:
 *  the 1.45.0 rung is frozen history and runs against a `conductor` key that
 *  still held them, while a live repoint today is of the transcript file.
 *
 *  Pure, and a prefix swap rather than a re-join: a path that does NOT start
 *  at the old corner is left alone — rebuilding it would be inventing a
 *  location for somebody else's file. */
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

/** How many transcript rows the file keeps. */
export const ROW_CAP = 400;
