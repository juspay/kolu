/**
 * A PIECE OF WORK, as kolu stores it — in a shape where the states kolu must
 * never be in cannot be written down.
 *
 * The record is three kinds of fact, each with one author:
 *
 *  - **what the work IS** — its {@link WorkKey}: the host, the repository and
 *    the branch it is on (or the terminal a person asked kolu to watch). A
 *    work is its branch. There is no minted id: the key IS the identity, and
 *    {@link workIdOf} is the one string encoding of it, so a second card for
 *    one branch cannot be created by any caller;
 *  - **what the human decided** — every question put to them about this work
 *    and its answer ({@link Decision}, a SUM: a question is `asked` or it is
 *    `answered`, never "answered with null"). The setup (mode, harness and
 *    model per role, what to do on green) is a set of decisions like any
 *    other, and `./readings.ts` reads it off them: there is no second copy.
 *    The host is NOT a setup decision any more — it is part of the key;
 *  - **what kolu observed** — the append-only timeline ({@link WorkEvent}),
 *    each kind with its own typed payload, and the work's {@link WorkState}:
 *    `open`, or `ended` with the one outcome and the files kept at that
 *    moment. A kept-file list on a work that has not ended has nowhere to go,
 *    and neither does an `endedAt` without an outcome.
 *
 * THERE IS NO `abandoned`. Nothing kolu merely fails to SEE ends a work: a
 * work ends when the forge says its PR merged or closed, or when somebody
 * stops it. Members are not part of the record at all — they live in one map
 * keyed by terminal (`./store.ts`), so a terminal is in at most one work by
 * construction and an ended work has no members by rule.
 *
 * Nothing here knows what a terminal, a conversation or a browser IS: a
 * terminal is a string (`host/id`), a question is its words and options. The
 * live state of anything (a terminal's screen, a PR's check counts, the files
 * in a worktree) is read where it lives and never copied in.
 */

import { Effect, Schema } from "effect";

/** What a member is there to do. `other` is a terminal the human asked the
 *  Conductor to keep an eye on without a part in a waterfall. */
export const WORK_ROLES = ["planner", "implementor", "other"] as const;
export const WorkRoleSchema = Schema.Literals(WORK_ROLES);
export type WorkRole = typeof WorkRoleSchema.Type;

/** The roles a work may hold only ONE of — the waterfall's parts. A second
 *  `planner` is two agents planning one branch, which is the shape of the
 *  defect this round removes; `other` is uncapped (a watch may hold several
 *  terminals nobody has a part for). Enforced in {@link parseStore}. */
export const UNIQUE_ROLES = ["planner", "implementor"] as const;
/** A waterfall's part — the roles a work holds one of, and the two whose
 *  agent kolu starts from the work's own setup. */
export type WaterfallRole = (typeof UNIQUE_ROLES)[number];
export const isWaterfallRole = (role: WorkRole): role is WaterfallRole =>
  (UNIQUE_ROLES as ReadonlyArray<string>).includes(role);

/** How the work is run: the whole waterfall, the one-implementor waterfall,
 *  or a plain watch the human asked for. */
export const WORK_MODES = ["full", "trivial", "watch"] as const;
export const WorkModeSchema = Schema.Literals(WORK_MODES);
export type WorkMode = typeof WorkModeSchema.Type;

/** What to do when CI is green. The ONE place this is written: kolu's
 *  standing reads it, the card shows it, and the Conductor reads it back. */
export const ON_GREEN = ["merge", "hand-over"] as const;
export const OnGreenSchema = Schema.Literals(ON_GREEN);
export type OnGreen = typeof OnGreenSchema.Type;

/** The setup questions, by key. A decision with one of these keys is a setup
 *  answer; a decision with `key: null` is any other question about the work
 *  (approving a plan, a tradeoff an agent stopped on).
 *
 *  `host` is NOT here: the machine a work runs on is part of its identity
 *  ({@link WorkKey}), stated by the caller that opens it, and a thing that
 *  identifies a work cannot also be a question that may go unanswered. */
export const SETUP_KEYS = [
  "mode",
  "planner.harness",
  "planner.model",
  "implementor.harness",
  "implementor.model",
  "on-green",
] as const;
export const SetupKeySchema = Schema.Literals(SETUP_KEYS);
export type SetupKey = typeof SetupKeySchema.Type;

/** THE SETUP QUESTIONS KOLU DRAWS THE OPTIONS FOR — a role's harness (the
 *  agent-distro harnesses this kolu carries) and its model (what that harness
 *  offers on the work's host, asked for when the form is drawn). Whoever opens
 *  a work NAMES these questions and passes what the request already said; it
 *  cannot offer options for them, and their decisions store none: a model list
 *  is a live fact about a host, and a copy in the record is a copy that goes
 *  stale the day the host's agents update. */
export const KOLU_CHOICE_KEYS = [
  "planner.harness",
  "planner.model",
  "implementor.harness",
  "implementor.model",
] as const satisfies ReadonlyArray<SetupKey>;
export const KoluChoiceKeySchema = Schema.Literals(KOLU_CHOICE_KEYS);
export type KoluChoiceKey = typeof KoluChoiceKeySchema.Type;

/** ... and the ones whose options the asker offers, in kolu's own words: the
 *  mode and what to do on green. With {@link KOLU_CHOICE_KEYS}, every setup
 *  key, each in exactly one of the two. */
export const OFFERED_SETUP_KEYS = [
  "mode",
  "on-green",
] as const satisfies ReadonlyArray<SetupKey>;
export const OfferedSetupKeySchema = Schema.Literals(OFFERED_SETUP_KEYS);
export type OfferedSetupKey = typeof OfferedSetupKeySchema.Type;

/** Whether kolu draws this setup question's options itself. */
export const isKoluChoiceKey = (key: SetupKey | null): key is KoluChoiceKey =>
  key !== null && (KOLU_CHOICE_KEYS as ReadonlyArray<string>).includes(key);

/** WHAT A PIECE OF WORK IS — a branch on a machine, or a terminal somebody
 *  asked kolu to keep an eye on.
 *
 *  A `Schema.Union` of two structs discriminated by `kind`, exactly as
 *  `HostKey` is: these bytes are persisted and the id derived from them is a
 *  wire map key. */
export const WorkKeySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("branch"),
    /** The fleet host ref the work runs on (`local`, `remote:<target>`). */
    host: Schema.String.check(Schema.isMinLength(1)),
    /** The repository's absolute path on that host. */
    repo: Schema.String.check(Schema.isMinLength(1)),
    branch: Schema.String.check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    kind: Schema.Literal("watch"),
    /** The fleet terminal ref (`<host>/<id>`) the watch is about. */
    terminal: Schema.String.check(Schema.isMinLength(1)),
  }),
]);
export type WorkKey = typeof WorkKeySchema.Type;

/** A work's identity as ONE string — the key of the `works` map, of the wire
 *  collection, and of a member's `work` field. Always {@link workIdOf} of a
 *  key; never minted, never random. */
export type WorkId = string;

/** Percent-encode everything that could be confused with the separators, so
 *  the encoding is injective: a repo path with a `/` in it (every repo path)
 *  cannot be read as the end of a field. */
const part = (text: string): string => encodeURIComponent(text);

/** THE ONE STRING ENCODING OF A KEY. Injective and decodable
 *  ({@link workKeyOf}): two different keys never produce one id, so "one work
 *  per branch" is a property of the map rather than a rule somebody enforces.
 */
export const workIdOf = (key: WorkKey): WorkId =>
  key.kind === "branch"
    ? `branch:${part(key.host)}/${part(key.repo)}/${part(key.branch)}`
    : `watch:${part(key.terminal)}`;

/** ... and back. `null` for a string that is no work id — which is what an
 *  agent naming a work kolu never opened hands in. */
export const workKeyOf = (id: WorkId): WorkKey | null => {
  const branch = /^branch:([^/]*)\/([^/]*)\/([^/]*)$/.exec(id);
  if (branch !== null) {
    const host = decodeURIComponent(branch[1] ?? "");
    const repo = decodeURIComponent(branch[2] ?? "");
    const name = decodeURIComponent(branch[3] ?? "");
    if (host === "" || repo === "" || name === "") return null;
    return { kind: "branch", host, repo, branch: name };
  }
  const watch = /^watch:(.*)$/.exec(id);
  if (watch === null) return null;
  const terminal = decodeURIComponent(watch[1] ?? "");
  return terminal === "" ? null : { kind: "watch", terminal };
};

/** Who an event is BY: the human, an agent (the Conductor or one of the
 *  agents it runs), CI, or kolu itself (membership, the end, files kept). */
export const EVENT_BY = ["you", "agent", "ci", "kolu"] as const;
export const EventBySchema = Schema.Literals(EVENT_BY);
export type EventBy = typeof EventBySchema.Type;

/** A file copied into kolu when the work ended, so it outlives the worktree.
 *  `path` is relative to the worktree, exactly as its `file` event said. */
export const KeptFileSchema = Schema.Struct({
  path: Schema.String,
  bytes: Schema.Int,
});
export type KeptFile = typeof KeptFileSchema.Type;

/** HOW A WORK ENDED — one sum, never a pair of nullable fields.
 *
 *  Three ways and no more: the forge says the PR merged, the forge says it
 *  was closed, or somebody STOPPED it (the person, from the card; or the
 *  Conductor, through `work_stop`). There is no `abandoned`: kolu failing to
 *  see a terminal is not an ending, and a work whose members have all gone is
 *  an open work with no terminals. */
export const OutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("merged"), pr: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal("closed"), pr: Schema.Int }),
  Schema.Struct({
    kind: Schema.Literal("stopped"),
    by: Schema.Literals(["you", "conductor"]),
  }),
]);
export type Outcome = typeof OutcomeSchema.Type;

/** WHERE A WORK STANDS — open, or ended at a moment with an outcome and the
 *  files kolu kept then.
 *
 *  The kept files live INSIDE the ended arm: a work in progress has nowhere
 *  to put them, so "kept files on a work that has not ended" is not a state
 *  anybody can write. */
export const WorkStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("open") }),
  Schema.Struct({
    kind: Schema.Literal("ended"),
    at: Schema.String,
    outcome: OutcomeSchema,
    kept: Schema.Array(KeptFileSchema),
  }),
]);
export type WorkState = typeof WorkStateSchema.Type;

/** THE EVENT VOCABULARY. Every one of these is something kolu OBSERVED —
 *  except `note`, the one line of text the Conductor may add, which nothing
 *  reads to decide anything.
 *
 *  Each kind carries its OWN payload rather than one `detail` string every
 *  reader re-parsed: a check event names the PR it is about (so a check event
 *  with no PR cannot be written), a `pr-opened` carries a number and not
 *  `"#181 …"`, a `joined` carries a {@link WorkRole} and not a word that
 *  happened to be spelled like one. */
export const EVENT_KINDS = [
  "requested",
  "carried-over",
  "joined",
  "left",
  "ready",
  "stopped",
  "asking",
  "exited",
  "asleep",
  "file",
  "question",
  "answered",
  "question-dropped",
  "pr-opened",
  "checks-running",
  "checks-passed",
  "checks-failed",
  "merged",
  "pr-closed",
  "note",
  "ended",
  "reopened",
  "kept",
  "keep-failed",
  "taken-over",
  "handed-back",
  "folded",
] as const;
export const EventKindSchema = Schema.Literals(EVENT_KINDS);
export type EventKind = typeof EventKindSchema.Type;

/** Every event's three common fields: when, by whom, and which member
 *  terminal it is about (`null` for one about the work itself). */
const eventOf = <K extends EventKind, F extends Schema.Struct.Fields>(
  kind: K,
  fields: F,
) =>
  Schema.Struct({
    at: Schema.String,
    by: EventBySchema,
    terminal: Schema.NullOr(Schema.String),
    kind: Schema.Literal(kind),
    ...fields,
  });

/** How a member stopped being one. */
export const LEFT_WHY = ["closed", "released", "gone"] as const;

/** The words an agent-state event may carry — a short reason, or `""`. */
const whyField = { why: Schema.String };

/** What a check event says: the PR it is about, the head commit it ran on
 *  (`null` from a host whose record reports none) and the gates that are red.
 *
 *  `pr` is REQUIRED, so a check event with no pull request is not a value. */
const checkFields = {
  pr: Schema.Int,
  head: Schema.NullOr(Schema.String),
  failing: Schema.Array(Schema.String),
};

export const WorkEventSchema = Schema.Union([
  eventOf("requested", { text: Schema.String }),
  eventOf("carried-over", {}),
  eventOf("joined", { role: WorkRoleSchema }),
  eventOf("left", { why: Schema.Literals(LEFT_WHY) }),
  eventOf("ready", whyField),
  eventOf("stopped", whyField),
  eventOf("asking", whyField),
  eventOf("exited", whyField),
  eventOf("asleep", whyField),
  eventOf("file", { path: Schema.String }),
  eventOf("question", { ask: Schema.String }),
  eventOf("answered", { ask: Schema.String }),
  eventOf("question-dropped", { ask: Schema.String }),
  eventOf("pr-opened", { pr: Schema.Int, title: Schema.String }),
  eventOf("checks-running", checkFields),
  eventOf("checks-passed", checkFields),
  eventOf("checks-failed", checkFields),
  eventOf("merged", { pr: Schema.Int }),
  eventOf("pr-closed", { pr: Schema.Int }),
  eventOf("note", { text: Schema.String }),
  eventOf("ended", { outcome: OutcomeSchema }),
  eventOf("reopened", {}),
  eventOf("kept", { count: Schema.Int }),
  eventOf("keep-failed", { why: Schema.String }),
  eventOf("taken-over", {}),
  eventOf("handed-back", {}),
  eventOf("folded", { count: Schema.Int }),
]);
export type WorkEvent = typeof WorkEventSchema.Type;

/** One event of a given kind, by name — what a reader narrows to. */
export type EventOf<K extends EventKind> = Extract<WorkEvent, { kind: K }>;

/** Where an answer came from: the work's card, the chat, the READER a file is
 *  read in (or that reader popped out into a window of its own), or the
 *  request itself (a setup answer the human's message already gave, recorded
 *  without asking). `null` for a question nobody answered (declined from
 *  nowhere, or dropped because the work ended under it).
 *
 *  The reader and the pop-out are two faces rather than one because they are
 *  two places a person can be: the question pinned above a plan inside kolu,
 *  and the same question on a second monitor. Which one they answered from is
 *  the only thing that tells them apart afterwards. */
export const ANSWERED_FROM_FACE = ["card", "chat", "reader", "popout"] as const;
export const AnsweredFromFaceSchema = Schema.Literals(ANSWERED_FROM_FACE);
/** A PLACE A PERSON CAN ANSWER FROM — the four faces, and nothing else. The
 *  wire takes this: `request` is kolu recording an answer the human's words
 *  already gave, which no face can claim to be. */
export type AnsweredFromFace = typeof AnsweredFromFaceSchema.Type;

export const ANSWER_FROM = [...ANSWERED_FROM_FACE, "request"] as const;
export const AnswerFromSchema = Schema.Literals(ANSWER_FROM);
export type AnswerFrom = typeof AnswerFromSchema.Type;

export const DecisionAnswerSchema = Schema.Struct({
  at: Schema.String,
  /** `answered` — picked and/or typed; `declined` — the human would not say;
   *  `dropped` — the question went away unanswered (the conversation that
   *  asked it ended, kolu restarted). */
  how: Schema.Literals(["answered", "declined", "dropped"]),
  /** The options picked, verbatim. */
  picked: Schema.Array(Schema.String),
  /** What the human typed instead of (or beside) an option, or `null`. */
  text: Schema.NullOr(Schema.String),
  from: Schema.NullOr(AnswerFromSchema),
});
export type DecisionAnswer = typeof DecisionAnswerSchema.Type;

/** What every decision carries, asked or answered. One ask (a form) can hold
 *  several questions — the setup is one form — so `ask` is the form's id and
 *  `id` is this question's own. */
const questionFields = {
  id: Schema.String,
  ask: Schema.String,
  /** When it was asked. */
  at: Schema.String,
};

/** ... and after the key, what every decision says about itself. */
const describedFields = {
  /** THE QUESTION'S SHORT HEADER — two or three words, which is the label a
   *  decision is DRAWN under on the card: the question's own words are behind
   *  a press. `""` for a setup question, whose label is its key's own name,
   *  and for a question whose asker gave none (then a few words of the
   *  question stand in). */
  header: Schema.String,
  question: Schema.String,
};

/** THE FILE THIS QUESTION IS ABOUT — worktree-relative, exactly as the work's
 *  own `file` events spell it (`.waterfall/plan.md`), or `""` for a question
 *  about no file. A plan approval carries the plan, so every face that draws
 *  the question can offer the one thing a person must read before answering
 *  it. */
const fileField = {
  file: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
};

/** A question whose OPTIONS ARE THE ASKER'S: any question about a work
 *  (`key: null`), and the two setup questions answered in kolu's own words. */
const offeredFields = {
  ...questionFields,
  /** The setup question this answers, or `null` for any other. */
  key: Schema.NullOr(OfferedSetupKeySchema),
  ...describedFields,
  options: Schema.Array(Schema.String),
  /** Whether more than one option may be picked. */
  multiple: Schema.Boolean,
  ...fileField,
};

/** A question whose options are KOLU'S ({@link KOLU_CHOICE_KEYS}): no options
 *  and no `multiple` — there is nowhere to write either, so a stored copy of
 *  a model list, or a role run on two harnesses, is not a value. */
const koluChoiceFields = {
  ...questionFields,
  key: KoluChoiceKeySchema,
  ...describedFields,
  ...fileField,
};

/** ONE QUESTION PUT TO THE HUMAN, and its answer — as a SUM.
 *
 *  `asked` is a question waiting on somebody; `answered` carries the answer,
 *  and carrying it is the only way to be that arm. The open asks a card draws
 *  are therefore DERIVED (`openAsks`): there is no second list that a restart
 *  could leave disagreeing with the decisions. Each arm is two shapes, by who
 *  draws the options: the asker ({@link offeredFields}) or kolu
 *  ({@link koluChoiceFields}). */
export const AskedSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("asked"), ...offeredFields }),
  Schema.Struct({ kind: Schema.Literal("asked"), ...koluChoiceFields }),
]);
export type Asked = typeof AskedSchema.Type;

export const AnsweredSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("answered"),
    ...offeredFields,
    answer: DecisionAnswerSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("answered"),
    ...koluChoiceFields,
    answer: DecisionAnswerSchema,
  }),
]);
export type Answered = typeof AnsweredSchema.Type;

export const DecisionSchema = Schema.Union([AskedSchema, AnsweredSchema]);
export type Decision = typeof DecisionSchema.Type;

/** A decision kolu draws the options for — a role's harness or model. */
export type KoluChoice = Extract<Decision, { readonly key: KoluChoiceKey }>;
/** ... and one whose options the asker gave. */
export type Offered = Exclude<Decision, KoluChoice>;

export const isKoluChoice = (decision: Decision): decision is KoluChoice =>
  isKoluChoiceKey(decision.key);

export const isAsked = (decision: Decision): decision is Asked =>
  decision.kind === "asked";
export const isAnswered = (decision: Decision): decision is Answered =>
  decision.kind === "answered";

export const WorkSchema = Schema.Struct({
  /** WHAT THIS WORK IS. The map it sits in is keyed by `workIdOf(key)`, and
   *  {@link parseStore} is what holds those two to each other. */
  key: WorkKeySchema,
  title: Schema.String,
  startedAt: Schema.String,
  decisions: Schema.Array(DecisionSchema),
  events: Schema.Array(WorkEventSchema),
  state: WorkStateSchema,
});
export type Work = typeof WorkSchema.Type;

/** Whether the work is still being done. */
export const isOpen = (work: Work): boolean => work.state.kind === "open";

/** When it ended, or `null` — the one reading every fold took off `endedAt`
 *  when that was a field of its own. */
export const endedAt = (work: Work): string | null =>
  work.state.kind === "ended" ? work.state.at : null;

/** How it ended, or `null` while it is open. */
export const outcomeOf = (work: Work): Outcome | null =>
  work.state.kind === "ended" ? work.state.outcome : null;

/** The files kolu kept when it ended — none while it is open, by type. */
export const keptOf = (work: Work): ReadonlyArray<KeptFile> =>
  work.state.kind === "ended" ? work.state.kept : [];

/** THE HOST a work runs on — read off its key, never off a decision. A watch
 *  takes its host from the terminal it watches (`<host>/<id>`). */
export const hostOf = (work: Work): string =>
  work.key.kind === "branch"
    ? work.key.host
    : (work.key.terminal.split("/")[0] ?? "");

/** The repository the work is in, or `""` for a watch. */
export const repoOf = (work: Work): string =>
  work.key.kind === "branch" ? work.key.repo : "";

/** The branch, or `""` for a watch. */
export const branchOf = (work: Work): string =>
  work.key.kind === "branch" ? work.key.branch : "";

/** ONE MEMBER TERMINAL — the whole of what kolu stores about a terminal's
 *  part in a work, in the ONE map keyed by terminal ref.
 *
 *  A terminal is in AT MOST ONE WORK by construction (one map, one key), and
 *  there is no bookkeeping without a member (the same row holds both). There
 *  is no `leftAt`: a member is in the map or it is not, and that it left is a
 *  `left` event on the work's timeline.
 *
 *  The host-side watch bookkeeping (what the terminal is called, what the
 *  conversation was told) rides in a `watch` field the HOST declares — see
 *  {@link memberSchemaWith} — because this package has no business knowing
 *  what a conversation is. */
export const WorkMemberSchema = Schema.Struct({
  /** The work it is a member of — always a key of the `works` map, always
   *  OPEN ({@link parseStore}). */
  work: Schema.String,
  role: WorkRoleSchema,
  joinedAt: Schema.String,
  /** WHERE IT IS WORKING, as kolu first read it off the terminal's record —
   *  the worktree a work's files are listed from and copied out of when it
   *  ends. `null` until a reading has said. */
  worktree: Schema.NullOr(Schema.String),
});
export type WorkMember = typeof WorkMemberSchema.Type;

/** The member schema a HOST persists: the model's own fields plus whatever
 *  that host remembers about the terminal. Parameterised rather than
 *  declared with a `watch: unknown`, so the host's own schema is the one that
 *  decodes it and this package still owns the four fields a member IS. */
export const memberSchemaWith = <S extends Schema.Top>(watch: S) =>
  Schema.Struct({ ...WorkMemberSchema.fields, watch });
