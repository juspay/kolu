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
import { prOf } from "./readings.ts";
import {
  type Asked,
  endedAt,
  type Outcome,
  type Work,
  type WorkEvent,
  type WorkId,
} from "./schema.ts";

/** Who the work is waiting on. `agent` covers the Conductor and the agents it
 *  runs; `ci` is a PR's checks running; `you` is the human. */
export type Waiter = "agent" | "you" | "ci";

/** WHAT THE WATERFALL'S WORDS MEAN HERE — the whole of what a fold needs to
 *  know about how this work is run, read once by `./waterfall.ts`'s
 *  `policyOf`.
 *
 *  - `handOver` — the human said to hand the PR over when CI goes green, so a
 *    green check is a wait on THEM rather than the end of the agents' stretch;
 *  - `watching` — this work is a plain watch: nobody is working FOR it, kolu
 *    is keeping an eye on a terminal the human pointed at;
 *  - `planned` — a planner runs before the implementor (or nobody has said
 *    yet that none will), so the time before the implementor joins is the
 *    plan and its approval rather than part of the build. */
export interface Policy {
  readonly handOver: boolean;
  readonly watching: boolean;
  readonly planned: boolean;
}

/** WHICH PART OF ITS LIFE A WORK IS IN — cut by the two moments the record
 *  already holds: the implementor joining, and the pull request opening.
 *  Only ever moves forward. */
type Part = "before" | "build" | "after";

/** The fold's running state, advanced one event at a time — the SAME step
 *  {@link waitingOn}, {@link standing}, {@link timeBar} and {@link stages}
 *  use, so the bar, the strip and the sentence over them cannot disagree
 *  about when a wait began. */
interface Running {
  readonly openAsks: ReadonlySet<string>;
  readonly ci: boolean;
  /** Checks passed on an open PR, and the human said to hand it over: the
   *  merge is theirs. */
  readonly greenForYou: boolean;
  readonly ended: boolean;
  readonly part: Part;
}

const START: Running = {
  openAsks: new Set(),
  ci: false,
  greenForYou: false,
  ended: false,
  part: "before",
};

const step = (handOver: boolean, at: Running, event: WorkEvent): Running => {
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
      return event.role === "implementor" && at.part === "before"
        ? { ...at, part: "build" }
        : at;
    // The PR has opened: every event that names one moves the work past the
    // build, whichever of them the timeline heard first.
    case "pr-opened":
      return { ...at, part: "after" };
    case "checks-running":
      return { ...at, part: "after", ci: true, greenForYou: false };
    case "checks-passed":
      return { ...at, part: "after", ci: false, greenForYou: handOver };
    case "checks-failed":
      return { ...at, part: "after", ci: false, greenForYou: false };
    case "merged":
    case "pr-closed":
      return { ...at, part: "after", ci: false, greenForYou: false };
    case "ended":
      return { ...at, ended: true };
    case "reopened":
      return { ...at, ended: false };
    default:
      return at;
  }
};

const waiterOf = (at: Running): Waiter | "done" =>
  at.ended
    ? "done"
    : at.openAsks.size > 0 || at.greenForYou
      ? "you"
      : at.ci
        ? "ci"
        : "agent";

/** Who the work is waiting on now, or `done` once it has ended. */
export const waitingOn = (work: Work, policy: Policy): Waiter | "done" =>
  work.state.kind === "ended"
    ? "done"
    : waiterOf(
        work.events.reduce(
          (at, event) => step(policy.handOver, at, event),
          START,
        ),
      );

/** WHERE A WORK STANDS, in one reading — who it waits on, why, since when —
 *  as a SUM, each arm carrying only what is true of it. Every reader renders
 *  its own words: the card capitalises and adds a live check tally, the
 *  Conductor's `works` resource writes a sentence for an agent.
 *
 *  - `question` — the human has been asked something; `question` is its
 *    words;
 *  - `merge` — the checks are green and the merge is theirs; `pr` is the PR
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
      return { why: policy.watching ? "watching" : "working", since };
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
  let who = waiterOf(at);
  let since = work.startedAt;
  for (const event of work.events) {
    at = step(policy.handOver, at, event);
    const next = waiterOf(at);
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

/** One stretch of the time bar. */
export interface Stretch {
  readonly who: Waiter;
  readonly ms: number;
}

const ms = (from: string, to: string): number =>
  Math.max(0, Date.parse(to) - Date.parse(from));

/** THE WALK every time fold takes: the work's life, from its start to its end
 *  (or `now`), visited one stretch at a time with the running state that
 *  stretch was spent in. An event stamped before the one ahead of it, or
 *  after the end, is held to the walk's own clock, so the stretches always
 *  tile the life exactly — what lets the bar and the strip add up to it. */
const walk = (
  work: Work,
  handOver: boolean,
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
    at = step(handOver, at, event);
  }
  visit(at, end - from);
  return at;
};

/** THE TIME BAR: the work's life cut into stretches by who it was waiting
 *  on. Adjacent stretches of the same waiter are one stretch; a zero-length
 *  one is not drawn, and neither is time a reopened work spent ended. */
export const timeBar = (
  work: Work,
  policy: Policy,
  now: string,
): ReadonlyArray<Stretch> => {
  const bar: Stretch[] = [];
  walk(work, policy.handOver, now, (at, length) => {
    const who = waiterOf(at);
    if (who === "done" || length === 0) return;
    const last = bar.at(-1);
    if (last?.who === who) bar[bar.length - 1] = { who, ms: last.ms + length };
    else bar.push({ who, ms: length });
  });
  return bar;
};

/** WHERE THE TIME WENT: the bar, summed per waiter. */
export const timeSpent = (
  work: Work,
  policy: Policy,
  now: string,
): Readonly<Record<Waiter, number>> => {
  const spent: Record<Waiter, number> = { agent: 0, you: 0, ci: 0 };
  for (const stretch of timeBar(work, policy, now))
    spent[stretch.who] += stretch.ms;
  return spent;
};

/** How long the work has run: from its start to its end, or to `now` — less
 *  any time it spent ended before it was reopened, which nobody worked. The
 *  same walk as the bar, so the two are one length. Whether a green check is
 *  a hand-over moves time between waiters and never in or out of the life,
 *  so it is not asked. */
export const lifetime = (work: Work, now: string): number => {
  let total = 0;
  walk(work, false, now, (at, length) => {
    if (!at.ended) total += length;
  });
  return total;
};

/** THE SIX STAGES of a piece of work, always in this order. */
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
 *  build and review, the human approves and merges, CI checks. The one
 *  exception is a stage that is happening NOW, which carries its own waiter
 *  ({@link StageState}): a build stopped on a question is the human's. */
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
 *  - `done` — time was spent in it, and the work is not in it now;
 *  - `now` — the work is in it, for `ms` so far, waiting on `who`;
 *  - `not-started` — a stage after the current one that has had no time;
 *  - `skipped` — a stage that did not happen: one before the current one
 *    that had no time (a work with no planner has no plan), or any stage of
 *    a finished work that had none. */
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

/** How long a stage has had: its time, or none for a stage that has had
 *  none. */
export const stageMs = (state: StageState): number =>
  state.kind === "done" || state.kind === "now" ? state.ms : 0;

/** Which stage a stretch of time belongs to: the part of the work's life it
 *  falls in, and who it was waiting on. */
const stageOf = (part: Part, who: Waiter, planned: boolean): StageName => {
  switch (part) {
    case "before":
      if (!planned) return "build";
      return who === "you" ? "approve" : "plan";
    case "build":
      return "build";
    case "after":
      return who === "agent" ? "review" : who === "ci" ? "checks" : "merge";
    default:
      return part satisfies never;
  }
};

/** THE STAGES: the same walk as {@link timeBar}, each stretch filed under the
 *  stage it belongs to. Before the implementor joins, the agents' time is the
 *  plan and the human's the approval; from then until the PR opens it is all
 *  the build; after that the agents' time is review, CI's the checks and the
 *  human's the merge. A work with no planner builds from the start. The
 *  stages' times add up to {@link lifetime}. */
export const stages = (
  work: Work,
  policy: Policy,
  now: string,
): ReadonlyArray<Stage> => {
  const spent: Record<StageName, number> = {
    plan: 0,
    approve: 0,
    build: 0,
    review: 0,
    checks: 0,
    merge: 0,
  };
  const last = walk(work, policy.handOver, now, (at, length) => {
    const who = waiterOf(at);
    if (who === "done") return;
    spent[stageOf(at.part, who, policy.planned)] += length;
  });
  // WHERE IT IS NOW — none for a finished work. An OPEN work is waiting on
  // somebody whatever its timeline's last `ended` event said, as
  // {@link standing} reads it.
  const waiter = waiterOf(last);
  const who: Waiter = waiter === "done" ? "agent" : waiter;
  const current: Option.Option<StageName> =
    work.state.kind === "open"
      ? Option.some(stageOf(last.part, who, policy.planned))
      : Option.none();
  const at = Option.match(current, {
    onNone: () => STAGES.length,
    onSome: (name) => STAGES.indexOf(name),
  });
  return STAGES.map((name, index): Stage => {
    const ms = spent[name];
    if (index === at) return { name, state: { kind: "now", ms, who } };
    if (ms > 0) return { name, state: { kind: "done", ms } };
    return { name, state: { kind: index < at ? "skipped" : "not-started" } };
  });
};

/** HOW LONG EACH STEP TOOK — the timeline's right-hand column: from an event
 *  to the next one; the last event of a work in progress is still running
 *  (`open`). */
export const took = (
  work: Work,
  now: string,
): ReadonlyArray<{ readonly ms: number; readonly open: boolean }> =>
  work.events.map((event, index) => {
    const next = work.events[index + 1];
    if (next !== undefined) return { ms: ms(event.at, next.at), open: false };
    return work.state.kind === "open"
      ? { ms: ms(event.at, now), open: true }
      : { ms: 0, open: false };
  });

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
