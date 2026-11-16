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
import { prOf, sameHead } from "./readings.ts";
import {
  type Asked,
  type CheckHead,
  endedAt,
  type Outcome,
  type Work,
  type WorkEvent,
  type WorkId,
} from "./schema.ts";

/** Who the work is waiting on. `agent` covers the Conductor and the agents it
 *  runs; `ci` is a PR's checks running; `you` is the human. */
export type Waiter = "agent" | "you" | "ci";

/** HOW A WORK IS RUN, as far as a fold needs it — a plain watch (nobody works
 *  FOR it, so it has no stages), a work whose mode nobody has answered yet,
 *  or a waterfall, with or without a planner before the implementor. */
export type Run =
  | { readonly kind: "watch" }
  | { readonly kind: "unset" }
  | { readonly kind: "waterfall"; readonly planner: boolean };

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

/** WHICH PART OF ITS LIFE A WORK IS IN — cut by the two moments the record
 *  already holds: the implementor joining, and the pull request opening.
 *  Moves forward, except that a work reopened with no PR open goes back to
 *  before it — a second attempt on the same branch builds again. */
type Part = "before" | "build" | "after";

/** The fold's running state, advanced one event at a time — the SAME step
 *  {@link waitingOn}, {@link standing}, {@link timeSpent} and {@link stages}
 *  use, so the strip and the sentence over it cannot disagree about when a
 *  wait began.
 *
 *  The two PR facts are kept apart, as the record keeps them: `checks` is
 *  what the checks that have reported say, `merge` is whether the forge
 *  would let the PR merge. Only both together make it green — and only when
 *  they are about the SAME commit: each keeps the head it was said about, and
 *  a fact about another head makes the other one unknown. */
interface Running {
  readonly openAsks: ReadonlySet<string>;
  readonly checks: "none" | "running" | "passed" | "failed";
  readonly merge: "unknown" | "can" | "cannot";
  /** The PR and commit `checks` and `merge` were last said about. */
  readonly checksAbout: Option.Option<About>;
  readonly mergeAbout: Option.Option<About>;
  readonly ended: boolean;
  readonly part: Part;
  /** A planner has joined — before that there is no plan to approve, so a
   *  wait on the human (the setup's questions) is still the planning. */
  readonly planned: boolean;
  /** An implementor has joined at some point — where a reopened work with
   *  no PR goes back to. */
  readonly implemented: boolean;
  /** A PR is open — what keeps a reopened work after its PR. */
  readonly prOpen: boolean;
  /** The forge merged the PR: the merge happened, however long it took. */
  readonly merged: boolean;
}

/** Which PR, at which commit, a fact was about. */
interface About {
  readonly pr: number;
  readonly head: CheckHead;
}

const sameAbout = (a: Option.Option<About>, b: About): boolean =>
  Option.exists(a, (one) => one.pr === b.pr && sameHead(one.head, b.head));

const START: Running = {
  openAsks: new Set(),
  checks: "none",
  merge: "unknown",
  checksAbout: Option.none(),
  mergeAbout: Option.none(),
  ended: false,
  part: "before",
  planned: false,
  implemented: false,
  prOpen: false,
  merged: false,
};

/** A check event's move: the checks it says, and the merge answer forgotten
 *  when it was about another commit. */
const checksSay = (
  at: Running,
  about: About,
  checks: Running["checks"],
): Running => ({
  ...at,
  part: "after",
  prOpen: true,
  checks,
  checksAbout: Option.some(about),
  merge: sameAbout(at.mergeAbout, about) ? at.merge : "unknown",
});

const step = (at: Running, event: WorkEvent): Running => {
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
    // A PR has opened: every event that names one moves the work past the
    // build, whichever of them the timeline heard first. A new PR starts with
    // nothing said about it.
    case "pr-opened":
      return {
        ...at,
        part: "after",
        prOpen: true,
        merged: false,
        checks: "none",
        merge: "unknown",
        checksAbout: Option.none(),
        mergeAbout: Option.none(),
      };
    case "checks-running":
      return checksSay(at, event, "running");
    case "checks-passed":
      return checksSay(at, event, "passed");
    case "checks-failed":
      return checksSay(at, event, "failed");
    // `unsettled` is GitHub not having worked out a new commit yet: no
    // answer, so the last commit's does not stand for this one.
    case "merge-state":
      return {
        ...at,
        part: "after",
        prOpen: true,
        merge: event.merge.kind === "unsettled" ? "unknown" : event.merge.kind,
        mergeAbout: Option.some(event),
        checks: sameAbout(at.checksAbout, event) ? at.checks : "none",
      };
    case "merged":
      return {
        ...at,
        part: "after",
        prOpen: false,
        merged: true,
        checks: "none",
        merge: "unknown",
      };
    case "pr-closed":
      return {
        ...at,
        part: "after",
        prOpen: false,
        checks: "none",
        merge: "unknown",
      };
    case "ended":
      return { ...at, ended: true };
    // THE ONE WAY BACK. Reopened with its PR still open, the work is where it
    // was; with none, it is a new attempt on the branch. Either way what was
    // said about the checks and the merge was true when it stopped, not now:
    // it waits for the next reading.
    case "reopened":
      return {
        ...at,
        ended: false,
        merged: false,
        checks: "none",
        merge: "unknown",
        checksAbout: Option.none(),
        mergeAbout: Option.none(),
        part: at.prOpen ? "after" : at.implemented ? "build" : "before",
      };
    default:
      return at;
  }
};

/** GREEN, and therefore the human's when they asked for the hand-over: the
 *  forge would merge it, and no check that has reported is running or red.
 *  A PR with no checks at all is green the moment the forge says so. */
const isGreen = (at: Running): boolean =>
  at.merge === "can" && (at.checks === "none" || at.checks === "passed");

const waiterOf = (handOver: boolean, at: Running): Waiter | "done" => {
  if (at.ended) return "done";
  if (at.openAsks.size > 0) return "you";
  if (at.checks === "running") return "ci";
  return handOver && isGreen(at) ? "you" : "agent";
};

/** Who the work is waiting on now, or `done` once it has ended. */
export const waitingOn = (work: Work, policy: Policy): Waiter | "done" =>
  work.state.kind === "ended"
    ? "done"
    : waiterOf(policy.handOver, work.events.reduce(step, START));

/** WHERE A WORK STANDS, in one reading — who it waits on, why, since when —
 *  as a SUM, each arm carrying only what is true of it. Every reader renders
 *  its own words: the card capitalises and adds a live check tally, the
 *  Conductor's `works` resource writes a sentence for an agent.
 *
 *  - `question` — the human has been asked something; `question` is its
 *    words;
 *  - `merge` — the PR is green (the forge would merge it, and no reported
 *    check is running or red) and the merge is theirs; `pr` is the PR
 *    number when the timeline knows one;
 *  - `ci` — the checks are running;
 *  - `watching` — kolu is keeping an eye on a terminal nobody works for;
 *  - `working` — the agents have it;
 *  - `done` — the work is finished, and `outcome` is how (which PR, or who
 *    stopped it). */
export type Standing =
  | {
      readonly why: "question";
      readonly question: string;
      readonly since: string;
    }
  | {
      readonly why: "merge";
      readonly pr: Option.Option<number>;
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
  open: ReadonlySet<string>,
  policy: Policy,
  since: string,
): Standing => {
  switch (who) {
    case "you":
      return Option.match(askedOf(work, open), {
        onSome: (question): Standing => ({
          why: "question",
          question: question.question,
          since,
        }),
        onNone: (): Standing => ({
          why: "merge",
          pr: Option.map(prOf(work), (pr) => pr.number),
          since,
        }),
      });
    case "ci":
      return { why: "ci", since };
    case "agent":
      return {
        why: policy.run.kind === "watch" ? "watching" : "working",
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
  return standingOf(
    work,
    who === "done" ? "agent" : who,
    at.openAsks,
    policy,
    since,
  );
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

/** WHOSE TIME EACH STAGE IS, when nothing says otherwise — the agents plan,
 *  build and review, the human approves and merges, CI checks. A stage that
 *  is happening NOW carries its own waiter ({@link StageState}): a build, or
 *  a review, stopped on a question is the human's. */
export const STAGE_WAITER: Readonly<Record<StageName, Waiter>> = {
  plan: "agent",
  approve: "you",
  build: "agent",
  review: "agent",
  checks: "ci",
  merge: "you",
};

/** WHERE A STAGE STANDS, as a sum — each arm carries only what is true of it:
 *
 *  - `done` — the work was in it (for `ms`, which may be none) and is not
 *    in it now;
 *  - `now` — the work is in it, for `ms` so far, waiting on `who`;
 *  - `not-started` — the work has not reached it;
 *  - `skipped` — it did not happen: the work went past it without ever
 *    being in it (a waterfall with no planner has no plan), or ended
 *    without reaching it. */
export type StageState =
  | { readonly kind: "done"; readonly ms: number }
  | { readonly kind: "now"; readonly ms: number; readonly who: Waiter }
  | { readonly kind: "not-started" }
  | { readonly kind: "skipped" };

/** One stage of a work, and where it stands. */
export interface Stage {
  readonly name: StageName;
  readonly state: StageState;
}

/** THE STAGES OF A WORK, as a sum: a plain watch is not a waterfall and has
 *  none; a work whose mode nobody has answered has none yet; a waterfall has
 *  all six, and files every event of its timeline under one of them
 *  (`events`, one per event, in the timeline's order) — the stage of the
 *  stretch that event begins, by the same walk that files the time, so an
 *  event and the time after it are never in two stages. */
export type Stages =
  | { readonly kind: "watch" }
  | { readonly kind: "unset" }
  | {
      readonly kind: "waterfall";
      readonly stages: ReadonlyArray<Stage>;
      readonly events: ReadonlyArray<StageName>;
    };

/** How long a stage has had: its time, or none for a stage that has had
 *  none. */
export const stageMs = (state: StageState): number =>
  state.kind === "done" || state.kind === "now" ? state.ms : 0;

/** The stages after the PR opens, which a question does not move a work out
 *  of. */
type AfterStage = Extract<StageName, "review" | "checks" | "merge">;

/** THE STAGES: the same walk as {@link timeSpent}, each stretch filed under
 *  the stage it belongs to.
 *
 *  Before the implementor joins, a waterfall with a planner is planning — the
 *  setup's questions included, which come before there is anything to approve
 *  — and, once the planner has joined, a wait on the human is the approval. A
 *  waterfall with no planner builds from the start. From the implementor
 *  joining until the PR opens it is all the build. After the PR opens, CI
 *  running is the checks, a green PR handed to the human (or one the forge
 *  merged) is the merge, and the rest is the review. A question to the human
 *  never moves the work: it stays in the stage it is in, which is then the
 *  human's. A stage the work was in for no time — two events stamped at one
 *  instant — still happened. The stages' times add up to {@link lifetime}.
 *
 *  Each event is filed under the stage of the stretch it begins; one that
 *  leaves the work ended (or begins a stretch of it ended) stays in the stage
 *  the work was last in. */
export const stages = (work: Work, policy: Policy, now: string): Stages => {
  const run = policy.run;
  if (run.kind !== "waterfall") return { kind: run.kind };
  const spent: Record<StageName, number> = {
    plan: 0,
    approve: 0,
    build: 0,
    review: 0,
    checks: 0,
    merge: 0,
  };
  const entered = new Set<StageName>();
  let after: AfterStage = "review";
  const place = (at: Running, who: Waiter): StageName => {
    switch (at.part) {
      case "before":
        if (!run.planner) return "build";
        return who === "you" && at.planned ? "approve" : "plan";
      case "build":
        return "build";
      case "after":
        if (at.merged) return "merge";
        if (at.openAsks.size > 0) return after;
        return who === "ci" ? "checks" : who === "you" ? "merge" : "review";
      default:
        return at.part satisfies never;
    }
  };
  const events: StageName[] = [];
  let current: StageName = run.planner ? "plan" : "build";
  let visits = 0;
  const last = walk(work, now, (at, length) => {
    const who = waiterOf(policy.handOver, at);
    if (who !== "done") {
      current = place(at, who);
      if (current === "review" || current === "checks" || current === "merge")
        after = current;
      spent[current] += length;
      entered.add(current);
    }
    // The first stretch is the one before any event; each after it is the
    // one the event before it began.
    if (visits > 0) events.push(current);
    visits += 1;
  });
  // WHERE IT IS NOW — none for a finished work. An OPEN work is waiting on
  // somebody whatever its timeline's last `ended` event said, as
  // {@link standing} reads it.
  const waiter = waiterOf(policy.handOver, last);
  const who: Waiter = waiter === "done" ? "agent" : waiter;
  const at =
    work.state.kind === "open"
      ? STAGES.indexOf(place(last, who))
      : STAGES.length;
  return {
    kind: "waterfall",
    events,
    stages: STAGES.map((name, index): Stage => {
      const ms = spent[name];
      if (index === at) return { name, state: { kind: "now", ms, who } };
      if (entered.has(name)) return { name, state: { kind: "done", ms } };
      return {
        name,
        state: { kind: index < at ? "skipped" : "not-started" },
      };
    }),
  };
};

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
