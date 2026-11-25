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
 *    and how it ended ({@link Decision}, a SUM: a question is `asked` or it
 *    is `settled` — answered WITH its value, declined, or dropped; there is
 *    no "answered with nothing"). The setup (mode, harness and model per
 *    role, what to do on green) is a set of decisions like any other, and
 *    `./waterfall.ts` reads it off them: there is no second copy.
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

import { Option, Schema } from "effect";

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
export const isWaterfallRole = (role: unknown): role is WaterfallRole =>
  (UNIQUE_ROLES as ReadonlyArray<unknown>).includes(role);

/** How the work is run: the whole waterfall, the one-implementor waterfall,
 *  or a plain watch the human asked for. */
export const WORK_MODES = ["full", "trivial", "watch"] as const;
export const WorkModeSchema = Schema.Literals(WORK_MODES);
export type WorkMode = typeof WorkModeSchema.Type;
export const isWorkMode = Schema.is(WorkModeSchema);

/** What to do when the PR is green. The ONE place this is written: kolu's
 *  standing reads it, the card shows it, and the Conductor reads it back. */
export const ON_GREEN = ["merge", "hand-over"] as const;
export const OnGreenSchema = Schema.Literals(ON_GREEN);
export type OnGreen = typeof OnGreenSchema.Type;
export const isOnGreen = Schema.is(OnGreenSchema);

/** The setup questions, by key. A decision about the setup carries one of
 *  these keys; any other question about the work (approving a plan, a
 *  tradeoff an agent stopped on) is the `work` arm, which has no key.
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
export const isKoluChoiceKey = (key: SetupKey): key is KoluChoiceKey =>
  (KOLU_CHOICE_KEYS as ReadonlyArray<string>).includes(key);

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
    /** The repository's root on that host — `repoBy` says who named it. */
    repo: Schema.String.check(Schema.isMinLength(1)),
    branch: Schema.String.check(Schema.isMinLength(1)),
    /** WHO SAID `repo` IS THE ROOT. `git`: it is git's own root for the
     *  repository on `host`, as that host answered it when the key was
     *  parsed or re-keyed — so two spellings of one repository are one key.
     *  `as-written`: a key stored before kolu asked git, whose `repo` is what
     *  a caller typed; nothing new produces one, and the host's first answer
     *  turns it into `git`. {@link workIdOf} does not read it. */
    repoBy: Schema.Literals(["git", "as-written"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("watch"),
    /** The fleet host ref the watched terminal is on. Its own field, so
     *  nothing ever splits a string to find it — a host key may hold a `/`. */
    host: Schema.String.check(Schema.isMinLength(1)),
    /** The terminal's id on that host. */
    id: Schema.String.check(Schema.isMinLength(1)),
  }),
]);
export type WorkKey = typeof WorkKeySchema.Type;

/** A KEY THAT HAS BEEN PARSED — a watch of a terminal the host holds, or a
 *  branch whose repository git named. What the store opens a work for: a
 *  key a caller typed, unparsed, cannot reach it. */
export type ParsedWorkKey =
  | Extract<WorkKey, { readonly kind: "watch" }>
  | (Extract<WorkKey, { readonly kind: "branch" }> & {
      readonly repoBy: "git";
    });

/** A work's identity as ONE string — the key of the `works` map, of the wire
 *  collection, and of a member's `work` field. Always {@link workIdOf} of a
 *  key; never minted, never random. */
export type WorkId = string;

/** Percent-encode everything that could be confused with the separators, so
 *  the encoding is injective: a repo path with a `/` in it (every repo path)
 *  cannot be read as the end of a field. */
const part = (text: string): string => encodeURIComponent(text);

/** THE ONE STRING ENCODING OF A KEY. Injective and decodable
 *  ({@link workIdParts}): two different keys never produce one id, so "one
 *  work per branch" is a property of the map rather than a rule somebody
 *  enforces. A watch's id is the terminal's fleet ref (`<host>/<id>`),
 *  encoded whole — the bytes every stored watch id already is. */
export const workIdOf = (key: WorkKey): WorkId =>
  key.kind === "branch"
    ? `branch:${part(key.host)}/${part(key.repo)}/${part(key.branch)}`
    : `watch:${part(`${key.host}/${key.id}`)}`;

/** WHAT A WORK ID SAYS — the key's parts it encodes. Not a key: an id cannot
 *  say who named a branch's repository (`repoBy`), so only the stored work
 *  carries that. */
export type WorkIdParts =
  | {
      readonly kind: "branch";
      readonly host: string;
      readonly repo: string;
      readonly branch: string;
    }
  | { readonly kind: "watch"; readonly host: string; readonly id: string };

/** ... and back. `none` for a string that is no work id — which is what an
 *  agent naming a work kolu never opened hands in, and what a pasted link
 *  with a broken `%`-escape is. Every part must be non-empty, the rule the
 *  key's own schema holds. A watch's ref is split at its LAST `/`: a host key
 *  may contain one, a terminal id never does. */
export const workIdParts = (id: WorkId): Option.Option<WorkIdParts> => {
  const branch = /^branch:([^/]*)\/([^/]*)\/([^/]*)$/.exec(id);
  const watch = /^watch:(.*)$/.exec(id);
  try {
    if (branch !== null) {
      const [host = "", repo = "", name = ""] = branch
        .slice(1)
        .map(decodeURIComponent);
      return host === "" || repo === "" || name === ""
        ? Option.none()
        : Option.some({ kind: "branch", host, repo, branch: name });
    }
    if (watch === null) return Option.none();
    const ref = decodeURIComponent(watch[1] ?? "");
    const cut = ref.lastIndexOf("/");
    return cut <= 0 || cut === ref.length - 1
      ? Option.none()
      : Option.some({
          kind: "watch",
          host: ref.slice(0, cut),
          id: ref.slice(cut + 1),
        });
  } catch (cause) {
    // `decodeURIComponent` throws `URIError` on a malformed escape: that is
    // a string no `workIdOf` produced, so it names no work. Anything else is
    // a defect and goes on up.
    if (cause instanceof URIError) return Option.none();
    throw cause;
  }
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
 *  happened to be spelled like one.
 *
 *  Two facts about a pull request are kept apart because they are two
 *  things the forge says: what the checks that have REPORTED say (the three
 *  check events) and whether the forge would let the PR merge
 *  (`merge-state`). A required check that has not started is in neither the
 *  rollup nor the checks' events; it is why a PR cannot merge. A third is
 *  whether the PR is a draft (`pr-opened`'s `draft`, then `draft-state`):
 *  GitHub's merge answer no longer says it, so it is its own event.
 *
 *  WHO HOLDS THE WORK is read off members joining, their agents stopping
 *  and `told` — the Conductor handing the work to a member — and a store
 *  saved before kolu kept hand-offs carries one `hand-offs-kept` from the
 *  upgrade that says so (`./folds.ts` files what it cannot know as
 *  `unrecorded`). */
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
  "answered-part",
  "question-dropped",
  "pr-opened",
  "checks-running",
  "checks-passed",
  "checks-failed",
  "merge-state",
  "draft-state",
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
  "told",
  "hand-offs-kept",
] as const;
export const EventKindSchema = Schema.Literals(EVENT_KINDS);
export type EventKind = typeof EventKindSchema.Type;

/** WHAT AN EVENT IS ABOUT — the work itself, or one member terminal of it.
 *  Two arms rather than a nullable terminal: "about no terminal" is a thing
 *  an event says, not a hole in it. */
export const EventAboutSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("work") }),
  Schema.Struct({
    kind: Schema.Literal("member"),
    terminal: Schema.NonEmptyString,
  }),
]);
export type EventAbout = typeof EventAboutSchema.Type;

/** About the work itself — the one value of that arm. */
export const ABOUT_WORK: EventAbout = { kind: "work" };
/** About one member terminal. */
export const aboutMember = (terminal: string): EventAbout => ({
  kind: "member",
  terminal,
});
/** Whether an event is about this member terminal. */
export const isAbout = (
  event: { readonly about: EventAbout },
  terminal: string,
): boolean =>
  event.about.kind === "member" && event.about.terminal === terminal;

/** Every event's three common fields: when, by whom, and what it is about. */
const eventOf = <K extends EventKind, F extends Schema.Struct.Fields>(
  kind: K,
  fields: F,
) =>
  Schema.Struct({
    at: Schema.String,
    by: EventBySchema,
    about: EventAboutSchema,
    kind: Schema.Literal(kind),
    ...fields,
  });

/** How a member stopped being one. */
export const LEFT_WHY = ["closed", "released", "gone"] as const;

/** WHY AN AGENT STANDS WHERE IT DOES — the short reason its terminal gave,
 *  or none given. */
export const AgentWhySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("reason"),
    text: Schema.NonEmptyString,
  }),
]);
export type AgentWhy = typeof AgentWhySchema.Type;

/** The reason an agent-state event carries. */
const whyField = { why: AgentWhySchema };

/** THE COMMIT A CHECK RAN ON — known, or a host whose record reports none. */
export const CheckHeadSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unreported") }),
  Schema.Struct({
    kind: Schema.Literal("commit"),
    sha: Schema.NonEmptyString,
  }),
]);
export type CheckHead = typeof CheckHeadSchema.Type;

/** What a check event says: the PR it is about, the head commit it ran on
 *  and the gates that are red.
 *
 *  `pr` is REQUIRED, so a check event with no pull request is not a value. */
const checkFields = {
  pr: Schema.Int,
  head: CheckHeadSchema,
  failing: Schema.Array(Schema.String),
};

/** WHERE A PULL REQUEST LIVES — its address as the forge gave it, or a PR
 *  recorded before kolu kept the address (the 1.57.0 rung's word for those).
 *  Never a guessed URL. */
export const PrLinkSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unrecorded") }),
  Schema.Struct({
    kind: Schema.Literal("link"),
    href: Schema.NonEmptyString,
  }),
]);
export type PrLink = typeof PrLinkSchema.Type;

/** WHETHER A PULL REQUEST IS A DRAFT, as the forge said it: still being built
 *  (`draft`) or ready for review (`ready`). One word, written by the observer
 *  and read by `prStep`. */
export const PR_DRAFT = ["draft", "ready"] as const;
export const PrDraftSchema = Schema.Literals(PR_DRAFT);
export type PrDraft = typeof PrDraftSchema.Type;

/** What a `pr-opened` says about the draft: the forge's word, or a PR
 *  recorded before kolu kept one (`unrecorded`, the 1.61.0 rung's word for
 *  those — the same sense {@link PrLinkSchema}'s has). Never a guess. */
export const PrOpenedDraftSchema = Schema.Literals([...PR_DRAFT, "unrecorded"]);
export type PrOpenedDraft = typeof PrOpenedDraftSchema.Type;

/** WHY THE FORGE WILL NOT MERGE A PULL REQUEST — GitHub's own reasons, in
 *  kolu's words: something the branch's protection still wants (`blocked`:
 *  a required check that has not passed, an unresolved conversation), a
 *  review it requires (`review`), a base that has moved on (`behind`), a
 *  conflict (`conflicts`), or a draft (`draft`). kolu reads `draft` off the
 *  PR's own draft word — `prStep` answers it for every open draft — because
 *  GitHub retired `DRAFT` from its merge state in 2021 and works a draft's
 *  merge state out as if it were ready. */
export const MERGE_BLOCKS = [
  "blocked",
  "review",
  "behind",
  "conflicts",
  "draft",
] as const;
export type MergeBlock = (typeof MERGE_BLOCKS)[number];

/** WHETHER THE FORGE WOULD LET THE PULL REQUEST MERGE, as one recorded
 *  answer: it can; it cannot, and why; or it has not worked that out yet for
 *  a commit it has not answered about before (`unsettled`, recorded once per
 *  new head so the last commit's answer does not stand for a push). */
export const MergeStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("can") }),
  Schema.Struct({
    kind: Schema.Literal("cannot"),
    why: Schema.Literals(MERGE_BLOCKS),
  }),
  Schema.Struct({ kind: Schema.Literal("unsettled") }),
]);
export type MergeState = typeof MergeStateSchema.Type;

/** WHAT THE HUMAN ASKED FOR, as kolu saw them say it — their words, or a work
 *  opened off something else, where there were none. */
export const RequestWordsSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("said"),
    text: Schema.NonEmptyString,
  }),
]);
export type RequestWords = typeof RequestWordsSchema.Type;

export const WorkEventSchema = Schema.Union([
  eventOf("requested", { request: RequestWordsSchema }),
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
  /** Part of an ask answered: the questions left blank are still asked. */
  eventOf("answered-part", { ask: Schema.String }),
  eventOf("question-dropped", { ask: Schema.String }),
  eventOf("pr-opened", {
    pr: Schema.Int,
    title: Schema.String,
    url: PrLinkSchema,
    /** Whether it opened as a draft. */
    draft: PrOpenedDraftSchema,
  }),
  eventOf("checks-running", checkFields),
  eventOf("checks-passed", checkFields),
  eventOf("checks-failed", checkFields),
  /** The forge's answer to "can this PR merge", recorded when it changes. */
  eventOf("merge-state", {
    pr: Schema.Int,
    head: CheckHeadSchema,
    merge: MergeStateSchema,
  }),
  /** The PR was marked ready for review, or turned back into a draft —
   *  recorded when the forge's word changes for an open PR. */
  eventOf("draft-state", { pr: Schema.Int, draft: PrDraftSchema }),
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
  /** The Conductor spoke to this member, handing it the work — recorded
   *  only when the word hands it over: to a planner or an implementor not
   *  holding it (`./readings.ts`'s `handsOver`). The role is on the
   *  terminal's `joined`. */
  eventOf("told", {}),
  /** Written once, by the upgrade, on every work saved before kolu kept
   *  hand-offs: who held the work before it was not recorded. */
  eventOf("hand-offs-kept", {}),
]);
export type WorkEvent = typeof WorkEventSchema.Type;

/** One event of a given kind, by name — what a reader narrows to. */
export type EventOf<K extends EventKind> = Extract<WorkEvent, { kind: K }>;

/** Where an answer came from: the work's card, the chat, the READER a file is
 *  read in (or that reader popped out into a window of its own), the request
 *  itself (a setup answer the human's message already gave, recorded without
 *  asking), or carried over from the file kolu kept before it stored work.
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

export const ANSWER_FROM = [
  ...ANSWERED_FROM_FACE,
  "request",
  "carried-over",
] as const;
export const AnswerFromSchema = Schema.Literals(ANSWER_FROM);
export type AnswerFrom = typeof AnswerFromSchema.Type;

/** Words a person typed, as the record keeps them: trimmed, and never none —
 *  a box left empty is not an answer. */
export const TypedSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
);

/** WHAT A PERSON SAID to a question about the work: options they picked,
 *  words they typed, or both — and never neither, because "answered with
 *  nothing" is not an answer. A question left blank stays asked. */
export const SaidSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("picked"),
    picked: Schema.NonEmptyArray(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("typed"), text: TypedSchema }),
  Schema.Struct({
    kind: Schema.Literal("picked-and-typed"),
    picked: Schema.NonEmptyArray(Schema.String),
    text: TypedSchema,
  }),
]);
export type Said = typeof SaidSchema.Type;

/** A question the human would not answer — from the face they said so on. */
const DeclinedSchema = Schema.Struct({
  how: Schema.Literal("declined"),
  at: Schema.String,
  from: AnsweredFromFaceSchema,
});

/** A question that went away unanswered: the work ended under it, or the
 *  conversation that asked it is gone. Nobody answered, so it has no face. */
const DroppedSchema = Schema.Struct({
  how: Schema.Literal("dropped"),
  at: Schema.String,
});

/** HOW A QUESTION WAS SETTLED, as a SUM: answered WITH its value, declined,
 *  or dropped. Each arm carries only its own fields, so an answer with no
 *  value cannot be written down. */
const answerOf = <V extends Schema.Struct.Fields>(value: V) =>
  Schema.Union([
    Schema.Struct({
      how: Schema.Literal("answered"),
      at: Schema.String,
      from: AnswerFromSchema,
      ...value,
    }),
    DeclinedSchema,
    DroppedSchema,
  ]);

/** The answer to a question about the work: what was said. */
export const WorkAnswerSchema = answerOf({ said: SaidSchema });
/** The answer to `mode`: one mode, in kolu's own word for it. */
export const ModeAnswerSchema = answerOf({ value: WorkModeSchema });
/** The answer to `on-green`: one of kolu's words for it. */
export const OnGreenAnswerSchema = answerOf({ value: OnGreenSchema });
/** HOW AN ANSWER TO ONE OF KOLU'S OWN QUESTIONS WAS CHOSEN — picked from what
 *  kolu drew (the harnesses it carries, the models the host listed, a model
 *  this person picked before), or TYPED by the person. It decides how the
 *  answer is judged, when it is recorded and again when its role starts: a
 *  picked model must be one the host lists, whenever the host can list; a
 *  typed one goes to the harness as typed (omp matches a short name like
 *  `opus` itself), and only upstream's one-word rule applies to it. */
export const CHOSEN = ["picked", "typed"] as const;
export const ChosenSchema = Schema.Literals(CHOSEN);
export type Chosen = typeof ChosenSchema.Type;

/** AN ANSWER TO ONE OF KOLU'S OWN QUESTIONS — one value, never words beside
 *  it: a harness kolu carries, or a model — and how it was chosen. */
export const KoluChoiceAnswerSchema = answerOf({
  value: Schema.NonEmptyString,
  chosen: ChosenSchema,
});

/** What a face sends for one question: the values it judged by the
 *  question's options (a value among them is a pick), or — for one of kolu's
 *  own questions — the one answer the person TYPED, which is never a pick
 *  whatever it happens to match. */
export const TypedAnswerSchema = Schema.Struct({ typed: TypedSchema });
export type TypedAnswer = typeof TypedAnswerSchema.Type;

/** THE SHORT HEADER a question about the work is drawn under — the asker's
 *  two or three words, or none given (then a few words of the question stand
 *  in, which is a face's reading, not the record's). */
export const HeaderSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("header"),
    text: Schema.NonEmptyString,
  }),
]);
export type Header = typeof HeaderSchema.Type;

/** THE FILE A QUESTION IS ABOUT — worktree-relative, exactly as the work's
 *  own `file` events spell it (`.waterfall/plan.md`) — or none. A plan
 *  approval carries the plan, so every face that draws the question can offer
 *  the one thing a person must read before answering it. */
export const QuestionFileSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("file"),
    path: Schema.NonEmptyString,
  }),
]);
export type QuestionFile = typeof QuestionFileSchema.Type;

/** What every decision carries, asked or settled. One ask (a form) can hold
 *  several questions — the setup is one form — so `ask` is the form's id and
 *  `id` is this question's own. */
const questionFields = {
  id: Schema.String,
  ask: Schema.String,
  /** When it was asked. */
  at: Schema.String,
  question: Schema.String,
};

/** WHAT A QUESTION IS ABOUT, by arm. A setup question is labelled by its
 *  key's own name and answered in kolu's words; a question about the work is
 *  the asker's, with its header, its options and the file it is about. */
const modeFields = {
  ...questionFields,
  topic: Schema.Literal("setup"),
  key: Schema.Literal("mode"),
  options: Schema.Array(WorkModeSchema),
};
const onGreenFields = {
  ...questionFields,
  topic: Schema.Literal("setup"),
  key: Schema.Literal("on-green"),
  options: Schema.Array(OnGreenSchema),
};
/** A question whose options are KOLU'S ({@link KOLU_CHOICE_KEYS}): no options
 *  and no `multiple` — there is nowhere to write either, so a stored copy of
 *  a model list is not a value. */
const koluChoiceFields = {
  ...questionFields,
  topic: Schema.Literal("setup"),
  key: KoluChoiceKeySchema,
};
const aboutWorkFields = {
  ...questionFields,
  topic: Schema.Literal("work"),
  header: HeaderSchema,
  options: Schema.Array(Schema.String),
  /** Whether more than one option may be picked. */
  multiple: Schema.Boolean,
  file: QuestionFileSchema,
};

const asked = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.Struct({ kind: Schema.Literal("asked"), ...fields });
const settled = <F extends Schema.Struct.Fields, A extends Schema.Top>(
  fields: F,
  answer: A,
) => Schema.Struct({ kind: Schema.Literal("settled"), ...fields, answer });

/** ONE QUESTION PUT TO THE HUMAN, and how it ended — as a SUM.
 *
 *  `asked` is a question waiting on somebody; `settled` carries how it was
 *  settled ({@link answerOf}: answered with its value, declined, dropped).
 *  The open asks a card draws are therefore DERIVED (`openAsks`): there is no
 *  second list that a restart could leave disagreeing with the decisions.
 *  Each arm is four shapes, by what the question is about. */
export const AskedSchema = Schema.Union([
  asked(modeFields),
  asked(onGreenFields),
  asked(koluChoiceFields),
  asked(aboutWorkFields),
]);
export type Asked = typeof AskedSchema.Type;

export const SettledSchema = Schema.Union([
  settled(modeFields, ModeAnswerSchema),
  settled(onGreenFields, OnGreenAnswerSchema),
  settled(koluChoiceFields, KoluChoiceAnswerSchema),
  settled(aboutWorkFields, WorkAnswerSchema),
]);
export type Settled = typeof SettledSchema.Type;

export const DecisionSchema = Schema.Union([AskedSchema, SettledSchema]);
export type Decision = typeof DecisionSchema.Type;

/** How a decision was settled — answered, declined or dropped. */
export type DecisionAnswer = Settled["answer"];

/** A setup decision — `mode`, `on-green`, or one of kolu's own questions. */
export type SetupDecision = Extract<Decision, { readonly topic: "setup" }>;
/** A decision kolu draws the options for — a role's harness or model. */
export type KoluChoice = Extract<Decision, { readonly key: KoluChoiceKey }>;
/** A question about the work — the asker's own. */
export type AboutWork = Extract<Decision, { readonly topic: "work" }>;
/** ... and every one whose options the asker gave. */
export type Offered = Exclude<Decision, KoluChoice>;

export const isSetup = (decision: Decision): decision is SetupDecision =>
  decision.topic === "setup";
export const isKoluChoice = (decision: Decision): decision is KoluChoice =>
  decision.topic === "setup" && isKoluChoiceKey(decision.key);

export const isAsked = (decision: Decision): decision is Asked =>
  decision.kind === "asked";
export const isSettled = (decision: Decision): decision is Settled =>
  decision.kind === "settled";

/** WHERE A WORK IS WORKING — git's LAST ANSWER for the work's own key: the
 *  folder its branch is checked out in on the key's host, which its files are
 *  listed from and its code is browsed in. `unread` until git has been asked;
 *  `absent` when the branch is checked out nowhere on its host; `at` the
 *  folder. No host: it is always the key's. Kept on the WORK so it outlives
 *  its terminals, and written by one rule (`record.ts`'s `recordWorktree`),
 *  never off a member — a member may stand anywhere. */
export const WorkWorktreeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unread") }),
  Schema.Struct({ kind: Schema.Literal("absent") }),
  Schema.Struct({
    kind: Schema.Literal("at"),
    path: Schema.NonEmptyString,
  }),
]);
export type WorkWorktree = typeof WorkWorktreeSchema.Type;

export const WorkSchema = Schema.Struct({
  /** WHAT THIS WORK IS. The map it sits in is keyed by `workIdOf(key)`, and
   *  {@link parseStore} is what holds those two to each other. */
  key: WorkKeySchema,
  title: Schema.String,
  startedAt: Schema.String,
  decisions: Schema.Array(DecisionSchema),
  events: Schema.Array(WorkEventSchema),
  state: WorkStateSchema,
  worktree: WorkWorktreeSchema,
});
export type Work = typeof WorkSchema.Type;

/** Whether the work is still being done. */
export const isOpen = (work: Work): boolean => work.state.kind === "open";

/** When it ended — none while it is open. */
export const endedAt = (work: Work): Option.Option<string> =>
  work.state.kind === "ended" ? Option.some(work.state.at) : Option.none();

/** How it ended — none while it is open. */
export const outcomeOf = (work: Work): Option.Option<Outcome> =>
  work.state.kind === "ended" ? Option.some(work.state.outcome) : Option.none();

/** The files kolu kept when it ended — none while it is open, by type. */
export const keptOf = (work: Work): Option.Option<ReadonlyArray<KeptFile>> =>
  work.state.kind === "ended" ? Option.some(work.state.kept) : Option.none();

/** THE HOST a work runs on — a field of its key, never a decision and never
 *  a string split. */
export const hostOf = (work: Pick<Work, "key">): string => work.key.host;

/** ONE MEMBER TERMINAL — the whole of what kolu stores about a terminal's
 *  part in a work, in the ONE map keyed by terminal ref.
 *
 *  A terminal is in AT MOST ONE WORK by construction (one map, one key), and
 *  there is no bookkeeping without a member (the same row holds both). There
 *  is no `leftAt`: a member is in the map or it is not, and that it left is a
 *  `left` event on the work's timeline. There is no folder either: where a
 *  terminal stands is its own record's live fact, and nothing about the work
 *  is read off it.
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
});
export type WorkMember = typeof WorkMemberSchema.Type;

/** The member schema a HOST persists: the model's own fields plus whatever
 *  that host remembers about the terminal. Parameterised rather than
 *  declared with a `watch: unknown`, so the host's own schema is the one that
 *  decodes it and this package still owns the four fields a member IS. */
export const memberSchemaWith = <S extends Schema.Top>(watch: S) =>
  Schema.Struct({ ...WorkMemberSchema.fields, watch });
