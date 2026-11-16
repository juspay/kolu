/**
 * `fleetSurface` — the CONTRACT the fleet MCP face stands on: padi's members,
 * lifted over kolu-server's host map.
 *
 * It is a real `defineSurface` spec and not a hand-written tool list for the
 * reason the adapter is a projection at all: `@kolu/surface-mcp` can only serve
 * what a SPEC declares — a resource is a primitive of the served surface, its
 * JSON Schema is the member's own, and the expose map is checked against the
 * spec at boot. A fleet face assembled out of bespoke tools alone could not
 * carry `terminals`/`urgency`/`hosts`/`works` as subscribable resources at
 * all.
 *
 * **Every value schema is padi's, imported.** `PadiTerminalSchema`,
 * `GitStatusOutputSchema`, `PadiScreenHistoryOutputSchema` and the declared
 * error unions arrive whole from the packages that own them, so a record an
 * agent reads over this face is byte-identical to the one it reads over the
 * stdio face. The ONE thing this surface changes is the IDENTITY TYPE: where
 * padi says `TerminalIdSchema`, the fleet says {@link FleetTerminalRefSchema},
 * and where a repo-scoped verb was implicitly "this host", the fleet makes the
 * host an explicit field. That is the whole of the lift, and it is spelled by
 * SPREADING padi's own struct and overriding exactly the id-bearing key — so a
 * field added to `git.getStatus` upstream arrives here with no edit, and a field
 * RENAMED there stops this file compiling.
 *
 * **Why `hosts` instead of `identity`/`status`/`daemonStatus`.** Those three are
 * per-host health facts. Fleet-wide there is no single answer to "what commit is
 * padi?" — there are N answers, one per host — so they are COLUMNS of the one
 * `hosts` resource rather than three resources that would each have to invent a
 * fleet-wide reading of a per-host thing. A host that is not connected still has
 * a row (with null columns), because "which hosts exist and which are reachable"
 * is exactly what an agent needs before it can be told its call was refused.
 */

import {
  FsGitReadErrorSchema,
  PadiActiveTerminalSchema,
  PadiParkedTerminalSchema,
  PadiScreenHistoryInputSchema,
  PadiScreenHistoryOutputSchema,
  PadiSleepingTerminalSchema,
  type PadiUrgencySchema,
  PtyHostIdentitySchema,
  TerminalGateErrorSchema,
  TerminalInfoSchema,
  TerminalNotFound,
} from "@kolu/padi-client/surface";
import { defineSurface } from "@kolu/surface/define";
import {
  FsFileInputSchema,
  FsReadFileTextOutputSchema,
} from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
} from "kolu-git/schemas";
import {
  OnGreenSchema,
  WorkKeySchema,
  WorkModeSchema,
  OutcomeSchema,
  WorkRoleSchema,
} from "kolu-work";
import { FleetHostKeySchema, FleetTerminalRefSchema } from "./refSchema.ts";
import { FLEET_WATCH_JOINS } from "./watchJoin.ts";

/** An id list at fleet refs — the one re-typing this surface performs, named so
 *  the four urgency lists below are visibly the SAME change four times. */
const FleetRefs = Schema.Array(FleetTerminalRefSchema);

/** padi's urgency, with every id list host-qualified.
 *
 *  The `satisfies` is the drift gate: it demands this struct's key set be
 *  EXACTLY `PadiUrgencySchema`'s, so a fifth attention list added to padi fails
 *  the build here rather than silently never reaching the fleet — which would
 *  read, on an agent's side, as a fleet where nobody is ever asking. */
export const FleetUrgencySchema = Schema.Struct({
  awaitingIds: FleetRefs,
  finishedIds: FleetRefs,
  workingIds: FleetRefs,
  lingerIds: FleetRefs,
} satisfies Record<keyof typeof PadiUrgencySchema.fields, typeof FleetRefs>);
export type FleetUrgency = typeof FleetUrgencySchema.Type;

/** Nobody is asking, on any host. The cell's default and the empty fold's
 *  answer — one value, so "no hosts yet" and "no host needs attention" cannot
 *  be two different shapes. */
export const EMPTY_FLEET_URGENCY: FleetUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
};

/** How reachable one host is, in kolu-server's own three words. `warming` is a
 *  host whose padi is being brought up — the state a remote spends its first
 *  seconds in, and the reason a fleet roster must be able to say "not yet"
 *  instead of omitting the row. */
export const FleetHostStateSchema = Schema.Literals([
  "warming",
  "connected",
  "failed",
]);
export type FleetHostState = typeof FleetHostStateSchema.Type;

/** One row of the live roster: who the host is, whether it is answering, and —
 *  when it is — the per-host health facts the stdio face serves as `identity`
 *  and `status`.
 *
 *  The three build facts are NULLABLE rather than absent-when-unknown: a row is
 *  the same shape whatever state the host is in, so an agent reads
 *  `state === "connected"` to decide and never has to tell "this host has no
 *  commit" from "this key is missing". `expectedKaval` keeps padi's own
 *  optionality — it is optional ON a connected host too (a padi built without
 *  the kaval identity has none), which is a different fact from "not connected
 *  yet" and is kept distinguishable from it. */
export const FleetHostSchema = Schema.Struct({
  /** The encoded host key — the same string that keys this collection, carried
   *  IN the row so a reader holding one record alone still knows whose it is. */
  host: FleetHostKeySchema,
  /** What a person calls this host (kolu-server's label for it). */
  display: Schema.String,
  state: FleetHostStateSchema,
  /** That padi's build commit, or null while it is not answering. */
  commit: Schema.NullOr(Schema.String),
  /** The padi surface contract version it reports, or null. */
  surfaceVersion: Schema.NullOr(Schema.String),
  /** ms epoch of that padi's boot, or null — the generation an agent compares
   *  to see "the daemon restarted under me". */
  startedAt: Schema.NullOr(Schema.Number),
  /** The kaval that padi would spawn, when it declares one. */
  expectedKaval: Schema.optionalKey(PtyHostIdentitySchema),
});
export type FleetHost = typeof FleetHostSchema.Type;

/** One padi terminal record, at fleet identity. The ONE place this surface
 *  re-types a record rather than a reference, and it does it per ARM so the
 *  `active | sleeping | parked` discriminant padi publishes survives the lift.
 *
 *  Three fields, each for a failure:
 *
 *  - `id` — padi's record carries none at all (the collection KEY is the id,
 *    and on one host that is identity enough). A fleet row that inherited that
 *    silence would be a record an agent has to remember the key of; it reads
 *    the row, hands `record.id` to a tool, and is told `undefined` is not a
 *    fleet terminal reference.
 *  - `parentId` — padi's own, which is BARE. Passed to `lifecycle_create`'s
 *    `child-of` placement it is refused by the grammar; worse, a reader that
 *    matched it against the `id` of a row from another host would read two
 *    machines' hierarchies as one.
 *  - `host` — padi declares the axis (`PadiHostAxisSchema`) and leaves it unset
 *    precisely so this projection can fill it. Required here: on a fleet face
 *    "which machine is this terminal on" has an answer for every row, and an
 *    optional one would invite a reader to treat `undefined` as `local`. */
const FLEET_IDENTITY_FIELDS = {
  id: FleetTerminalRefSchema,
  parentId: Schema.optionalKey(FleetTerminalRefSchema),
  host: FleetHostKeySchema,
};

export const FleetTerminalSchema = Schema.Union([
  Schema.Struct({
    ...PadiActiveTerminalSchema.fields,
    ...FLEET_IDENTITY_FIELDS,
  }),
  Schema.Struct({
    ...PadiSleepingTerminalSchema.fields,
    ...FLEET_IDENTITY_FIELDS,
  }),
  Schema.Struct({
    ...PadiParkedTerminalSchema.fields,
    ...FLEET_IDENTITY_FIELDS,
  }),
]);
export type FleetTerminal = typeof FleetTerminalSchema.Type;

/** HOW a terminal came to be watched, as a wire value — built from the one
 *  tuple the word is spelled in ({@link FLEET_WATCH_JOINS}, a zero-import
 *  leaf), which is also what `kolu-conductor`'s rules and its persisted
 *  record build from. A second spelling is how a join the resource can show
 *  stops being a join a tool can record — or worse, one a tool writes and the
 *  next boot refuses. */
export const FleetWatchJoinSchema = Schema.Literals([...FLEET_WATCH_JOINS]);

/** ONE MEMBER TERMINAL of a piece of work, as the `works` resource carries
 *  it.
 *
 *  `name` and `agent` are the LAST THING KOLU SAW, not a live read: the member
 *  keeps them so a terminal can still be described after the host it was on
 *  stopped answering. `null` means nothing has been read yet — never "it has
 *  no name" — which is why they are nullable rather than empty strings.
 *
 *  `hostName` / `hostState` are this fleet's reading of the ref's own host
 *  RIGHT NOW, and both are `null` for a host that is no longer a member of the
 *  fleet — precisely the "can I still reach this?" question a restart leaves
 *  open. A member whose host is missing is kept, not dropped: it is part of the
 *  work, and `work_leave` is the only thing left to do with it.
 *
 *  `driver` is WHOSE KEYBOARD IT IS: `conductor` for one this conversation
 *  drives, `you` for one the person has TAKEN OVER (do not type into it until
 *  it is handed back — a wake will say when), `nobody` for a member nothing
 *  drives (a `watch`-mode work is the person's own terminal). An arm of
 *  `kolu-work`'s own reading, which has no "no driver" hole to fill. */
export const FleetWorkMemberSchema = Schema.Struct({
  ref: Schema.String.annotate({
    description:
      "The terminal, as <host>/<id> — the reference every tool on this face takes.",
  }),
  role: WorkRoleSchema,
  name: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.String),
  joined: FleetWatchJoinSchema,
  hostName: Schema.NullOr(Schema.String),
  hostState: Schema.NullOr(FleetHostStateSchema),
  driver: Schema.Literals(["conductor", "you", "nobody"]).annotate({
    description:
      "Who is typing into it: `conductor` (yours to drive), `you` (the person took it over — do not send it input until it is handed back), or `nobody` (a watch is the person's own terminal, and a work with no mode decided runs nothing).",
  }),
});
export type FleetWorkMember = typeof FleetWorkMemberSchema.Type;

/** WHERE A WORK STANDS, in one line: who it is waiting on, what for, and
 *  since when — `kolu-work`'s own fold over the timeline, not a second
 *  reading of it. */
export const FleetWorkStandingSchema = Schema.Struct({
  who: Schema.Literals(["agent", "you", "ci", "done"]),
  what: Schema.String,
  since: Schema.String,
});

/** ONE SETUP ANSWER on the wire — the value, or the fact that its question
 *  has none yet. Two arms rather than a nullable value: "nobody has answered
 *  the mode" is a state of the question, and an agent handed `null` cannot
 *  tell it from a mode called nothing. Parameterised by the vocabulary the
 *  answer is in, so `mode` and `onGreen` are each typed as their own words. */
const FleetSetupAnswerSchema = <S extends Schema.Top>(value: S) =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("unanswered") }),
    Schema.Struct({ kind: Schema.Literal("answered"), value }),
  ]);

/** ONE PIECE OF WORK IN PROGRESS, as the Conductor reads its own work back.
 *
 *  Every field here is a READING of the stored record: `host`, `mode` and
 *  `onGreen` come off the human's decisions, `standing` off the timeline. That
 *  is what makes `onGreen` THE one place "merge it or hand it over" is
 *  written — the card shows the same decision, and nothing keeps a second
 *  copy to disagree with it.
 *
 *  `openQuestions` is what the human has been asked and has not answered, in
 *  the words they were asked in: an agent reading its own work must see what
 *  it is waiting on without guessing at an ask id. */
export const FleetWorkSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** WHAT THE WORK IS — a branch on a machine, or the terminal being
   *  watched. The key itself rather than a repo and a branch flattened out of
   *  it: a watch has neither, and two empty strings standing in for them is
   *  the hole this round removes. */
  key: WorkKeySchema,
  host: Schema.String,
  mode: FleetSetupAnswerSchema(WorkModeSchema),
  onGreen: FleetSetupAnswerSchema(OnGreenSchema),
  standing: FleetWorkStandingSchema,
  members: Schema.Array(FleetWorkMemberSchema),
  openQuestions: Schema.Array(Schema.String),
});
export type FleetWork = typeof FleetWorkSchema.Type;

/** A FINISHED work, as the resource still names it: what it was, how it
 *  ended and when. Enough to say "that one is done" and no more — the whole
 *  of a finished work is on its card. */
export const FleetFinishedWorkSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  outcome: OutcomeSchema,
  endedAt: Schema.String,
});

/** WHAT THIS CONVERSATION IS RUNNING — every piece of work in progress, and
 *  the last few that finished. */
export const FleetWorksSchema = Schema.Struct({
  works: Schema.Array(FleetWorkSchema),
  finished: Schema.Array(FleetFinishedWorkSchema),
});
export type FleetWorksView = typeof FleetWorksSchema.Type;

/** Nothing open and nothing finished — the cell's default, which no reader
 *  ever sees: this surface is served by a client FACE that answers `get` off
 *  the live record. */
export const EMPTY_FLEET_WORKS: FleetWorksView = { works: [], finished: [] };

/** `screen.history` over the fleet: padi's own input, addressed by reference. */
export const FleetScreenHistoryInputSchema = Schema.Struct({
  ...PadiScreenHistoryInputSchema.fields,
  id: FleetTerminalRefSchema,
});

/** `lifecycle.kill` over the fleet: padi's own `{id}` in, padi's own
 *  `TerminalInfo` out — with the answered id re-qualified, so the id a caller
 *  reads back is one it can call again. */
export const FleetTerminalIdInputSchema = Schema.Struct({
  id: FleetTerminalRefSchema,
});
export const FleetTerminalInfoSchema = Schema.Struct({
  ...TerminalInfoSchema.fields,
  id: FleetTerminalRefSchema,
});

/** A repo-scoped read, on a named host. These four verbs address a REPOSITORY,
 *  not a terminal, so there is no reference to carry the host for them — the
 *  host is its own required field, and a missing one is refused by the decoder
 *  rather than defaulting to `local`, which would read a stranger's tree and
 *  answer confidently. */
const onHost = <F extends Schema.Struct.Fields>(
  fields: F,
): Schema.Struct<F & { host: typeof FleetHostKeySchema }> =>
  Schema.Struct({ ...fields, host: FleetHostKeySchema });

export const fleetSurface = defineSurface({
  cells: {
    /** Who needs someone, across every host. */
    urgency: {
      schema: FleetUrgencySchema,
      default: EMPTY_FLEET_URGENCY,
      verbs: ["get"],
    },
    /** THE LIVE ROSTER, AS ROWS — every host and everything known about it in
     *  ONE read, and it CHANGES under a reader: hosts arrive and leave while a
     *  conversation is open, which is the whole reason the fleet face exists
     *  rather than one MCP server per host.
     *
     *  A CELL, not a collection, and that is the whole fix. A collection's
     *  resource IS its key set (`@kolu/surface-mcp` reads it through
     *  `.keys(undefined)`), so an agent that read `hosts` got five strings and
     *  had to issue a second read per host — through a `{id}` TEMPLATE, which
     *  a host does not list and a model therefore has to guess the shape of.
     *  The observed result is an agent that can name the fleet and knows
     *  nothing about any member of it. "Which hosts can I use" is one question
     *  and it now takes one read.
     *
     *  The shape does NOT allow both: a cell `hosts` and a collection `hosts`
     *  would mint the same `surface/hosts/get` tag, which `defineSurface`
     *  refuses at build. Nothing is lost by choosing the rows — a reader
     *  holding the array holds every row, and each row still carries its own
     *  `host` key, so a row read here is usable without the position it
     *  arrived at.
     *
     *  The default is EMPTY, and no reader ever sees it: this surface is
     *  served by a client FACE (`fleetClientFace`), which answers `get` off
     *  the live pool. It is the value a hypothetical `implementSurface` would
     *  seed, and the empty fleet is the only honest seed for "nobody has asked
     *  the pool yet". */
    hosts: {
      schema: Schema.Array(FleetHostSchema),
      default: [],
      verbs: ["get"],
    },
    /** WHAT THIS CONVERSATION IS RUNNING — every piece of work in progress,
     *  its members by role, where it stands and what it is waiting on
     *  ({@link FleetWorksSchema}), plus the last few that finished.
     *
     *  A cell for the same reason `hosts` is: the question is "what am I
     *  running, and can I still reach it", and a key set would answer the
     *  first half of it. It is also the only member here whose value belongs
     *  to kolu's RECORD rather than to the fleet — the works kolu-server
     *  keeps, reached through the `FleetWorks` port like every other thing
     *  this package refuses to hold a copy of.
     *
     *  It CHANGES without the Conductor touching it: an agent stops, a member
     *  terminal goes away, CI turns red, a human answers a question. So it is
     *  subscribable, and a reader that holds the subscription hears all of
     *  that instead of discovering it by acting on a terminal that is not
     *  there. It is also what a conversation that has just STARTED reads: a
     *  work outlives the chat that opened it, so a new session picks up the
     *  work in flight rather than beginning again. */
    works: {
      schema: FleetWorksSchema,
      default: EMPTY_FLEET_WORKS,
      verbs: ["get"],
    },
  },
  collections: {
    /** Every terminal on every connected host, keyed by fleet reference — and
     *  each row says which host it is on and what its own reference is, so a
     *  record read here is callable without the key it arrived under. */
    terminals: {
      keySchema: FleetTerminalRefSchema,
      schema: FleetTerminalSchema,
      verbs: ["keys", "get"],
    },
  },
  procedures: {
    screen: {
      history: {
        input: FleetScreenHistoryInputSchema,
        output: PadiScreenHistoryOutputSchema,
        // The two answers padi's active-terminal gate gives, re-declared here
        // so a dormant terminal's refusal DECODES on this face instead of
        // arriving as an undeclared failure (the fleet surface re-serves the
        // per-host member, so it owes the same error channel).
        error: TerminalGateErrorSchema,
      },
    },
    lifecycle: {
      kill: {
        input: FleetTerminalIdInputSchema,
        output: FleetTerminalInfoSchema,
        error: TerminalNotFound,
      },
    },
    git: {
      getStatus: {
        input: onHost(GitStatusInputSchema.fields),
        output: GitStatusOutputSchema,
        error: FsGitReadErrorSchema,
      },
      getDiff: {
        input: onHost(GitDiffInputSchema.fields),
        output: GitDiffOutputSchema,
        error: FsGitReadErrorSchema,
      },
    },
    fs: {
      listAll: {
        input: onHost(FsListAllInputSchema.fields),
        output: FsListAllOutputSchema,
        error: FsGitReadErrorSchema,
      },
      readFile: {
        input: onHost(FsFileInputSchema.fields),
        output: FsReadFileTextOutputSchema,
        error: FsGitReadErrorSchema,
      },
    },
    // No `watch` namespace. A standing subscription is a call held open, and
    // the ONE conversation this surface serves — the conductor's — must never
    // be inside one: kolu-server WAKES it when a member terminal's agent
    // stops, asks or dies (`fleet/works.ts` is the record, the server owns
    // the watcher). The per-host face keeps `watch.open`/`close`/`drain`
    // unchanged for every other MCP client.
  },
});

export type FleetSurfaceSpec = (typeof fleetSurface)["spec"];
