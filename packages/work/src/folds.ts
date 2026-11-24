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
import {
  type Holding,
  handsOver,
  holdStep,
  joinedAs,
  NOBODY_HOLDS,
  type PrReading,
  plannersTurn,
  prStep,
} from "./readings.ts";
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

/** WHETHER WHO HELD THE WORK WAS RECORDED — kolu kept no hand-offs before
 *  the upgrade that wrote `hand-offs-kept`, so on a work that carries one,
 *  who held it is not known (`unrecorded`) until that event, nor after it
 *  (`awaiting`) until the first hand-off since; from then on it is
 *  `recorded`. A work with no such event was recorded from its start. */
type HandOffs = "unrecorded" | "awaiting" | "recorded";

/** The fold's running state, advanced one event at a time — the SAME step
 *  {@link waitingOn}, {@link standing}, {@link timeSpent} and {@link stages}
 *  use, so the map and the sentence over it cannot disagree about when a
 *  wait began. The pull request is what `./readings.ts`'s {@link prStep}
 *  says it is — the ONE statement of the PR-fact rule (which commit a check
 *  or a merge answer is about, and what opening, merging, closing and
 *  reopening forget), which the observer reads too — and who holds the work
 *  is what its {@link holdStep} says, the one statement of the hand-off
 *  rule. */
interface Running {
  readonly openAsks: ReadonlySet<string>;
  readonly pr: Option.Option<PrReading>;
  readonly ended: boolean;
  readonly holding: Holding;
  readonly handOffs: HandOffs;
}

/** Where a work's walk begins: nothing asked, no PR, nobody holding it, and
 *  its hand-offs recorded unless the upgrade said they were not. */
const startOf = (work: Work): Running => ({
  openAsks: new Set(),
  pr: Option.none(),
  ended: false,
  holding: NOBODY_HOLDS,
  handOffs: work.events.some((one) => one.kind === "hand-offs-kept")
    ? "unrecorded"
    : "recorded",
});

/** Whether the PR is in this state. */
const prIs = (at: Running, state: PrReading["state"]): boolean =>
  Option.exists(at.pr, (pr) => pr.state === state);

/** Whether the hand-offs are recorded after this event: the upgrade's
 *  `hand-offs-kept` starts the wait for one, and the first hand-off after
 *  it ends the wait. */
const handOffsStep = (at: Running, event: WorkEvent): HandOffs => {
  if (at.handOffs === "unrecorded" && event.kind === "hand-offs-kept")
    return "awaiting";
  if (at.handOffs === "awaiting" && handsOver(at.holding, event))
    return "recorded";
  return at.handOffs;
};

/** The moves that are not the PR's own: questions, who holds the work, the
 *  end. */
const askStep = (at: Running, event: WorkEvent): Running => {
  switch (event.kind) {
    case "question":
      return { ...at, openAsks: new Set([...at.openAsks, event.ask]) };
    case "answered":
    case "question-dropped": {
      const open = new Set(at.openAsks);
      open.delete(event.ask);
      return { ...at, openAsks: open };
    }
    case "ended":
      return { ...at, ended: true };
    case "reopened":
      return { ...at, ended: false };
    default:
      return at;
  }
};

const step = (at: Running, event: WorkEvent): Running => ({
  ...askStep(at, event),
  pr: prStep(at.pr, event),
  holding: holdStep(at.holding, event),
  handOffs: handOffsStep(at, event),
});

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
    : waiterOf(policy.handOver, work.events.reduce(step, startOf(work)));

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
  let at = startOf(work);
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
 *  instant too, with no length (what {@link stages} makes of one is its own
 *  rule: one instant is one moment). An event stamped before the one ahead of
 *  it, or after the end, is held to the walk's own clock, so the stretches
 *  always tile the life exactly. Each stretch is visited with the instant it
 *  begins on that clock. */
const walk = (
  work: Work,
  now: string,
  visit: (at: Running, length: number, from: number) => void,
): Running => {
  const start = Date.parse(work.startedAt);
  const end = Math.max(
    start,
    Date.parse(Option.getOrElse(endedAt(work), () => now)),
  );
  let at = startOf(work);
  let from = start;
  for (const event of work.events) {
    const until = Math.min(Math.max(Date.parse(event.at), from), end);
    visit(at, until - from, from);
    from = until;
    at = step(at, event);
  }
  visit(at, end - from, from);
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

/** THE DOUBTS — stretches kolu cannot file in one stage: who held the work
 *  was not recorded (a work saved before kolu kept hand-offs, up to the
 *  first hand-off after the upgrade), and the stage turns on it. Exactly
 *  two exist, in the order a work meets them: a plan you answered was the
 *  plan again or the approval; after the implementor joined, the agents'
 *  time was the build or the review. The one statement of them: the type,
 *  {@link DOUBT_STAGES} and {@link isDoubt} are read off it. */
export const DOUBTS = ["plan-or-approve", "build-or-review"] as const;
export type Doubt = (typeof DOUBTS)[number];

/** The two stages of each doubt: the one it is if the planner had the work,
 *  and the one it is otherwise. */
export const DOUBT_STAGES: Record<
  Doubt,
  { readonly planners: StageName; readonly others: StageName }
> = {
  "plan-or-approve": { planners: "plan", others: "approve" },
  "build-or-review": { planners: "review", others: "build" },
};

/** WHERE A STRETCH, AND THE EVENT THAT BEGINS IT, IS FILED: one of the six
 *  stages, a {@link Doubt} between two of them, or the `setup` — time before
 *  the first stage a mode has, in a mode with no Plan to hold it: a trivial
 *  work's setup form, and the Conductor starting its implementor. Nothing
 *  was built yet. A full waterfall has no `setup` stretch — its setup's
 *  questions are Plan's. */
export type Filed = StageName | "setup" | Doubt;

/** Whether a place is a doubt. */
export const isDoubt = (place: Filed): place is Doubt =>
  (DOUBTS as ReadonlyArray<Filed>).includes(place);

/** Whether a place is one of the six stages. */
const isStage = (place: Filed): place is StageName =>
  place !== "setup" && !isDoubt(place);

/** THE DOUBT BETWEEN TWO STAGES — the planner's and the other's — read off
 *  {@link DOUBT_STAGES}. Only the pairs it lists stand for a doubt; asking
 *  for any other is a defect in the caller, and fails loudly. */
const doubtBetween = (planners: StageName, others: StageName): Doubt =>
  Option.getOrThrowWith(
    Option.fromUndefinedOr(
      DOUBTS.find(
        (doubt) =>
          DOUBT_STAGES[doubt].planners === planners &&
          DOUBT_STAGES[doubt].others === others,
      ),
    ),
    () => new Error(`no doubt stands between ${planners} and ${others}`),
  );

/** The stages a place can be, in the map's order: itself, a doubt's two,
 *  none for the setup. */
export const canBe = (place: Filed): ReadonlyArray<StageName> => {
  if (place === "setup") return [];
  if (!isDoubt(place)) return [place];
  const { planners, others } = DOUBT_STAGES[place];
  return STAGES.filter((one) => one === planners || one === others);
};

/** ONE VISIT to a place — a run of stretches filed in one place, closed by
 *  the work moving somewhere else or ending. A visit may take no time only
 *  where the work ended at the instant it got there (a PR merged and the
 *  work ended at once still reached the merge): between events of one
 *  instant there is no visit.
 *
 *  - `from`, `until` — when it began and ended; `until` is none for the
 *    visit the work is in now;
 *  - `time` — its time by whom the work waited on, which adds up to its
 *    length less any time the work spent ended;
 *  - `events` — the events filed in it, as indices into the work's events:
 *    from `from`, up to and not including `until`. */
export interface Visit {
  readonly stage: Filed;
  readonly from: string;
  readonly until: Option.Option<string>;
  readonly time: Readonly<Record<Waiter, number>>;
  readonly events: { readonly from: number; readonly until: number };
}

/** How long a visit took: its time, whoever the work waited on. */
export const visitMs = (visit: Visit): number =>
  visit.time.agent + visit.time.you + visit.time.ci;

/** WHERE A STAGE STANDS, as a sum — each arm carries only what is true of it:
 *
 *  - `done` — the work was in it (for `ms`, which is none only for the stage
 *    a work ended in at the instant it got there) and is not in it now;
 *    `who` is whose time it mostly was, so the setup's questions filed under
 *    Plan read as yours when they were most of it;
 *  - `now` — the work is in it, for `ms` so far over every visit and `here`
 *    in the visit in hand (`here <= ms`); `who` is whose time it has mostly
 *    been so far, by the same rule as a finished stage. Who the work waits
 *    on at this moment is the standing line's fact, not this cell's;
 *  - `unrecorded` — it had no visit of its own, and a {@link Doubt} the work
 *    visited names it: that stretch may have been it. It carries nothing —
 *    the time belongs to the doubt ({@link doubtsOf}), and where the work is
 *    belongs to `where`;
 *  - `not-started` — the work has not reached it;
 *  - `skipped` — it did not happen: the work's mode has no such stage (a
 *    trivial work is never planned or reviewed), the work went past it
 *    without ever being in it, or it ended without reaching it. */
export type StageState =
  | { readonly kind: "done"; readonly ms: number; readonly who: Waiter }
  | {
      readonly kind: "now";
      readonly ms: number;
      readonly here: number;
      readonly who: Waiter;
    }
  | { readonly kind: "unrecorded" }
  | { readonly kind: "not-started" }
  | { readonly kind: "skipped" };

/** One stage of a work, and where it stands. */
export interface Stage {
  readonly name: StageName;
  readonly state: StageState;
}

/** WHERE THE WORK IS (`in`, while it is open), or where it ended
 *  (`ended-in`). */
export type Where =
  | { readonly kind: "in"; readonly place: Filed }
  | { readonly kind: "ended-in"; readonly place: Filed };

/** THE STAGES OF A WORK, as a sum, from its mode's row of `MODE_RUNS`: a
 *  work whose mode nobody has answered has none yet (`unset`); a mode that
 *  declares none (a plain watch) has none (`none`); any other has all six
 *  cells, the ones its mode does not declare reading "did not happen", each
 *  holding its time across every visit to it. It files every event of its
 *  timeline (`events`, one per event, in the timeline's order: where the
 *  stretch that event begins is {@link Filed}, by the same walk that files
 *  the time, so an event and the time after it are never in two places),
 *  says once where the work is ({@link Where}), and keeps every visit in
 *  order (`trail`): the cells are the trail summed by stage. */
export type Stages =
  | { readonly kind: "unset" }
  | { readonly kind: "none" }
  | {
      readonly kind: "staged";
      readonly stages: ReadonlyArray<Stage>;
      readonly events: ReadonlyArray<Filed>;
      readonly where: Where;
      readonly trail: ReadonlyArray<Visit>;
    };

/** How long a stage has had: its time, or none for a stage that has had
 *  none. */
export const stageMs = (state: StageState): number =>
  state.kind === "done" || state.kind === "now" ? state.ms : 0;

/** THE STAGE OF THE AGENTS' TIME, by whether it is the planner's turn
 *  ({@link plannersTurn}): before an implementor, a plan you answered is
 *  the plan again on the planner's turn and the approval otherwise, and any
 *  other stretch is the plan; after an implementor joined, it is the review
 *  on the planner's turn and the build otherwise. */
const agentsStage = (
  turn: boolean,
  the: { readonly implemented: boolean; readonly answered: boolean },
): StageName => {
  if (the.implemented) return turn ? "review" : "build";
  return the.answered && !turn ? "approve" : "plan";
};

/** WHERE A STRETCH WOULD GO in a waterfall that has all six stages. The
 *  stage is WHO HOLDS THE WORK (`./readings.ts`'s `holdStep`), and every
 *  hand-off is an event kolu saw:
 *
 *  - a PR the forge merged is the merge, and CI running is the checks,
 *    whoever holds the work — the same fact the standing line reads as a
 *    wait on CI;
 *  - a green PR handed to the human is the merge;
 *  - a question to the human never moves the work: it stays in the stage it
 *    is in (`current`), which is then theirs — except before the implementor,
 *    where it is the approval once a planner has joined, and the planning
 *    (the setup's own questions) before that;
 *  - the agents' time is {@link agentsStage} of the planner's turn. Where
 *    who held the work was not recorded, it is every answer that is
 *    possible — the planner's turn only if a planner ever joined — and two
 *    different stages make the {@link Doubt} between them.
 *
 *  A draft decides no stage: it only cannot merge. */
const placeOf = (at: Running, who: Waiter, current: Filed): Filed => {
  if (prIs(at, "merged")) return "merge";
  if (who === "ci") return "checks";
  const implemented = joinedAs(at.holding, "implementor");
  if (who === "you") {
    if (at.openAsks.size === 0) return "merge";
    if (!implemented)
      return joinedAs(at.holding, "planner") ? "approve" : "plan";
    return current;
  }
  const the = {
    implemented,
    answered: current === "approve" || current === "plan-or-approve",
  };
  if (at.handOffs === "recorded")
    return agentsStage(plannersTurn(at.holding), the);
  const otherwise = agentsStage(false, the);
  if (!joinedAs(at.holding, "planner")) return otherwise;
  const ifPlanner = agentsStage(true, the);
  return ifPlanner === otherwise
    ? otherwise
    : doubtBetween(ifPlanner, otherwise);
};

/** ONE STRETCH OF THE WALK and where it was filed — or `done`, a stretch the
 *  work spent ended. Stretch `k` is the one the `k - 1`th event begins (the
 *  first, none). */
interface Placed {
  readonly who: Waiter | "done";
  readonly place: Filed;
  readonly length: number;
  readonly from: number;
}

/** EVERY STRETCH AND WHERE IT GOES, in order — a question keeps the stage
 *  the stretch before it was in, whether or not that was a visit — with the
 *  running state the walk ends in and the last place it filed. `file` says
 *  where a place is filed in the work's mode. */
const placeStretches = (
  work: Work,
  policy: Policy,
  now: string,
  file: (place: Filed) => Filed,
): {
  readonly placed: ReadonlyArray<Placed>;
  readonly last: Running;
  readonly current: Filed;
} => {
  const placed: Placed[] = [];
  let current: Filed = file("plan");
  const last = walk(work, now, (at, length, from) => {
    const who = waiterOf(policy.handOver, at);
    if (who !== "done") current = file(placeOf(at, who, current));
    placed.push({ who, place: current, length, from });
  });
  return { placed, last, current };
};

/** THE VISITS, read off the placed stretches — the trail, where each event
 *  is filed, and who each stage began with (what a stage entered for no time
 *  is coloured by).
 *
 *  ONE INSTANT IS ONE MOMENT. Events stamped at one instant (one reading of
 *  a pull request writes its check and the forge's merge answer together)
 *  leave stretches of no length between them, and those are no visit: the
 *  work did not stand there. The last one before the work ended is: a PR
 *  merged and the work ended at one instant still reached the merge.
 *
 *  Each event is filed where the stretch it begins is — one that begins no
 *  visit with the visit the next stretch is in, and one that leaves the work
 *  ended (or begins a stretch of it ended) where the work was last, in the
 *  visit the ending closed. An OPEN work's last visit is open and is where
 *  it is now (`where` is `in` it), whatever its timeline's last `ended`
 *  said; `eventCount` files that visit's events, none yet, at the end. */
const visitsOf = (
  placed: ReadonlyArray<Placed>,
  where: Where,
  eventCount: number,
): {
  readonly trail: ReadonlyArray<Visit>;
  readonly events: ReadonlyArray<Filed>;
  readonly began: ReadonlyMap<StageName, Waiter>;
} => {
  /** A visit while it is walked: open (`until` none) until the work moves on
   *  or ends. */
  interface Walking {
    readonly stage: Filed;
    readonly from: number;
    until: Option.Option<number>;
    readonly time: Record<Waiter, number>;
    readonly events: { readonly from: number; until: number };
  }
  /** Close a visit at `at`, unless it was closed already. */
  const close = (visit: Walking, at: number): void => {
    if (Option.isNone(visit.until)) visit.until = Option.some(at);
  };
  const began = new Map<StageName, Waiter>();
  const events: Filed[] = [];
  const trail: Walking[] = [];
  placed.forEach((stretch, index) => {
    const next = placed[index + 1];
    const who = stretch.who;
    if (
      who !== "done" &&
      stretch.length === 0 &&
      next !== undefined &&
      next.who !== "done"
    )
      return;
    const visit = trail.at(-1);
    if (who === "done") {
      // ENDED: nobody's time. The visit it ended in closes.
      if (visit !== undefined) close(visit, stretch.from);
    } else {
      const stage = stretch.place;
      if (isStage(stage) && !began.has(stage)) began.set(stage, who);
      if (visit?.stage === stage && Option.isNone(visit.until))
        visit.time[who] += stretch.length;
      else {
        if (visit !== undefined) close(visit, stretch.from);
        const time = { agent: 0, you: 0, ci: 0 };
        time[who] = stretch.length;
        trail.push({
          stage,
          from: stretch.from,
          until: Option.none(),
          time,
          events: { from: events.length, until: events.length },
        });
      }
    }
    // Every event up to the one that began this stretch is in the visit the
    // work is in now.
    const into = trail.at(-1);
    while (events.length < index) events.push(into?.stage ?? stretch.place);
    if (into !== undefined) into.events.until = index;
  });
  const end = placed.at(-1);
  const clock = end === undefined ? 0 : end.from + end.length;
  const final = trail.at(-1);
  const open = where.kind === "in";
  if (open && (final?.stage !== where.place || Option.isSome(final.until)))
    trail.push({
      stage: where.place,
      from: clock,
      until: Option.none(),
      time: { agent: 0, you: 0, ci: 0 },
      events: { from: eventCount, until: eventCount },
    });
  else if (final !== undefined && !open) close(final, clock);
  return {
    events,
    began,
    trail: trail.map(
      (visit): Visit => ({
        stage: visit.stage,
        from: new Date(visit.from).toISOString(),
        until: Option.map(visit.until, (until) =>
          new Date(until).toISOString(),
        ),
        time: visit.time,
        events: visit.events,
      }),
    ),
  };
};

/** THE SIX CELLS: the trail summed by stage. A stage the mode does not have
 *  did not happen; the one the work is in (`where` is `in` it) is `now`;
 *  one it was in is `done`; one with no visit of its own that a visited
 *  {@link Doubt} names is `unrecorded`; the rest were gone past or are not
 *  reached yet. Whose time a stage was is who it mostly was, else who it
 *  began with, else who the work waits on now (`nowWho`). */
const cellsOf = (
  trail: ReadonlyArray<Visit>,
  began: ReadonlyMap<StageName, Waiter>,
  the: {
    readonly declared: ReadonlySet<StageName>;
    readonly where: Where;
    readonly nowWho: Waiter;
  },
): ReadonlyArray<Stage> => {
  const held = new Map<StageName, Record<Waiter, number>>();
  for (const visit of trail) {
    if (!isStage(visit.stage)) continue;
    const into = held.get(visit.stage) ?? { agent: 0, you: 0, ci: 0 };
    into.agent += visit.time.agent;
    into.you += visit.time.you;
    into.ci += visit.time.ci;
    held.set(visit.stage, into);
  }
  const doubted = new Set(
    trail.flatMap((visit) => (isDoubt(visit.stage) ? canBe(visit.stage) : [])),
  );
  const place = the.where.place;
  const at =
    the.where.kind === "ended-in"
      ? STAGES.length
      : isStage(place)
        ? STAGES.indexOf(place)
        : -1;
  const final = trail.at(-1);
  const here = final === undefined ? 0 : visitMs(final);
  return STAGES.map((name, index): Stage => {
    const time = held.get(name);
    const ms = time === undefined ? 0 : time.agent + time.you + time.ci;
    const who = began.get(name);
    if (!the.declared.has(name)) return { name, state: { kind: "skipped" } };
    // WHOSE TIME IT HAS BEEN, for the stage in hand too: the same rule as a
    // finished stage. Who the work waits on right now is the standing line's
    // and the work's dot's fact, in that waiter's colour.
    if (index === at)
      return {
        name,
        state: {
          kind: "now",
          ms,
          here,
          who:
            time === undefined || who === undefined
              ? the.nowWho
              : mostly(time, who),
        },
      };
    if (time !== undefined && who !== undefined)
      return { name, state: { kind: "done", ms, who: mostly(time, who) } };
    if (time === undefined && doubted.has(name))
      return { name, state: { kind: "unrecorded" } };
    return {
      name,
      state: { kind: index < at ? "skipped" : "not-started" },
    };
  });
};

/** THE STAGES: the same walk as {@link timeSpent}, each stretch filed under
 *  the place it belongs to ({@link placeOf}) — and a stage the work's mode
 *  does not have is never written to: its time goes to the nearest stage
 *  before it that the mode has (a trivial work has no Review: its agents
 *  build), else to no stage at all (`setup`, {@link Filed}). A doubt stays
 *  a doubt in a mode that has both its stages; in any other it is filed
 *  where the mode files its `others` stage — a mode with no stage for the
 *  planner's turn has no planner's turn — so a trivial work's
 *  `build-or-review` is its Build. The stages', the setup's and the doubts'
 *  times add up to {@link lifetime}. Three steps: {@link placeStretches},
 *  {@link visitsOf}, {@link cellsOf}. */
export const stages = (work: Work, policy: Policy, now: string): Stages => {
  const run = policy.run;
  if (run.kind === "unset") return { kind: "unset" };
  if (run.stages.length === 0) return { kind: "none" };
  const declared = new Set<StageName>(run.stages);
  /** Where a stage is filed in THIS mode. */
  const fileStage = (stage: StageName): Filed =>
    declared.has(stage)
      ? stage
      : (STAGES.slice(0, STAGES.indexOf(stage))
          .filter((one) => declared.has(one))
          .at(-1) ?? "setup");
  /** Where a stretch is filed in THIS mode. */
  const file = (place: Filed): Filed => {
    if (place === "setup") return place;
    if (!isDoubt(place)) return fileStage(place);
    const { planners, others } = DOUBT_STAGES[place];
    return declared.has(planners) && declared.has(others)
      ? place
      : fileStage(others);
  };
  const {
    placed,
    last,
    current: walked,
  } = placeStretches(work, policy, now, file);
  // WHERE IT IS. An OPEN work is waiting on somebody whatever its
  // timeline's last `ended` event said, as {@link standing} reads it; a
  // finished one is where it ended. A work still in its setup, or in a
  // doubt, is in no one cell.
  const open = work.state.kind === "open";
  const waiter = waiterOf(policy.handOver, last);
  const nowWho: Waiter = waiter === "done" ? "agent" : waiter;
  const where: Where = open
    ? { kind: "in", place: file(placeOf(last, nowWho, walked)) }
    : { kind: "ended-in", place: walked };
  const { trail, events, began } = visitsOf(placed, where, work.events.length);
  return {
    kind: "staged",
    events,
    where,
    trail,
    stages: cellsOf(trail, began, { declared, where, nowWho }),
  };
};

/** THE DOUBTS A WORK VISITED, in {@link DOUBTS}' order, each with its time
 *  over every visit — the time a doubt's two stages took together, which is
 *  known exactly though the split is not. */
export const doubtsOf = (
  trail: ReadonlyArray<Visit>,
): ReadonlyArray<{ readonly doubt: Doubt; readonly ms: number }> =>
  DOUBTS.flatMap((doubt) => {
    const visits = trail.filter((visit) => visit.stage === doubt);
    return visits.length === 0
      ? []
      : [{ doubt, ms: visits.reduce((sum, one) => sum + visitMs(one), 0) }];
  });

/** A COUNT KOLU KNOWS EXACTLY, or only from below: a doubt may hide more. */
export type Count =
  | { readonly kind: "exactly"; readonly times: number }
  | { readonly kind: "at-least"; readonly times: number };

/** HOW MANY TIMES THE WORK WENT FROM ONE STAGE TO ANOTHER, counted off its
 *  trail: neighbouring visits that are exactly `from` then `to`. Only from
 *  below (`at-least`) when a move could hide in a doubt — another pair of
 *  neighbours whose places can be `from` and `to`, or one visit that can be
 *  both. */
export const movedTimes = (
  trail: ReadonlyArray<Visit>,
  from: StageName,
  to: StageName,
): Count => {
  let times = 0;
  let hidden = false;
  trail.forEach((visit, index) => {
    const here = canBe(visit.stage);
    if (here.includes(from) && here.includes(to)) hidden = true;
    const next = trail[index + 1];
    if (next === undefined) return;
    if (visit.stage === from && next.stage === to) times += 1;
    else if (here.includes(from) && canBe(next.stage).includes(to))
      hidden = true;
  });
  return { kind: hidden ? "at-least" : "exactly", times };
};

/** HOW MANY TIMES THE WORK WAS IN A STAGE: its visits — only from below
 *  when a doubt the work visited names it. */
export const visitedTimes = (
  trail: ReadonlyArray<Visit>,
  stage: StageName,
): Count => ({
  kind: trail.some(
    (visit) => isDoubt(visit.stage) && canBe(visit.stage).includes(stage),
  )
    ? "at-least"
    : "exactly",
  times: trail.filter((visit) => visit.stage === stage).length,
});

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
  let at = startOf(work);
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
