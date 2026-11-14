/**
 * A PIECE OF WORK, as kolu stores it.
 *
 * The record is three kinds of fact, each with one author:
 *
 *  - **what the Conductor stated when it opened the work** — the title, the
 *    repository and the branch — and a member's role, stated in the same call
 *    that creates or adopts the terminal;
 *  - **what the human decided** — every question put to them about this work
 *    and its answer ({@link Decision}). The setup (host, mode, harness and
 *    model per role, what to do on green) is a set of decisions like any
 *    other, and `./readings.ts` reads it off them: there is no second copy;
 *  - **what kolu observed** — the append-only timeline ({@link WorkEvent}),
 *    the membership changes, the end, and the files it kept.
 *
 * Nothing here knows what a terminal, a conversation or a browser IS: a
 * terminal is a string (`host/id`), a question is its words and options. The
 * live state of anything (a terminal's screen, a PR's check counts, the files
 * in a worktree) is read where it lives and never copied in.
 */

import { Schema } from "effect";

/** What a member is there to do. `other` is a terminal the human asked the
 *  Conductor to keep an eye on without a part in a waterfall. */
export const WORK_ROLES = ["planner", "implementor", "other"] as const;
export const WorkRoleSchema = Schema.Literals(WORK_ROLES);
export type WorkRole = typeof WorkRoleSchema.Type;

/** How the work is run: the whole waterfall, the one-implementor waterfall,
 *  or a plain watch the human asked for. */
export const WORK_MODES = ["full", "trivial", "watch"] as const;
export const WorkModeSchema = Schema.Literals(WORK_MODES);
export type WorkMode = typeof WorkModeSchema.Type;

/** How a finished work ended. `abandoned` is every member gone with no PR
 *  merged or closed — or the setup declined. */
export const WORK_OUTCOMES = ["merged", "closed", "abandoned"] as const;
export const WorkOutcomeSchema = Schema.Literals(WORK_OUTCOMES);
export type WorkOutcome = typeof WorkOutcomeSchema.Type;

/** What to do when CI is green. The ONE place this is written: kolu's
 *  standing reads it, the card shows it, and the Conductor reads it back. */
export const ON_GREEN = ["merge", "hand-over"] as const;
export const OnGreenSchema = Schema.Literals(ON_GREEN);
export type OnGreen = typeof OnGreenSchema.Type;

/** The setup questions, by key. A decision with one of these keys is a setup
 *  answer; a decision with `key: null` is any other question about the work
 *  (approving a plan, a tradeoff an agent stopped on). */
export const SETUP_KEYS = [
  "host",
  "mode",
  "planner.harness",
  "planner.model",
  "implementor.harness",
  "implementor.model",
  "on-green",
] as const;
export const SetupKeySchema = Schema.Literals(SETUP_KEYS);
export type SetupKey = typeof SetupKeySchema.Type;

/** Who an event is BY: the human, an agent (the Conductor or one of the
 *  agents it runs), CI, or kolu itself (membership, the end, files kept). */
export const EVENT_BY = ["you", "agent", "ci", "kolu"] as const;
export const EventBySchema = Schema.Literals(EVENT_BY);
export type EventBy = typeof EventBySchema.Type;

/** THE EVENT VOCABULARY. Every one of these is something kolu OBSERVED —
 *  except `note`, the one line of text the Conductor may add, which nothing
 *  reads to decide anything.
 *
 *  `detail` carries, per kind:
 *  - `requested` — the human's message the work was opened on (may be empty);
 *  - `joined` — the role; `left` — why (`closed` · `released` · `gone`);
 *  - `ready` · `stopped` · `asking` · `exited` · `asleep` — nothing, or a
 *    short reason (`exited` of a command that never started an agent);
 *  - `file` — the path, relative to the worktree (`.waterfall/plan.md`);
 *  - `question` · `answered` · `question-dropped` — the ASK id, which is the
 *    pointer into {@link Decision}: the timeline never copies the words;
 *  - `pr-opened` — `#<number> <title>`; `merged` · `pr-closed` — `#<number>`;
 *  - `checks-failed` — the failing check names, comma-separated;
 *  - `note` — the Conductor's text; `ended` — the outcome;
 *  - `kept` — how many files were kept; `keep-failed` — why;
 *  - `taken-over` · `handed-back` — nothing: the member terminal the person
 *    took the keys to (and gave back) is `terminal`, and that pair is what
 *    {@link driverOf} reads;
 *  - `folded` — how many agent-state events were dropped to keep a work's
 *    timeline bounded, as a decimal string. ONE of these per work, sitting
 *    where the oldest event it stands for sat. */
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
  "kept",
  "keep-failed",
  "taken-over",
  "handed-back",
  "folded",
] as const;
export const EventKindSchema = Schema.Literals(EVENT_KINDS);
export type EventKind = typeof EventKindSchema.Type;

export const WorkEventSchema = Schema.Struct({
  /** ISO time. */
  at: Schema.String,
  by: EventBySchema,
  kind: EventKindSchema,
  /** The member terminal it is about (`host/id`), or `null`. */
  terminal: Schema.NullOr(Schema.String),
  detail: Schema.String,
});
export type WorkEvent = typeof WorkEventSchema.Type;

export const WorkMemberSchema = Schema.Struct({
  /** The fleet ref, `host/id`. */
  terminal: Schema.String,
  role: WorkRoleSchema,
  joinedAt: Schema.String,
  /** When it left the work — closed, released, or gone — or `null`. */
  leftAt: Schema.NullOr(Schema.String),
  /** WHERE IT WORKED, as kolu first read it off the terminal's record — the
   *  worktree a work's files are listed from and copied out of when it ends.
   *  `null` until a reading has said. A fact about the member rather than
   *  about the watch, because the files outlive the terminal: a work usually
   *  ends after its terminals are gone, and the path is the only way back to
   *  what they wrote. */
  worktree: Schema.NullOr(Schema.String),
});
export type WorkMember = typeof WorkMemberSchema.Type;

/** Where an answer came from: the work's card, the chat, or the request
 *  itself (a setup answer the human's message already gave, recorded without
 *  asking). `null` for a question nobody answered (declined from nowhere, or
 *  dropped with the conversation that asked it). */
export const ANSWER_FROM = ["card", "chat", "request"] as const;
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

/** ONE QUESTION put to the human about this work, and its answer. One ask (a
 *  form) can carry several questions — the setup is one form — so `ask` is
 *  the form's id and `id` is this question's own. */
export const DecisionSchema = Schema.Struct({
  id: Schema.String,
  ask: Schema.String,
  /** When it was asked. */
  at: Schema.String,
  /** The setup question this answers, or `null` for any other. */
  key: Schema.NullOr(SetupKeySchema),
  /** THE QUESTION'S SHORT HEADER — two or three words, which is the label a
   *  decision is DRAWN under on the card: the question's own words are behind
   *  a press. `""` for a setup question, whose label is its key's own name,
   *  and for a question whose asker gave none (then a few words of the
   *  question stand in). */
  header: Schema.String,
  question: Schema.String,
  options: Schema.Array(Schema.String),
  /** Whether more than one option may be picked. */
  multiple: Schema.Boolean,
  answer: Schema.NullOr(DecisionAnswerSchema),
});
export type Decision = typeof DecisionSchema.Type;

/** A file copied into kolu when the work ended, so it outlives the worktree.
 *  `path` is relative to the worktree, exactly as its `file` event said. */
export const KeptFileSchema = Schema.Struct({
  path: Schema.String,
  bytes: Schema.Int,
});
export type KeptFile = typeof KeptFileSchema.Type;

export const WorkSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** The repository's absolute path on the work's host ("" for a watch). */
  repo: Schema.String,
  /** The branch (and worktree name) the work is on ("" for a watch). */
  branch: Schema.String,
  members: Schema.Array(WorkMemberSchema),
  events: Schema.Array(WorkEventSchema),
  decisions: Schema.Array(DecisionSchema),
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(WorkOutcomeSchema),
  keptFiles: Schema.Array(KeptFileSchema),
});
export type Work = typeof WorkSchema.Type;
