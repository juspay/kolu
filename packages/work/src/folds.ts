import { Option } from "effect";
import { isOpenDraft, type PrReading, prStep } from "./readings.ts";
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

type Part = "before-planner" | "before-implementor" | "build" | "after";

const beforeBuild = (part: Part): boolean =>
  part === "before-planner" || part === "before-implementor";

interface Running {
  readonly openAsks: ReadonlySet<string>;
  readonly pr: Option.Option<PrReading>;
  readonly ended: boolean;
  readonly part: Part;
}

const START: Running = {
  openAsks: new Set(),
  pr: Option.none(),
  ended: false,
  part: "before-planner",
};

const prIs = (
  pr: Option.Option<PrReading>,
  state: PrReading["state"],
): boolean => Option.exists(pr, (one) => one.state === state);

const asksOf = (
  open: ReadonlySet<string>,
  event: WorkEvent,
): ReadonlySet<string> => {
  switch (event.kind) {
    case "question":
      return new Set([...open, event.ask]);
    case "answered":
    case "question-dropped": {
      const left = new Set(open);
      left.delete(event.ask);
      return left;
    }
    default:
      return open;
  }
};

const partOf = (
  part: Part,
  event: WorkEvent,
  was: Option.Option<PrReading>,
  now: Option.Option<PrReading>,
): Part => {
  switch (event.kind) {
    case "joined":
      if (!beforeBuild(part)) return part;
      if (event.role === "planner") return "before-implementor";
      return event.role === "implementor" ? "build" : part;
    case "pr-opened":
      return beforeBuild(part)
        ? part
        : Option.exists(now, isOpenDraft)
          ? "build"
          : "after";
    case "draft-state":
      if (beforeBuild(part)) return part;
      if (Option.exists(now, isOpenDraft)) return "build";
      return Option.exists(was, isOpenDraft) ? "after" : part;
    case "reopened":
      return part === "after" && prIs(was, "open")
        ? "after"
        : beforeBuild(part)
          ? part
          : "build";
    default:
      return part;
  }
};

const step = (at: Running, event: WorkEvent): Running => {
  const pr = prStep(at.pr, event);
  return {
    openAsks: asksOf(at.openAsks, event),
    pr,
    ended:
      event.kind === "ended"
        ? true
        : event.kind === "reopened"
          ? false
          : at.ended,
    part: partOf(at.part, event, at.pr, pr),
  };
};

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
  return standingOf(work, who === "done" ? "agent" : who, at, policy, since);
};

interface Stretch {
  readonly who: Waiter;
  readonly ms: number;
}

const ms = (from: string, to: string): number =>
  Math.max(0, Date.parse(to) - Date.parse(from));

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

const placeOf = (at: Running, who: Waiter, current: Filed): Filed => {
  if (prIs(at.pr, "merged")) return "merge";
  if (who === "ci")
    return at.part === "build" && Option.exists(at.pr, isOpenDraft)
      ? "build"
      : "checks";
  if (who === "you") {
    if (at.openAsks.size === 0) return "merge";
    if (at.part === "before-planner") return "plan";
    if (at.part === "before-implementor") return "approve";
    return current;
  }
  switch (at.part) {
    case "before-planner":
    case "before-implementor":
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
  const file = (place: Filed): Filed =>
    place === "setup" || declared.has(place)
      ? place
      : (STAGES.slice(0, STAGES.indexOf(place))
          .filter((one) => declared.has(one))
          .at(-1) ?? "setup");
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
    if (visits > 0) events.push(current);
    visits += 1;
  });
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
