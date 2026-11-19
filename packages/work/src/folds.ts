/**
 * EVERYTHING COMPUTED FROM A WORK'S TIMELINE — who it is waiting on, where it
 * stands and for how long, where the time went, how long each step took.
 *
 * Pure folds over the record, a clock reading and a {@link Policy} passed in.
 * None of it is stored: a stored "where it stands" would be one more thing a
 * restart could leave disagreeing with the timeline it is drawn from.
 *
 * NO WATERFALL WORDS AND NO ENGLISH. The two facts a fold needs about how the
 * work is RUN arrive as the policy (`./waterfall.ts` reads them off the
 * decisions once), and {@link standing} answers a TOKEN rather than a phrase —
 * the card and the Conductor's own resource want different words for the same
 * fact, and a model that hands out prose is a model whose readers rewrite it.
 */

import { Option } from "effect";
import { type PrReading, prStep } from "./readings.ts";
import {
  type Asked,
  type CheckHead,
  endedAt,
  type Outcome,
  type PrLink,
  type Work,
  type WorkEvent,
  type WorkId,
} from "./schema.ts";

/** Who the work is waiting on. `agent` covers the Conductor and the agents it
 *  runs; `ci` is a PR's checks running; `you` is the human. */
export type Waiter = "agent" | "you" | "ci";

/** HOW A WORK IS RUN, as far as a fold needs it — a work whose mode nobody
 *  has answered yet, or one whose mode is set: whether the Conductor DRIVES
 *  its terminals (a plain watch is somebody's own terminal kolu only keeps
 *  an eye on), and the stages that mode has, in order. Both are read off the
 *  mode's one row (`./waterfall.ts`'s `MODE_RUNS`), so a mode that has no
 *  Review cannot have time filed there. */
export type Run =
  | { readonly kind: "unset" }
  | {
      readonly kind: "set";
      readonly driven: boolean;
      readonly stages: ReadonlyArray<StageName>;
    };

/** WHAT THE WATERFALL'S WORDS MEAN HERE — the whole of what a fold needs to
 *  know about how this work is run, read once by `./waterfall.ts`'s
 *  `policyOf`.
 *
 *  - `handOver` — the human said to hand the PR over once it is green, so a
 *    PR the forge would merge is a wait on THEM rather than the end of the
 *    agents' stretch;
 *  - `run` — how the work is run ({@link Run}). */
export interface Policy {
  readonly handOver: boolean;
  readonly run: Run;
}

/** WHICH PART OF ITS LIFE A WORK IS IN — cut by two moments the record
 *  holds: the implementor joining, and its pull request being READY FOR
 *  REVIEW after it did — opened ready, or a draft marked ready. A PR that was
 *  already there when the implementor arrived (a work that takes up a
 *  dependabot PR) marks nothing, and the build goes on. Moves forward, except
 *  for two ways back to the build: a PR turned back into a draft (its author
 *  said it is not ready), and a work reopened with no PR of its own open (a
 *  second attempt on the same branch builds again). */
type Part = "before" | "build" | "after";

/** The fold's running state, advanced one event at a time — the SAME step
 *  {@link waitingOn}, {@link standing}, {@link timeSpent} and {@link stages}
 *  use, so the strip and the sentence over it cannot disagree about when a
 *  wait began. The pull request is what `./readings.ts`'s {@link prStep}
 *  says it is — the ONE statement of the PR-fact rule (which commit a check
 *  or a merge answer is about, and what opening, merging, closing and
 *  reopening forget), which the observer reads too. */
interface Running {
  readonly openAsks: ReadonlySet<string>;
  readonly pr: Option.Option<PrReading>;
  readonly ended: boolean;
  readonly part: Part;
  /** A planner has joined — before that there is no plan to approve, so a
   *  wait on the human (the setup's questions) is still the planning. */
  readonly planned: boolean;
  /** An implementor has joined at some point — where a reopened work with
   *  no PR goes back to, and what makes a PR opening the end of a build. */
  readonly implemented: boolean;
}

const START: Running = {
  openAsks: new Set(),
  pr: Option.none(),
  ended: false,
  part: "before",
  planned: false,
  implemented: false,
};

/** Whether the PR is in this state. */
const prIs = (at: Running, state: PrReading["state"]): boolean =>
  Option.exists(at.pr, (pr) => pr.state === state);

/** Whether the PR is open and a draft — still the build's, CI included. */
const openDraft = (pr: Option.Option<PrReading>): boolean =>
  Option.exists(pr, (one) => one.state === "open" && one.draft === "draft");

/** The moves that are not the PR's own: questions, members, the end. `pr` is
 *  the PR as this event leaves it ({@link prStep}), which is what says
 *  whether it is ready for review. */
const partStep = (
  at: Running,
  event: WorkEvent,
  pr: Option.Option<PrReading>,
): Running => {
  switch (event.kind) {
    case "question":
      return { ...at, openAsks: new Set([...at.openAsks, event.ask]) };
    case "answered":
    case "question-dropped": {
      const open = new Set(at.openAsks);
      open.delete(event.ask);
      return { ...at, openAsks: open };
    }
    case "joined":
      if (event.role === "planner") return { ...at, planned: true };
      return event.role === "implementor"
        ? {
            ...at,
            implemented: true,
            part: at.part === "before" ? "build" : at.part,
          }
        : at;
    // A PR the implementor opened ends the build once it is ready for
    // review — at once when it opened ready, at the flip for a draft — and a
    // PR turned back into a draft is the build's again. A PR whose word was
    // never recorded ends it at the open, as it always did. One that was
    // there before any implementor joined says nothing about it.
    case "pr-opened":
    case "draft-state":
      return at.implemented
        ? { ...at, part: openDraft(pr) ? "build" : "after" }
        : at;
    case "ended":
      return { ...at, ended: true };
    // THE ONE WAY BACK. Reopened with its own PR still open, the work is
    // where it was; with none, it is a new attempt on the branch.
    case "reopened":
      return {
        ...at,
        ended: false,
        part:
          at.part === "after" && prIs(at, "open")
            ? "after"
            : at.implemented
              ? "build"
              : "before",
      };
    default:
      return at;
  }
};

const step = (at: Running, event: WorkEvent): Running => {
  const pr = prStep(at.pr, event);
  return { ...partStep(at, event, pr), pr };
};

/** THE GREEN PULL REQUEST, and therefore the human's when they asked for the
 *  hand-over: the forge would merge it, and no check that has reported is
 *  running or red, both about the same commit ({@link prStep} forgets the one
 *  that is not). A PR with no checks at all is green the moment the forge
 *  says so. None while it is not green. */
const greenOf = (at: Running): Option.Option<PrReading> =>
  Option.filter(
    at.pr,
    (pr) =>
      pr.state === "open" &&
      pr.merge.kind === "can" &&
      (pr.checks === "none" || pr.checks === "passed"),
  );

const waiterOf = (handOver: boolean, at: Running): Waiter | "done" => {
  if (at.ended) return "done";
  if (at.openAsks.size > 0) return "you";
  if (Option.exists(at.pr, (pr) => pr.checks === "running")) return "ci";
  return handOver && Option.isSome(greenOf(at)) ? "you" : "agent";
};

/** Who the work is waiting on now, or `done` once it has ended. */
export const waitingOn = (work: Work, policy: Policy): Waiter | "done" =>
  work.state.kind === "ended"
    ? "done"
    : waiterOf(policy.handOver, work.events.reduce(step, START));

/** A GREEN PULL REQUEST, as a merge wait names it: its number, the commit
 *  that is green (the forge's last merge answer was about it — the one
 *  {@link prStep} keeps beside checks about the same commit), and where it
 *  lives. */
export interface GreenPr {
  readonly number: number;
  readonly head: CheckHead;
  readonly link: PrLink;
}

/** WHERE A WORK STANDS, in one reading — who it waits on, why, since when —
 *  as a SUM, each arm carrying only what is true of it. Every reader renders
 *  its own words: the card capitalises and adds a live check tally, the
 *  Conductor's `works` resource writes a sentence for an agent.
 *
 *  - `question` — the human has been asked something; `ask` is the newest
 *    ask still open and `question` its words;
 *  - `merge` — the PR is green (the forge would merge it, and no reported
 *    check is running or red) and the merge is theirs; `pr` is that PR when
 *    the timeline knows one;
 *  - `ci` — the checks are running;
 *  - `watching` — kolu is keeping an eye on a terminal nobody works for;
 *  - `working` — the agents have it;
 *  - `done` — the work is finished, and `outcome` is how (which PR, or who
 *    stopped it). */
export type Standing =
  | {
      readonly why: "question";
      readonly ask: string;
      readonly question: string;
      readonly since: string;
    }
  | {
      readonly why: "merge";
      readonly pr: Option.Option<GreenPr>;
      readonly since: string;
    }
  | { readonly why: "ci"; readonly since: string }
  | { readonly why: "watching" | "working"; readonly since: string }
  | {
      readonly why: Outcome["kind"];
      readonly outcome: Outcome;
      readonly since: string;
    };

/** WHO EACH REASON WAITS ON — the one table that derives the waiter from the
 *  reason, so no arm has to carry both. */
export const WAITER_OF: Record<StandingWhy, Waiter | "done"> = {
  question: "you",
  merge: "you",
  ci: "ci",
  watching: "agent",
  working: "agent",
  merged: "done",
  closed: "done",
  stopped: "done",
};

/** Why a work stands where it does, as a token. */
export type StandingWhy = Standing["why"];

/** The open question a `you` wait is about — the newest ask with a decision
 *  nobody has answered. */
const askedOf = (work: Work, open: ReadonlySet<string>): Option.Option<Asked> =>
  Option.flatMap(Option.fromUndefinedOr([...open].at(-1)), (asked) =>
    Option.fromUndefinedOr(
      work.decisions.find(
        (one): one is Asked => one.ask === asked && one.kind === "asked",
      ),
    ),
  );

const standingOf = (
  work: Work,
  who: Waiter,
  at: Running,
  policy: Policy,
  since: string,
): Standing => {
  switch (who) {
    case "you":
      return Option.match(askedOf(work, at.openAsks), {
        onSome: (question): Standing => ({
          why: "question",
          ask: question.ask,
          question: question.question,
          since,
        }),
        onNone: (): Standing => ({
          why: "merge",
          pr: Option.map(
            greenOf(at),
            (pr): GreenPr => ({
              number: pr.number,
              head: Option.match(pr.lastMerge, {
                onNone: (): CheckHead => ({ kind: "unreported" }),
                onSome: (answer) => answer.head,
              }),
              link: pr.link,
            }),
          ),
          since,
        }),
      });
    case "ci":
      return { why: "ci", since };
    case "agent":
      return {
        why:
          policy.run.kind === "set" && !policy.run.driven
            ? "watching"
            : "working",
        since,
      };
    default:
      return who satisfies never;
  }
};

export const standing = (work: Work, policy: Policy): Standing => {
  if (work.state.kind === "ended") {
    return {
      why: work.state.outcome.kind,
      outcome: work.state.outcome,
      since: work.state.at,
    };
  }
  let at = START;
  let who = waiterOf(policy.handOver, at);
  let since = work.startedAt;
  for (const event of work.events) {
    at = step(at, event);
    const next = waiterOf(policy.handOver, at);
    if (next !== who) {
      who = next;
      since = event.at;
    }
  }
  // An OPEN work is waiting on somebody whatever its timeline's last `ended`
  // event said — a reopened work keeps that event, and the state is the
  // record's one answer to "is it over".
  return standingOf(work, who === "done" ? "agent" : who, at, policy, since);
};

/** One stretch of time, and who it waited on. */
interface Stretch {
  readonly who: Waiter;
  readonly ms: number;
}

const ms = (from: string, to: string): number =>
  Math.max(0, Date.parse(to) - Date.parse(from));

/** THE WALK every time fold takes: the work's life, from its start to its end
 *  (or `now`), visited one stretch at a time with the running state that
 *  stretch was spent in — a stretch between two events stamped at the same
 *  instant too, with no length, which is how a stage that took no time is
 *  still known to have happened. An event stamped before the one ahead of
 *  it, or after the end, is held to the walk's own clock, so the stretches
 *  always tile the life exactly. */
const walk = (
  work: Work,
  now: string,
  visit: (at: Running, length: number) => void,
): Running => {
  const start = Date.parse(work.startedAt);
  const end = Math.max(
    start,
    Date.parse(Option.getOrElse(endedAt(work), () => now)),
  );
  let at = START;
  let from = start;
  for (const event of work.events) {
    const until = Math.min(Math.max(Date.parse(event.at), from), end);
    visit(at, until - from);
    from = until;
    at = step(at, event);
  }
  visit(at, end - from);
  return at;
};

/** The work's life cut into stretches by who it was waiting on — what
 *  {@link timeSpent} sums. Time a reopened work spent ended is nobody's. */
const stretches = (
  work: Work,
  policy: Policy,
  now: string,
): ReadonlyArray<Stretch> => {
  const all: Stretch[] = [];
  walk(work, now, (at, length) => {
    const who = waiterOf(policy.handOver, at);
    if (who !== "done" && length > 0) all.push({ who, ms: length });
  });
  return all;
};

/** WHERE THE TIME WENT: the work's life, summed by who it was waiting on. */
export const timeSpent = (
  work: Work,
  policy: Policy,
  now: string,
): Readonly<Record<Waiter, number>> => {
  const spent: Record<Waiter, number> = { agent: 0, you: 0, ci: 0 };
  for (const stretch of stretches(work, policy, now))
    spent[stretch.who] += stretch.ms;
  return spent;
};

/** How long the work has run: from its start to its end, or to `now` — less
 *  any time it spent ended before it was reopened, which nobody worked. The
 *  same walk as {@link timeSpent} and {@link stages}. */
export const lifetime = (work: Work, now: string): number => {
  let total = 0;
  walk(work, now, (at, length) => {
    if (!at.ended) total += length;
  });
  return total;
};

/** THE SIX STAGES of a waterfall, always in this order. */
export const STAGES = [
  "plan",
  "approve",
  "build",
  "review",
  "checks",
  "merge",
] as const;
export type StageName = (typeof STAGES)[number];

/** WHERE A STRETCH, AND THE EVENT THAT BEGINS IT, IS FILED: one of the six
 *  stages, or `setup` — time before the first stage a mode has, in a mode
 *  with no Plan to hold it: a trivial work's setup form, and the Conductor
 *  starting its implementor. It is somebody's time (it counts in
 *  {@link timeSpent}) but no cell's: nothing was built yet. A full waterfall
 *  has no `setup` stretch — its setup's questions are Plan's. */
export type Filed = StageName | "setup";

/** WHERE A STAGE STANDS, as a sum — each arm carries only what is true of it:
 *
 *  - `done` — the work was in it (for `ms`, which may be none) and is not
 *    in it now; `who` is whose time it mostly was, so the setup's questions
 *    filed under Plan read as yours when they were most of it;
 *  - `now` — the work is in it, for `ms` so far, waiting on `who`;
 *  - `not-started` — the work has not reached it;
 *  - `skipped` — it did not happen: the work's mode has no such stage (a
 *    trivial work is never planned or reviewed), the work went past it
 *    without ever being in it, or it ended without reaching it. */
export type StageState =
  | { readonly kind: "done"; readonly ms: number; readonly who: Waiter }
  | { readonly kind: "now"; readonly ms: number; readonly who: Waiter }
  | { readonly kind: "not-started" }
  | { readonly kind: "skipped" };

/** One stage of a work, and where it stands. */
export interface Stage {
  readonly name: StageName;
  readonly state: StageState;
}

/** THE STAGES OF A WORK, as a sum, from its mode's row of `MODE_RUNS`: a
 *  work whose mode nobody has answered has none yet (`unset`); a mode that
 *  declares none (a plain watch) has none (`none`); any other has all six
 *  cells, the ones its mode does not declare reading "did not happen". It
 *  files every event of its timeline (`events`, one per event, in the
 *  timeline's order: where the stretch that event begins is {@link Filed},
 *  by the same walk that files the time, so an event and the time after it
 *  are never in two places), and says once where the work is (`current`:
 *  where it is now, or where it ended). */
export type Stages =
  | { readonly kind: "unset" }
  | { readonly kind: "none" }
  | {
      readonly kind: "staged";
      readonly stages: ReadonlyArray<Stage>;
      readonly events: ReadonlyArray<Filed>;
      readonly current: Filed;
    };

/** How long a stage has had: its time, or none for a stage that has had
 *  none. */
export const stageMs = (state: StageState): number =>
  state.kind === "done" || state.kind === "now" ? state.ms : 0;

/** WHERE A STRETCH WOULD GO in a waterfall that has all six stages:
 *
 *  - a PR the forge merged is the merge, and CI running is the checks,
 *    wherever they fall — except on a draft still in the build, whose CI is
 *    the build's;
 *  - a green PR handed to the human is the merge;
 *  - a question to the human never moves the work: it stays in the stage it
 *    is in (`current`), which is then theirs — except before the implementor,
 *    where it is the approval once a planner has joined, and the planning
 *    (the setup's own questions) before that;
 *  - the agents' time is the plan before the implementor joins, the build
 *    until its PR is ready for review, and the review after. There are two
 *    ways back to the build: the PR turned back into a draft, and a reopen
 *    with no PR of its own open. */
const placeOf = (at: Running, who: Waiter, current: Filed): Filed => {
  if (prIs(at, "merged")) return "merge";
  if (who === "ci")
    return at.part === "build" && openDraft(at.pr) ? "build" : "checks";
  if (who === "you") {
    if (at.openAsks.size === 0) return "merge";
    if (at.part === "before") return at.planned ? "approve" : "plan";
    return current;
  }
  switch (at.part) {
    case "before":
      return "plan";
    case "build":
      return "build";
    case "after":
      return "review";
    default:
      return at.part satisfies never;
  }
};

/** THE STAGES: the same walk as {@link timeSpent}, each stretch filed under
 *  the stage it belongs to ({@link placeOf}) — and a stage the work's mode
 *  does not have is never written to: its time goes to the nearest stage
 *  before it that the mode has (a trivial work's agents build, before the
 *  PR and after it), else to no stage at all (`setup`, {@link Filed}). A
 *  stage the work was in for no time (two events stamped at one instant)
 *  still happened. The stages' times and the setup's add up to
 *  {@link lifetime}.
 *
 *  Each event is filed where the stretch it begins is; one that leaves the
 *  work ended (or begins a stretch of it ended) stays where the work was
 *  last. */
export const stages = (work: Work, policy: Policy, now: string): Stages => {
  const run = policy.run;
  if (run.kind === "unset") return { kind: "unset" };
  if (run.stages.length === 0) return { kind: "none" };
  const declared = new Set<StageName>(run.stages);
  /** Where a stretch is filed in THIS mode. */
  const file = (place: Filed): Filed =>
    place === "setup" || declared.has(place)
      ? place
      : (STAGES.slice(0, STAGES.indexOf(place))
          .filter((one) => declared.has(one))
          .at(-1) ?? "setup");
  /** Each stage's time by whose it was, and who it began with — what a
   *  stage entered for no time is coloured by. */
  const held = new Map<StageName, Record<Waiter, number>>();
  const began = new Map<StageName, Waiter>();
  const events: Filed[] = [];
  let current: Filed = file("plan");
  let visits = 0;
  const last = walk(work, now, (at, length) => {
    const who = waiterOf(policy.handOver, at);
    if (who !== "done") {
      current = file(placeOf(at, who, current));
      if (current !== "setup") {
        const into = held.get(current) ?? { agent: 0, you: 0, ci: 0 };
        into[who] += length;
        held.set(current, into);
        if (!began.has(current)) began.set(current, who);
      }
    }
    // The first stretch is the one before any event; each after it is the
    // one the event before it began.
    if (visits > 0) events.push(current);
    visits += 1;
  });
  // WHERE IT IS NOW. An OPEN work is waiting on somebody whatever its
  // timeline's last `ended` event said, as {@link standing} reads it; a
  // finished one is where it ended. A work still in its setup is in no cell.
  const open = work.state.kind === "open";
  const waiter = waiterOf(policy.handOver, last);
  const nowWho: Waiter = waiter === "done" ? "agent" : waiter;
  if (open) current = file(placeOf(last, nowWho, current));
  const at = !open
    ? STAGES.length
    : current === "setup"
      ? -1
      : STAGES.indexOf(current);
  return {
    kind: "staged",
    events,
    current,
    stages: STAGES.map((name, index): Stage => {
      const time = held.get(name);
      const ms = time === undefined ? 0 : time.agent + time.you + time.ci;
      if (!declared.has(name)) return { name, state: { kind: "skipped" } };
      if (index === at)
        return { name, state: { kind: "now", ms, who: nowWho } };
      const who = began.get(name);
      if (time !== undefined && who !== undefined)
        return { name, state: { kind: "done", ms, who: mostly(time, who) } };
      return {
        name,
        state: { kind: index < at ? "skipped" : "not-started" },
      };
    }),
  };
};

/** Whose time a stage mostly was — who it began with, when nobody's was
 *  more. */
const mostly = (
  time: Readonly<Record<Waiter, number>>,
  began: Waiter,
): Waiter =>
  (["agent", "you", "ci"] as const).reduce(
    (best, one) => (time[one] > time[best] ? one : best),
    began,
  );

/** HOW LONG EACH STEP TOOK — the timeline's right-hand column: from an event
 *  to the next one; the last event of a work in progress is still running
 *  (`open`). A step that leaves the work ended took nothing — the time until
 *  it was reopened was nobody's, as {@link lifetime} reads it. */
export const took = (
  work: Work,
  now: string,
): ReadonlyArray<{ readonly ms: number; readonly open: boolean }> => {
  let at = START;
  return work.events.map((event, index) => {
    at = step(at, event);
    const next = work.events[index + 1];
    if (at.ended) return { ms: 0, open: false };
    if (next !== undefined) return { ms: ms(event.at, next.at), open: false };
    return work.state.kind === "open"
      ? { ms: ms(event.at, now), open: true }
      : { ms: 0, open: false };
  });
};

/** A work and the id it is filed under — what the ordering folds take, now
 *  that the id is the map's key rather than a field of the record. */
export type WorkRow = readonly [WorkId, Work];

/** Works in progress, oldest first — a card keeps its place. */
export const inProgress = (
  works: ReadonlyArray<WorkRow>,
): ReadonlyArray<WorkRow> =>
  works.filter(([, one]) => one.state.kind === "open");

/** Finished works, the most recently ended first. */
export const finished = (
  works: ReadonlyArray<WorkRow>,
): ReadonlyArray<WorkRow> =>
  works
    .filter(([, one]) => one.state.kind === "ended")
    .sort((a, b) => {
      const ended = (row: WorkRow) =>
        Option.getOrElse(endedAt(row[1]), () => row[1].startedAt);
      return ended(a) < ended(b) ? 1 : -1;
    });

/** THE HISTORY CAP: every work in progress, and the `keep` most recently
 *  finished. `dropped` is what fell off — the caller deletes their kept files.
 *  Order of `kept` is the order given.
 *
 *  `keep` has no default, deliberately: how many finished works are worth the
 *  disk they sit on is the HOST'S policy (it owns the state root and the kept
 *  files under it), and a number living in the model would be a storage
 *  decision nobody could find. */
export const capFinished = (
  works: ReadonlyArray<WorkRow>,
  keep: number,
): {
  readonly kept: ReadonlyArray<WorkRow>;
  readonly dropped: ReadonlyArray<WorkRow>;
} => {
  const keepIds = new Set(
    finished(works)
      .slice(0, keep)
      .map(([id]) => id),
  );
  return {
    kept: works.filter(
      ([id, one]) => one.state.kind === "open" || keepIds.has(id),
    ),
    dropped: works.filter(
      ([id, one]) => one.state.kind === "ended" && !keepIds.has(id),
    ),
  };
};
