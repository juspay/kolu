/**
 * THE SIX STAGES AND THE TRAIL, checked against numbers computed without the
 * folds.
 *
 * Two kinds of generated record. The CHAOTIC ones throw every event the
 * timeline can hold at a work — questions, members joining and leaving,
 * hand-offs and stops, two pull requests, checks, the forge's merge answers,
 * merges, closes, stops, reopens, the upgrade's `hand-offs-kept`, events
 * stamped out of order — and check what must hold whatever happens: the
 * stages add up to the work's life, measured here from the events directly,
 * the trail's visits tile it, and the map names a current stage exactly while
 * the work is open. The SCRIPTED ones walk a waterfall through its stages
 * with random durations, and check each stage's time against the duration
 * that was put there. Seeded, so a failure names the seed that reproduces it.
 */

import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { seeded } from "../test/seeded.ts";
import {
  ABOUT_WORK,
  answerAsk,
  askQuestions,
  endWork,
  joinWork,
  leaveWork,
  lifetime,
  type MergeState,
  type PrDraft,
  type PrOpenedDraft,
  prOf,
  openAsks,
  openWork,
  type Policy,
  recordEvent,
  reopenWork,
  type Filed,
  canBe,
  DOUBTS,
  DOUBT_STAGES,
  doubtsOf,
  isDoubt,
  movedTimes,
  visitedTimes,
  type Stage,
  type StageName,
  stageMs,
  stages,
  standing,
  timeSpent,
  took,
  type Work,
  PR_FACTS_PER_COMMIT,
  MODE_RUNS,
} from "./index.ts";

const T0 = Date.UTC(2026, 10, 16, 9, 0, 0);
const MINUTE = 60_000;
const at = (minute: number): string =>
  new Date(T0 + minute * MINUTE).toISOString();

const opened = (): Work =>
  openWork({
    key: { kind: "branch", host: "local", repo: "/r", branch: "b" },
    title: "stages",
    at: at(0),
    request: { kind: "said", text: "waterfall it" },
  });

const ask = (work: Work, id: string, minute: number): Work =>
  askQuestions(work, {
    ask: id,
    questions: [
      {
        id: `${id}-q`,
        question: "Approve the plan?",
        topic: "work",
        header: { kind: "none" },
        options: ["Approve", "Change something"],
        multiple: false,
        file: { kind: "none" },
      },
    ],
    at: at(minute),
  });

const answer = (work: Work, id: string, minute: number): Work =>
  answerAsk(work, {
    ask: id,
    at: at(minute),
    from: "card",
    reply: { kind: "answered", values: new Map([[`${id}-q`, ["Approve"]]]) },
  });

const join = (
  work: Work,
  role: "planner" | "implementor",
  minute: number,
  terminal = `local/${role}`,
): Work => joinWork(work, { terminal, role, at: at(minute) });

const prOpened = (
  work: Work,
  minute: number,
  pr = 7,
  draft: PrOpenedDraft = "ready",
): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "kolu",
    kind: "pr-opened",
    about: ABOUT_WORK,
    pr,
    title: "the PR",
    url: { kind: "link", href: `https://forge.example/pr/${pr}` },
    draft,
  });

/** The PR marked ready for review, or turned back into a draft. */
const draftState = (work: Work, draft: PrDraft, minute: number, pr = 7): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "kolu",
    kind: "draft-state",
    about: ABOUT_WORK,
    pr,
    draft,
  });

const check = (
  work: Work,
  kind: "checks-running" | "checks-passed" | "checks-failed",
  minute: number,
  pr = 7,
  sha = "a1",
): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "ci",
    kind,
    about: ABOUT_WORK,
    pr,
    head: { kind: "commit", sha },
    failing: [],
  });

const mergeState = (
  work: Work,
  merge: MergeState,
  minute: number,
  pr = 7,
  sha = "a1",
): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "kolu",
    kind: "merge-state",
    about: ABOUT_WORK,
    pr,
    head: { kind: "commit", sha },
    merge,
  });

const merged = (work: Work, minute: number, pr = 7): Work =>
  endWork(
    recordEvent(work, {
      at: at(minute),
      by: "kolu",
      kind: "merged",
      about: ABOUT_WORK,
      pr,
    }),
    { outcome: { kind: "merged", pr }, at: at(minute) },
  );

/** The Conductor hands the work to a member (`agent_say`). */
const told = (work: Work, terminal: string, minute: number): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "agent",
    kind: "told",
    about: { kind: "member", terminal },
  });

/** A member's agent stops — or asks, exits, sleeps. */
const stop = (
  work: Work,
  terminal: string,
  minute: number,
  kind: "ready" | "stopped" | "asking" | "exited" | "asleep" = "stopped",
): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "agent",
    kind,
    about: { kind: "member", terminal },
    why: { kind: "none" },
  });

/** What the upgrade writes on a work saved before kolu kept hand-offs. */
const handOffsKept = (work: Work, minute: number): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "kolu",
    kind: "hand-offs-kept",
    about: ABOUT_WORK,
  });

const PLANNER = "local/planner";
const IMPLEMENTOR = "local/implementor";

/** The places of a work's trail, in order. */
const trailOf = (
  work: Work,
  policy: Policy,
  now: string,
): ReadonlyArray<Filed> =>
  waterfall(work, policy, now).trail.map((visit) => visit.stage);

/** A policy for a mode, read off its own row of `MODE_RUNS`, as `policyOf`
 *  reads it. */
const policyFor = (mode: "full" | "trivial", handOver = true): Policy => ({
  handOver,
  run: {
    kind: "set",
    driven: MODE_RUNS[mode].driven,
    stages: MODE_RUNS[mode].stages,
  },
});
const FULL = policyFor("full");
const TRIVIAL = policyFor("trivial");

/** The six cells of a waterfall's map, or a failure saying the policy gave
 *  none. */
const cellsAt = (work: Work, policy: Policy, now: string) =>
  waterfall(work, policy, now).stages;

const waterfall = (work: Work, policy: Policy, now: string) => {
  const read = stages(work, policy, now);
  if (read.kind !== "staged") throw new Error(`no stages: ${read.kind}`);
  return read;
};

/** THE MAP AS A PERSON READS IT: each cell's stage and what it shows —
 *  `now`, `done`, `?` for one nobody recorded, `–` for a stage that did not
 *  happen, `·` for one not reached. */
const cells = (work: Work, policy: Policy, now: string): string =>
  cellsAt(work, policy, now)
    .map((one) => {
      const word = {
        now: "now",
        done: "done",
        unrecorded: "?",
        skipped: "–",
        "not-started": "·",
      }[one.state.kind];
      return `${one.name} ${word}`;
    })
    .join(", ");

/** THE TIME AFTER EACH EVENT, put where that event was filed — measured from
 *  the events alone, as {@link lifeOf} measures the life, so it holds only if
 *  each event and the stretch it begins are filed in one place. */
const timeByEventStage = (
  work: Work,
  filed: ReadonlyArray<Filed>,
  now: string,
): Record<Filed, number> => {
  const sums: Record<Filed, number> = {
    setup: 0,
    "plan-or-approve": 0,
    "build-or-review": 0,
    plan: 0,
    approve: 0,
    build: 0,
    review: 0,
    checks: 0,
    merge: 0,
  };
  const start = Date.parse(work.startedAt);
  const end = Math.max(
    start,
    Date.parse(work.state.kind === "ended" ? work.state.at : now),
  );
  const clamped: number[] = [];
  let clock = start;
  for (const event of work.events) {
    clock = Math.min(Math.max(Date.parse(event.at), clock), end);
    clamped.push(clock);
  }
  let ended = false;
  work.events.forEach((event, index) => {
    if (event.kind === "ended") ended = true;
    if (event.kind === "reopened") ended = false;
    const from = clamped[index] ?? start;
    const until = clamped[index + 1] ?? end;
    const stage = filed[index];
    if (!ended && stage !== undefined) sums[stage] += until - from;
  });
  return sums;
};

const byName = (all: ReadonlyArray<Stage>) =>
  Object.fromEntries(all.map((one) => [one.name, one.state])) as Record<
    StageName,
    Stage["state"]
  >;

const total = (all: ReadonlyArray<Stage>): number =>
  all.reduce((sum, one) => sum + stageMs(one.state), 0);

/** HOW LONG THE WORK RAN, from its events alone: start to end (or now), each
 *  event held to the clock as it goes, less every stretch it spent ended. No
 *  fold of the package is called. */
const lifeOf = (work: Work, now: string): number => {
  const start = Date.parse(work.startedAt);
  const end = Math.max(
    start,
    Date.parse(work.state.kind === "ended" ? work.state.at : now),
  );
  let clock = start;
  let ended = false;
  let life = 0;
  for (const event of work.events) {
    const t = Math.min(Math.max(Date.parse(event.at), clock), end);
    if (!ended) life += t - clock;
    clock = t;
    if (event.kind === "ended") ended = true;
    if (event.kind === "reopened") ended = false;
  }
  if (!ended) life += end - clock;
  return life;
};

/** One chaotic record, built through the package's own transitions. */
const chaotic = (seed: number, steps: number): Work => {
  const pick = seeded(seed);
  let work = opened();
  let minute = 0;
  let asks = 0;
  let pr = 7;
  const members: string[] = [];
  for (let step = 0; step < steps; step += 1) {
    minute += Math.floor(pick() * 12);
    const when = pick() < 0.08 ? minute - 3 : minute;
    const roll = pick();
    const open = openAsks(work);
    const live = work.state.kind === "open";
    if (roll < 0.1) {
      asks += 1;
      work = ask(work, `a${asks}`, when);
    } else if (roll < 0.18 && open[0] !== undefined) {
      work = answer(work, open[0], when);
    } else if (roll < 0.26) {
      const terminal = `local/t${step}`;
      members.push(terminal);
      const roles = ["planner", "implementor", "other"] as const;
      work = joinWork(work, {
        terminal,
        role: roles[Math.floor(pick() * 2.2)] ?? "other",
        at: at(when),
      });
    } else if (roll < 0.3 && members.length > 0) {
      work = leaveWork(work, {
        terminal: members.shift() ?? "local/none",
        why: "closed",
        at: at(when),
      });
    } else if (roll < 0.36) {
      // A second PR is a new number: the first one was closed, or this is a
      // reading of a branch whose PR moved.
      if (pick() < 0.3) pr += 1;
      const words = ["draft", "ready", "unrecorded"] as const;
      work = prOpened(
        work,
        when,
        pr,
        words[Math.floor(pick() * words.length)] ?? "ready",
      );
    } else if (roll < 0.52) {
      const kinds = [
        "checks-running",
        "checks-passed",
        "checks-failed",
      ] as const;
      work = check(
        work,
        kinds[Math.floor(pick() * kinds.length)] ?? "checks-running",
        when,
        pr,
        pick() < 0.6 ? "a1" : `h${step}`,
      );
    } else if (roll < 0.56) {
      const answers: ReadonlyArray<MergeState> = [
        { kind: "can" },
        { kind: "cannot", why: "blocked" },
        { kind: "cannot", why: "behind" },
        { kind: "unsettled" },
      ];
      work = mergeState(
        work,
        answers[Math.floor(pick() * answers.length)] ?? { kind: "can" },
        when,
        pr,
        pick() < 0.6 ? "a1" : `h${step}`,
      );
    } else if (roll < 0.6) {
      // Marked ready, or turned back into a draft.
      work = draftState(work, pick() < 0.5 ? "draft" : "ready", when, pr);
    } else if (roll < 0.64 && live) {
      work = merged(work, when, pr);
    } else if (roll < 0.68 && live) {
      work = endWork(
        recordEvent(work, {
          at: at(when),
          by: "kolu",
          kind: "pr-closed",
          about: ABOUT_WORK,
          pr,
        }),
        { outcome: { kind: "closed", pr }, at: at(when) },
      );
    } else if (roll < 0.72 && live) {
      work = endWork(work, {
        outcome: { kind: "stopped", by: "you" },
        at: at(when),
      });
    } else if (roll < 0.8) {
      work = reopenWork(work, at(when));
    } else {
      // A HAND-OFF OR A STOP, about a member still in the work — or, with
      // none, a terminal that never joined it.
      const terminal =
        members[Math.floor(pick() * members.length)] ?? "local/t0";
      const hand = pick();
      if (hand < 0.35) work = told(work, terminal, when);
      else if (hand < 0.42) work = handOffsKept(work, when);
      else {
        const kinds = [
          "stopped",
          "ready",
          "asking",
          "exited",
          "asleep",
        ] as const;
        work = recordEvent(work, {
          at: at(when),
          by: "agent",
          kind: kinds[Math.floor(pick() * kinds.length)] ?? "stopped",
          about: { kind: "member", terminal },
          why: { kind: "none" },
        });
      }
    }
  }
  return work;
};

describe("on chaotic records", () => {
  it.each(
    Array.from({ length: 300 }, (_, one) => one + 1),
  )("the stages add up to the life measured from the events, record %i", (seed) => {
    const work = chaotic(seed, 34);
    const pick = seeded(seed * 7919);
    const policy = policyFor(pick() < 0.6 ? "full" : "trivial", pick() < 0.5);
    const now = at(34 * 12 + Math.floor(pick() * 60));
    const life = lifeOf(work, now);
    const all = cellsAt(work, policy, now);
    const spent = timeSpent(work, policy, now);
    const read = waterfall(work, policy, now);
    // EVERY EVENT IS FILED where the time after it went: one place per
    // event, and each stage holds exactly the time after its events (the
    // record opens with an event at its start, so there is no time before
    // the first). An open work's last event is where it is now.
    expect(read.events, `seed ${seed}: one per event`).toHaveLength(
      work.events.length,
    );
    const filed = timeByEventStage(work, read.events, now);
    for (const one of read.stages)
      expect(filed[one.name], `seed ${seed}: ${one.name}`).toBe(
        stageMs(one.state),
      );
    // ... so the stages, the setup and the unrecorded time add up to the
    // life, and the setup is only ever a mode's with no Plan to hold it.
    expect(lifetime(work, now), `seed ${seed}: lifetime`).toBe(life);
    // A DRAFT IS NEVER THE HUMAN'S TO MERGE, whatever the forge answered.
    if (Option.exists(prOf(work), (one) => one.draft === "draft"))
      expect(standing(work, policy).why, `seed ${seed}: draft`).not.toBe(
        "merge",
      );
    expect(
      total(all) +
        filed.setup +
        filed["plan-or-approve"] +
        filed["build-or-review"],
      `seed ${seed}: stages`,
    ).toBe(life);
    if (policy.run.kind === "set" && policy.run.stages.includes("plan"))
      expect(filed.setup, `seed ${seed}: setup`).toBe(0);
    expect(spent.agent + spent.you + spent.ci, `seed ${seed}: spent`).toBe(
      life,
    );
    // WHERE IT IS: `in` exactly while the work is open, and a cell is `now`
    // exactly when `where` is `in` that stage.
    expect(read.where.kind, `seed ${seed}: where`).toBe(
      work.state.kind === "open" ? "in" : "ended-in",
    );
    for (const one of all)
      expect(one.state.kind === "now", `seed ${seed}: ${one.name} now`).toBe(
        read.where.kind === "in" && read.where.place === one.name,
      );
    // ... and its time in hand is the open visit's.
    for (const one of all)
      if (one.state.kind === "now") {
        const open = read.trail.at(-1);
        expect(one.state.here, `seed ${seed}: here`).toBe(
          open === undefined
            ? 0
            : open.time.agent + open.time.you + open.time.ci,
        );
        expect(one.state.here).toBeLessThanOrEqual(one.state.ms);
      }
    // A DOUBT is only ever on a work whose hand-offs were not kept, never in
    // a trivial work, and a stage is `unrecorded` exactly when it had no
    // visit of its own and a visited doubt names it.
    const doubts = read.trail.filter((visit) => isDoubt(visit.stage));
    if (doubts.length > 0)
      expect(
        work.events.some((one) => one.kind === "hand-offs-kept"),
        `seed ${seed}: doubt without the marker`,
      ).toBe(true);
    if (policy.run.kind === "set" && !policy.run.stages.includes("review"))
      expect(doubts, `seed ${seed}: a trivial doubt`).toEqual([]);
    const doubted = new Set(doubts.flatMap((visit) => canBe(visit.stage)));
    for (const one of all)
      expect(
        one.state.kind === "unrecorded",
        `seed ${seed}: ${one.name} unrecorded`,
      ).toBe(
        doubted.has(one.name) &&
          !read.trail.some((visit) => visit.stage === one.name),
      );
    // What did not happen, or has not started, had no time — and a stage
    // the mode does not have never did.
    for (const one of all) {
      if (one.state.kind === "skipped" || one.state.kind === "not-started")
        expect(stageMs(one.state)).toBe(0);
      if (policy.run.kind === "set" && !policy.run.stages.includes(one.name))
        expect(one.state, `seed ${seed}: ${one.name}`).toEqual({
          kind: "skipped",
        });
    }
    // THE TRAIL TILES THE LIFE: the first visit begins with the work, a
    // visit's time is its length, each one after begins where the one before
    // it ended — or later, only on a work that was ended in between — and
    // their times add up to the life.
    const trail = read.trail;
    const length = (time: Record<"agent" | "you" | "ci", number>) =>
      time.agent + time.you + time.ci;
    const everEnded = work.events.some((one) => one.kind === "ended");
    expect(trail[0]?.from, `seed ${seed}: first visit`).toBe(work.startedAt);
    trail.forEach((visit, index) => {
      const until = Option.getOrElse(visit.until, () =>
        work.state.kind === "open" ? now : visit.from,
      );
      expect(length(visit.time), `seed ${seed}: visit ${index}`).toBe(
        Math.max(0, Date.parse(until) - Date.parse(visit.from)),
      );
      const next = trail[index + 1];
      if (next === undefined) return;
      const gap = Date.parse(next.from) - Date.parse(until);
      if (everEnded)
        expect(gap, `seed ${seed}: after ${index}`).toBeGreaterThanOrEqual(0);
      else expect(gap, `seed ${seed}: after ${index}`).toBe(0);
    });
    expect(
      trail.reduce((sum, visit) => sum + length(visit.time), 0),
      `seed ${seed}: trail`,
    ).toBe(life);
    // Each place holds the sum of its visits.
    for (const one of read.stages)
      expect(
        trail
          .filter((visit) => visit.stage === one.name)
          .reduce((sum, visit) => sum + length(visit.time), 0),
        `seed ${seed}: ${one.name}'s visits`,
      ).toBe(stageMs(one.state));
    for (const place of ["setup", ...DOUBTS] as const)
      expect(
        trail
          .filter((visit) => visit.stage === place)
          .reduce((sum, visit) => sum + length(visit.time), 0),
        `seed ${seed}: ${place}'s visits`,
      ).toBe(filed[place]);
    // ... and a doubt's time is what `doubtsOf` says it held.
    for (const { doubt, ms } of doubtsOf(trail))
      expect(ms, `seed ${seed}: ${doubt}'s time`).toBe(filed[doubt]);
    // EVERY EVENT IS IN EXACTLY ONE VISIT, the one it is filed in.
    expect(trail[0]?.events.from).toBe(0);
    expect(trail.at(-1)?.events.until).toBe(work.events.length);
    trail.forEach((visit, index) => {
      const next = trail[index + 1];
      if (next !== undefined)
        expect(next.events.from, `seed ${seed}: events of ${index}`).toBe(
          visit.events.until,
        );
      for (let one = visit.events.from; one < visit.events.until; one += 1)
        expect(read.events[one], `seed ${seed}: event ${one}`).toBe(
          visit.stage,
        );
    });
    // THE LAST VISIT IS OPEN EXACTLY WHEN THE WORK IS, and it is where the
    // work is now.
    expect(
      trail.map((visit) => Option.isNone(visit.until)),
      `seed ${seed}: which visit is open`,
    ).toEqual(
      trail.map(
        (_, index) => work.state.kind === "open" && index === trail.length - 1,
      ),
    );
    if (work.state.kind === "open")
      expect(trail.at(-1)?.stage, `seed ${seed}: now`).toBe(read.where.place);
  });
});

describe("a doubt in a mode", () => {
  /** One stretch of the agents' time that is the planner's turn, the
   *  other's, or not recorded — in a work up to `now`. */
  const stretch = (doubt: (typeof DOUBTS)[number]) => {
    const base =
      doubt === "build-or-review"
        ? join(stop(join(opened(), "planner", 0), PLANNER, 3), "implementor", 5)
        : answer(
            ask(stop(join(opened(), "planner", 0), PLANNER, 10), "a", 10),
            "a",
            15,
          );
    const from = doubt === "build-or-review" ? 10 : 16;
    return {
      planners: told(base, PLANNER, from),
      others:
        doubt === "build-or-review" ? told(base, IMPLEMENTOR, from) : base,
      unrecorded: handOffsKept(base, 30),
      now: at(30),
    };
  };

  it.each(
    Object.entries(MODE_RUNS).filter(([, row]) => row.stages.length > 0),
  )("stays a doubt, or files both its stages to one place, in the %s mode", (_, row) => {
    const policy: Policy = {
      handOver: true,
      run: { kind: "set", driven: row.driven, stages: row.stages },
    };
    for (const doubt of DOUBTS) {
      const { planners, others, unrecorded, now } = stretch(doubt);
      const place = (work: Work) => waterfall(work, policy, now).where.place;
      const both = [DOUBT_STAGES[doubt].planners, DOUBT_STAGES[doubt].others];
      if (both.every((one) => row.stages.includes(one)))
        expect(place(unrecorded), doubt).toBe(doubt);
      else {
        expect(place(planners), doubt).toBe(place(others));
        expect(place(unrecorded), doubt).toBe(place(others));
      }
    }
  });
});

describe("on scripted waterfalls", () => {
  it.each(
    Array.from({ length: 200 }, (_, one) => one + 1),
  )("each stage holds the time put in it, waterfall %i", (seed) => {
    const pick = seeded(seed);
    // At least a minute each: a stage that took no time between two events
    // of one instant is no visit (`stages`' "one instant is one moment").
    const span = (): number => 1 + Math.floor(pick() * 29);
    const planner = pick() < 0.6;
    const want: Record<StageName, number> = {
      plan: 0,
      approve: 0,
      build: 0,
      review: 0,
      checks: 0,
      merge: 0,
    };
    let minute = 0;
    let work = opened();
    if (planner) {
      work = join(work, "planner", 0);
      want.plan = span();
      minute += want.plan;
      // The planner writes the plan and stops; the Conductor asks you.
      work = stop(work, PLANNER, minute);
      work = ask(work, "approve", minute);
      want.approve = span();
      minute += want.approve;
      work = answer(work, "approve", minute);
    }
    work = join(work, "implementor", minute);
    want.build = span();
    minute += want.build;
    // The implementor opens its PR — a draft or not, which decides nothing —
    // stops, and the Conductor hands the work to the planner.
    const draft = pick() < 0.5;
    work = prOpened(work, minute, 7, draft ? "draft" : "ready");
    work = stop(work, IMPLEMENTOR, minute);
    work = told(work, PLANNER, minute);
    want.review = span();
    minute += want.review;
    // A question during the review keeps the work in the review.
    if (pick() < 0.5) {
      const asked = span();
      work = ask(work, "mid", minute);
      work = answer(work, "mid", minute + asked);
      want.review += asked;
      minute += asked;
    }
    work = stop(work, PLANNER, minute);
    work = check(work, "checks-running", minute);
    want.checks = span();
    minute += want.checks;
    work = check(work, "checks-passed", minute);
    if (draft) work = draftState(work, "ready", minute);
    work = mergeState(work, { kind: "can" }, minute);
    want.merge = span();
    minute += want.merge;
    work = merged(work, minute);
    const named = byName(cellsAt(work, planner ? FULL : TRIVIAL, at(minute)));
    // A TRIVIAL WORK HAS NOBODY TO REVIEW: its agents' time after the PR is
    // still the build, and its Plan, Approve and Review did not happen.
    if (!planner) {
      want.build += want.review;
      want.review = 0;
    }
    for (const name of Object.keys(want) as StageName[]) {
      if (
        !planner &&
        (name === "plan" || name === "approve" || name === "review")
      ) {
        expect(named[name], `seed ${seed}: ${name}`).toEqual({
          kind: "skipped",
        });
        continue;
      }
      // Every stage of this waterfall happened, however long it took.
      expect(named[name], `seed ${seed}: ${name}`).toMatchObject({
        kind: "done",
        ms: want[name] * MINUTE,
      });
    }
  });
});

describe("where a work's stages stand", () => {
  it("plans, then waits on you to approve", () => {
    let work = join(opened(), "planner", 0);
    work = ask(work, "approve", 22);
    const named = byName(cellsAt(work, FULL, at(34)));
    expect(named.plan).toEqual({ kind: "done", ms: 22 * MINUTE, who: "agent" });
    expect(named.approve).toEqual({
      kind: "now",
      ms: 12 * MINUTE,
      here: 12 * MINUTE,
      who: "you",
    });
    expect(named.build).toEqual({ kind: "not-started" });
  });

  it("is the human's while the build stops on a question", () => {
    let work = join(opened(), "implementor", 5);
    work = ask(work, "which", 20);
    // 15 minutes of the implementor's time against 5 of yours: the bar keeps
    // the agents' ink while it waits, because that is whose time it was.
    expect(byName(cellsAt(work, FULL, at(25))).build).toEqual({
      kind: "now",
      ms: 20 * MINUTE,
      here: 20 * MINUTE,
      who: "agent",
    });
  });

  it("colours the stage in hand by whose time it has mostly been", () => {
    let work = join(opened(), "implementor", 5);
    work = ask(work, "which", 23);
    // 18 minutes of the agents' time, then 2 waiting on you. Who it waits on
    // now is the standing line's fact; this bar says whose time it mostly was.
    expect(byName(cellsAt(work, FULL, at(25))).build).toEqual({
      kind: "now",
      ms: 20 * MINUTE,
      here: 20 * MINUTE,
      who: "agent",
    });
  });

  it("keeps a question during the review in the review, the human's", () => {
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 0);
    work = join(work, "implementor", 0);
    work = prOpened(work, 10);
    work = stop(work, IMPLEMENTOR, 10);
    work = told(work, PLANNER, 10);
    work = ask(work, "which", 14);
    const named = byName(cellsAt(work, FULL, at(20)));
    expect(named.review).toEqual({
      kind: "now",
      ms: 10 * MINUTE,
      here: 10 * MINUTE,
      who: "you",
    });
    expect(named.merge).toEqual({ kind: "not-started" });
  });

  it("has no plan, approval or review when no planner runs", () => {
    const work = join(opened(), "implementor", 3);
    expect(cells(work, TRIVIAL, at(10))).toBe(
      "plan –, approve –, build now, review –, checks ·, merge ·",
    );
  });

  it("files the setup's questions under the plan, before there is one to approve", () => {
    // The setup form is answered at 6; the planner joins then, and asks for
    // approval at 20.
    let work = ask(opened(), "setup", 0);
    work = answer(work, "setup", 6);
    work = join(work, "planner", 6);
    work = ask(work, "approve", 20);
    const read = waterfall(work, FULL, at(30));
    const named = byName(read.stages);
    // Mostly the planner's: 14 of its 20 minutes.
    expect(named.plan).toEqual({ kind: "done", ms: 20 * MINUTE, who: "agent" });
    expect(named.approve).toEqual({
      kind: "now",
      ms: 10 * MINUTE,
      here: 10 * MINUTE,
      who: "you",
    });
    // ... and the events say so: everything up to the approval's ask, the
    // setup's ask and answer included, is the plan's.
    expect(read.events).toEqual([
      ...Array.from({ length: work.events.length - 1 }, () => "plan"),
      "approve",
    ]);
  });

  it("draws the setup's wait as yours once it was most of the plan", () => {
    let work = ask(opened(), "setup", 0);
    work = answer(work, "setup", 12);
    work = join(work, "planner", 12);
    work = ask(work, "approve", 15);
    expect(byName(cellsAt(work, FULL, at(20))).plan).toEqual({
      kind: "done",
      ms: 15 * MINUTE,
      who: "you",
    });
  });

  it("names no stages for a mode that declares none, and none yet before the mode is chosen", () => {
    const work = join(opened(), "implementor", 3);
    expect(
      stages(
        work,
        {
          handOver: false,
          run: {
            kind: "set",
            driven: MODE_RUNS.watch.driven,
            stages: MODE_RUNS.watch.stages,
          },
        },
        at(9),
      ),
    ).toEqual({ kind: "none" });
    expect(
      stages(work, { handOver: false, run: { kind: "unset" } }, at(9)),
    ).toEqual({ kind: "unset" });
  });

  it("files what stood between events of one instant nowhere, and keeps a merge kolu made itself", () => {
    // The planner is handed the work and CI starts at one instant: the
    // review it was handed is no visit. The forge merged it, and the work
    // ended at that same instant, with nobody handed anything: it still
    // reached the merge.
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 10);
    work = join(work, "implementor", 10);
    work = prOpened(work, 40);
    work = stop(work, IMPLEMENTOR, 40);
    work = told(work, PLANNER, 40);
    work = check(work, "checks-running", 40);
    work = check(work, "checks-passed", 52);
    work = merged(work, 52);
    const read = waterfall(work, policyFor("full", false), at(90));
    const named = byName(read.stages);
    expect(named.review).toEqual({ kind: "skipped" });
    expect(named.checks).toMatchObject({ kind: "done", ms: 12 * MINUTE });
    expect(named.merge).toMatchObject({ kind: "done", ms: 0 });
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "plan",
      "build",
      "checks",
      "merge",
    ]);
  });

  it("is where its holder left it on a second attempt after the first PR was closed", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = endWork(
      recordEvent(work, {
        at: at(20),
        by: "kolu",
        kind: "pr-closed",
        about: ABOUT_WORK,
        pr: 7,
      }),
      { outcome: { kind: "closed", pr: 7 }, at: at(20) },
    );
    work = reopenWork(work, at(30));
    work = prOpened(work, 45, 8);
    // 20 before the close, 20 since the reopen; the ten it spent closed are
    // nobody's, and they split the build into two visits — no move.
    expect(byName(cellsAt(work, FULL, at(50))).build).toEqual({
      kind: "now",
      ms: 40 * MINUTE,
      here: 20 * MINUTE,
      who: "agent",
    });
    const read = waterfall(work, FULL, at(50));
    expect(read.trail.map((visit) => visit.stage)).toEqual(["build", "build"]);
    for (const to of ["plan", "approve", "review", "checks", "merge"] as const)
      expect(movedTimes(read.trail, "build", to)).toEqual({
        kind: "exactly",
        times: 0,
      });
  });
});

/** THE SHAPES OF REAL WORKS, each by name, as their cards must read. */
describe("the shapes of real works", () => {
  /** An instant `seconds` into the work. */
  const second = (seconds: number): string =>
    new Date(T0 + seconds * 1000).toISOString();

  it("a full waterfall that opens its own PR, is reviewed, runs CI and is merged", () => {
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 20);
    work = ask(work, "approve", 20);
    work = answer(work, "approve", 25);
    work = join(work, "implementor", 26);
    work = prOpened(work, 60);
    work = stop(work, IMPLEMENTOR, 60);
    work = told(work, PLANNER, 60);
    work = stop(work, PLANNER, 75);
    work = check(work, "checks-running", 80);
    work = check(work, "checks-passed", 95);
    work = mergeState(work, { kind: "can" }, 95);
    work = merged(work, 100);
    expect(cells(work, FULL, at(120))).toBe(
      "plan done, approve done, build done, review done, checks done, merge done",
    );
    // The minute between your answer and the implementor joining is still
    // the approval: the plan went nowhere.
    expect(trailOf(work, FULL, at(120))).toEqual([
      "plan",
      "approve",
      "build",
      "review",
      "checks",
      "merge",
    ]);
  });

  it("a trivial work that takes up a PR that already existed (the dependabot card)", () => {
    // The human's record, second by second: the PR was there before the
    // implementor, so it ends no build, and nobody reviews a trivial work.
    let work = openWork({
      key: { kind: "branch", host: "local", repo: "/r", branch: "dependabot" },
      title: "land the dependabot PR",
      at: second(0),
      request: { kind: "said", text: "land it" },
    });
    work = recordEvent(work, {
      at: second(1),
      by: "kolu",
      kind: "pr-opened",
      about: ABOUT_WORK,
      pr: 2391,
      title: "bump",
      url: { kind: "link", href: "https://forge.example/pr/2391" },
      draft: "ready",
    });
    work = recordEvent(work, {
      at: second(1),
      by: "ci",
      kind: "checks-failed",
      about: ABOUT_WORK,
      pr: 2391,
      head: { kind: "commit", sha: "d1" },
      failing: ["lint"],
    });
    work = joinWork(work, {
      terminal: "local/implementor",
      role: "implementor",
      at: second(6),
    });
    work = recordEvent(work, {
      at: second(16),
      by: "agent",
      kind: "ready",
      about: { kind: "member", terminal: "local/implementor" },
      why: { kind: "none" },
    });
    expect(cells(work, TRIVIAL, second(43))).toBe(
      "plan –, approve –, build now, review –, checks ·, merge ·",
    );
  });

  it("a work stopped while its setup form was still open", () => {
    const work = endWork(ask(opened(), "setup", 0), {
      outcome: { kind: "stopped", by: "you" },
      at: at(4),
    });
    expect(cells(work, FULL, at(10))).toBe(
      "plan done, approve –, build –, review –, checks –, merge –",
    );
    expect(byName(cellsAt(work, FULL, at(10))).plan).toEqual({
      kind: "done",
      ms: 4 * MINUTE,
      who: "you",
    });
  });

  it("a trivial work's setup form, which no stage holds", () => {
    // A trivial work has no Plan, and answering its setup is not building:
    // the five minutes are yours (time spent) but in no cell.
    const asking = ask(opened(), "setup", 0);
    expect(cells(asking, TRIVIAL, at(5))).toBe(
      "plan –, approve –, build ·, review –, checks ·, merge ·",
    );
    expect(waterfall(asking, TRIVIAL, at(5)).where.place).toBe("setup");
    let work = answer(asking, "setup", 5);
    work = join(work, "implementor", 5);
    const named = byName(cellsAt(work, TRIVIAL, at(20)));
    expect(named.build).toEqual({
      kind: "now",
      ms: 15 * MINUTE,
      here: 15 * MINUTE,
      who: "agent",
    });
    expect(timeSpent(work, TRIVIAL, at(20)).you).toBe(5 * MINUTE);
  });

  it("a work stopped after the plan, before any implementor", () => {
    let work = join(opened(), "planner", 0);
    work = ask(work, "approve", 30);
    work = answer(work, "approve", 35);
    work = endWork(work, {
      outcome: { kind: "stopped", by: "you" },
      at: at(40),
    });
    expect(cells(work, FULL, at(50))).toBe(
      "plan done, approve done, build –, review –, checks –, merge –",
    );
  });

  it("a full waterfall whose PR existed before the implementor joined", () => {
    let work = prOpened(opened(), 0);
    work = join(work, "planner", 0);
    work = ask(work, "approve", 20);
    work = answer(work, "approve", 25);
    work = join(work, "implementor", 25);
    work = check(work, "checks-running", 70);
    work = check(work, "checks-passed", 85);
    work = mergeState(work, { kind: "can" }, 85);
    const named = byName(cellsAt(work, FULL, at(90)));
    // All the implementor's time is the build, before and after a push.
    expect(named.build).toMatchObject({ kind: "done", ms: 45 * MINUTE });
    expect(cells(work, FULL, at(90))).toBe(
      "plan done, approve done, build done, review –, checks done, merge now",
    );
  });

  it("Page chats open in a pane (olai#702): a draft opened early, built in steps", () => {
    // A full work. The implementor opened a draft after the first of six
    // steps, about two hours in, and pushed after each step; CI ran on every
    // push. Never marked ready, never handed to the planner: each CI run is
    // a visit to the checks and back to the build, and there is no review.
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 20);
    work = ask(work, "approve", 20);
    work = answer(work, "approve", 25);
    work = join(work, "implementor", 25);
    work = prOpened(work, 145, 7, "draft");
    for (let push = 0; push < 6; push += 1) {
      const start = 145 + push * 60;
      work = check(work, "checks-running", start, 7, `p${push}`);
      work = check(work, "checks-passed", start + 15, 7, `p${push}`);
    }
    const now = at(145 + 6 * 60);
    const read = waterfall(work, FULL, now);
    const named = byName(read.stages);
    expect(named.build).toEqual({
      kind: "now",
      ms: Date.parse(now) - Date.parse(at(25)) - 6 * 15 * MINUTE,
      here: 45 * MINUTE,
      who: "agent",
    });
    expect(named.checks).toEqual({
      kind: "done",
      ms: 6 * 15 * MINUTE,
      who: "ci",
    });
    expect(named.review).toEqual({ kind: "not-started" });
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "plan",
      "approve",
      "build",
      ...Array.from({ length: 6 }, () => ["checks", "build"]).flat(),
    ]);
    expect(timeSpent(work, FULL, now).ci).toBe(6 * 15 * MINUTE);
  });

  it("One ACP runner for kolu and olai (#2405): green as a draft for a day, merged at ready", () => {
    // The issue's public times: the implementor starts, opens a draft eleven
    // minutes later, four green readings follow while it is a draft, and it
    // is marked ready a day later and merged four seconds after that.
    const minute = (iso: string): number => (Date.parse(iso) - T0) / MINUTE;
    const started = "2026-11-18T00:56:41.000Z";
    const ready = "2026-11-19T02:15:49.000Z";
    let work = openWork({
      key: { kind: "branch", host: "local", repo: "/r", branch: "acp-runner" },
      title: "One ACP runner for kolu and olai",
      at: started,
      request: { kind: "said", text: "waterfall it" },
    });
    work = join(work, "implementor", minute(started));
    work = prOpened(work, minute("2026-11-18T01:07:41.000Z"), 2405, "draft");
    for (const [index, green] of [
      "2026-11-18T03:43:00.000Z",
      "2026-11-18T05:24:00.000Z",
      "2026-11-18T09:11:00.000Z",
      "2026-11-18T11:07:00.000Z",
    ].entries()) {
      work = check(
        work,
        "checks-running",
        minute(green) - 20,
        2405,
        `h${index}`,
      );
      work = check(work, "checks-passed", minute(green), 2405, `h${index}`);
    }
    // Mid-draft, with the hand-over: the build, and not the human's — a
    // draft is never theirs to merge, however green.
    const midDraft = "2026-11-18T12:00:00.000Z";
    expect(waterfall(work, FULL, midDraft).where.place).toBe("build");
    expect(standing(work, FULL).why).toBe("working");
    work = draftState(work, "ready", minute(ready), 2405);
    work = mergeState(work, { kind: "can" }, minute(ready), 2405, "h3");
    work = merged(work, minute("2026-11-19T02:15:53.000Z"), 2405);
    const read = waterfall(work, FULL, "2026-11-19T03:00:00.000Z");
    const named = byName(read.stages);
    expect(named.build).toEqual({
      kind: "done",
      ms: Date.parse(ready) - Date.parse(started) - 4 * 20 * MINUTE,
      who: "agent",
    });
    expect(stageMs(named.checks)).toBe(4 * 20 * MINUTE);
    expect(named.review).toEqual({ kind: "skipped" });
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "build",
      ...Array.from({ length: 4 }, () => ["checks", "build"]).flat(),
      "merge",
    ]);
  });
});

describe("the stage follows who holds the work", () => {
  it("the reported work: six review rounds and two CI runs, on a draft throughout", () => {
    // Planned, approved, built; the planner reviews it six times, the
    // implementor answering each round; a final pass, a CI run with a red
    // lane, a fix, and CI running again. The PR is never marked ready.
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 30);
    work = ask(work, "approve", 30);
    work = answer(work, "approve", 32);
    work = join(work, "implementor", 33);
    work = prOpened(work, 50, 7, "draft");
    let minute = 92;
    work = stop(work, IMPLEMENTOR, minute);
    for (let round = 0; round < 6; round += 1) {
      work = told(work, PLANNER, minute);
      work = stop(work, PLANNER, minute + 8);
      work = told(work, IMPLEMENTOR, minute + 8);
      minute += 20;
      work = stop(work, IMPLEMENTOR, minute);
    }
    work = told(work, IMPLEMENTOR, minute);
    work = check(work, "checks-running", minute + 10, 7, "f1");
    work = check(work, "checks-failed", minute + 22, 7, "f1");
    work = check(work, "checks-running", minute + 37, 7, "f2");
    const now = at(minute + 45);
    const read = waterfall(work, FULL, now);
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "plan",
      "approve",
      "build",
      ...Array.from({ length: 6 }, () => ["review", "build"]).flat(),
      "checks",
      "build",
      "checks",
    ]);
    expect(read.where.place).toBe("checks");
    expect(byName(read.stages).checks).toEqual({
      kind: "now",
      ms: 20 * MINUTE,
      here: 8 * MINUTE,
      who: "ci",
    });
    expect(Option.getOrThrow(prOf(work)).draft).toBe("draft");
    // ... and the map's loops are counted off the trail, exactly.
    const moved = (from: StageName, to: StageName) =>
      movedTimes(read.trail, from, to);
    expect(moved("plan", "approve")).toEqual({ kind: "exactly", times: 1 });
    expect(moved("approve", "plan")).toEqual({ kind: "exactly", times: 0 });
    expect(moved("approve", "build")).toEqual({ kind: "exactly", times: 1 });
    expect(moved("build", "review")).toEqual({ kind: "exactly", times: 6 });
    expect(moved("review", "build")).toEqual({ kind: "exactly", times: 6 });
    expect(moved("build", "checks")).toEqual({ kind: "exactly", times: 2 });
    expect(moved("checks", "build")).toEqual({ kind: "exactly", times: 1 });
    expect(visitedTimes(read.trail, "review")).toEqual({
      kind: "exactly",
      times: 6,
    });
  });

  it("is the build again when the planner answers a doubt mid-build and stops", () => {
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 10);
    work = join(work, "implementor", 10);
    // The implementor is still at work when the Conductor asks the planner.
    work = told(work, PLANNER, 20);
    expect(waterfall(work, FULL, at(22)).where.place).toBe("review");
    work = stop(work, PLANNER, 25);
    const read = waterfall(work, FULL, at(40));
    expect(read.where.place).toBe("build");
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "plan",
      "build",
      "review",
      "build",
    ]);
  });

  it("moves nothing on a second word to the member that holds it, or a word to an `other`", () => {
    let work = join(opened(), "implementor", 0);
    work = joinWork(work, {
      terminal: "local/watched",
      role: "other",
      at: at(1),
    });
    const before = waterfall(work, FULL, at(30));
    work = told(work, IMPLEMENTOR, 10);
    work = told(work, "local/watched", 12);
    const after = waterfall(work, FULL, at(30));
    expect(after.stages).toEqual(before.stages);
    expect(after.trail.map((visit) => visit.stage)).toEqual(
      before.trail.map((visit) => visit.stage),
    );
  });

  it("is the plan when the planner is told again after you asked for changes", () => {
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 20);
    work = ask(work, "approve", 20);
    work = answer(work, "approve", 25);
    work = told(work, PLANNER, 26);
    const read = waterfall(work, FULL, at(40));
    expect(read.where.place).toBe("plan");
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "plan",
      "approve",
      "plan",
    ]);
  });

  it("files a trivial work's CI as checks and a red check back with the implementor as the build", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10, 7, "draft");
    work = check(work, "checks-running", 15);
    expect(cells(work, TRIVIAL, at(25))).toBe(
      "plan –, approve –, build done, review –, checks now, merge ·",
    );
    work = check(work, "checks-failed", 25);
    // No planner to hand it to: a word to one moves nothing.
    work = told(work, PLANNER, 26);
    const read = waterfall(work, TRIVIAL, at(40));
    expect(read.where.place).toBe("build");
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "build",
      "checks",
      "build",
    ]);
  });

  it("says who held a saved work was not recorded, up to the first hand-off after the upgrade", () => {
    // Saved before kolu kept hand-offs: the planner, your approval, the
    // implementor, a PR and a CI run — and no `told` anywhere.
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 20);
    work = ask(work, "approve", 20);
    work = answer(work, "approve", 25);
    work = join(work, "implementor", 25);
    work = prOpened(work, 60);
    work = check(work, "checks-running", 70);
    work = check(work, "checks-failed", 80);
    // The upgrade, and later the first hand-off since.
    work = handOffsKept(work, 90);
    work = stop(work, IMPLEMENTOR, 95);
    work = told(work, PLANNER, 100);
    const read = waterfall(work, FULL, at(110));
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "plan",
      "approve",
      "build-or-review",
      "checks",
      "build-or-review",
      "review",
    ]);
    const named = byName(read.stages);
    // Plan, Approve and Checks do not depend on who held it, and read as
    // they are; the build never got a minute of its own, and says it may
    // have had the doubt's rather than that it did not happen.
    expect(named.plan).toMatchObject({ kind: "done", ms: 20 * MINUTE });
    expect(named.approve).toMatchObject({ kind: "done", ms: 5 * MINUTE });
    expect(named.checks).toMatchObject({ kind: "done", ms: 10 * MINUTE });
    expect(named.build).toEqual({ kind: "unrecorded" });
    expect(named.review).toEqual({
      kind: "now",
      ms: 10 * MINUTE,
      here: 10 * MINUTE,
      who: "agent",
    });
    // The two stages' time together is known exactly.
    expect(doubtsOf(read.trail)).toEqual([
      { doubt: "build-or-review", ms: 65 * MINUTE },
    ]);
  });

  it("files a finished saved work's build and review as one doubt with its time, and keeps its merge", () => {
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 5);
    work = join(work, "implementor", 5);
    work = prOpened(work, 30);
    work = check(work, "checks-running", 40);
    work = check(work, "checks-passed", 50);
    work = mergeState(work, { kind: "can" }, 50);
    work = merged(work, 60);
    work = handOffsKept(work, 60);
    const read = waterfall(work, FULL, at(90));
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "plan",
      "build-or-review",
      "checks",
      "merge",
    ]);
    const named = byName(read.stages);
    // Finished: its build and review were one or the other, never "did not
    // happen" — and how long the two took together is the doubt's.
    expect(named.build).toEqual({ kind: "unrecorded" });
    expect(named.review).toEqual({ kind: "unrecorded" });
    expect(doubtsOf(read.trail)).toEqual([
      { doubt: "build-or-review", ms: 35 * MINUTE },
    ]);
    expect(read.where).toEqual({ kind: "ended-in", place: "merge" });
  });

  it("ends a doubt at the first recorded hand-off, and leaves the doubt's time as it was", () => {
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 5);
    work = join(work, "implementor", 5);
    work = handOffsKept(work, 30);
    // In the doubt: no stage is in hand, and both it may be are unrecorded.
    const before = waterfall(work, FULL, at(32));
    expect(before.where).toEqual({ kind: "in", place: "build-or-review" });
    expect(cells(work, FULL, at(32))).toBe(
      "plan done, approve ·, build ?, review ?, checks ·, merge ·",
    );
    work = stop(work, IMPLEMENTOR, 35);
    work = told(work, IMPLEMENTOR, 40);
    const read = waterfall(work, FULL, at(50));
    const named = byName(read.stages);
    expect(named.build).toEqual({
      kind: "now",
      ms: 10 * MINUTE,
      here: 10 * MINUTE,
      who: "agent",
    });
    expect(named.review).toEqual({ kind: "unrecorded" });
    expect(doubtsOf(read.trail)).toEqual([
      { doubt: "build-or-review", ms: 35 * MINUTE },
    ]);
  });

  it("files a full saved work whose planner never joined as the build, with no doubt", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 30);
    work = check(work, "checks-running", 40);
    work = check(work, "checks-passed", 50);
    work = mergeState(work, { kind: "can" }, 50);
    work = merged(work, 60);
    work = handOffsKept(work, 60);
    const read = waterfall(work, FULL, at(90));
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "build",
      "checks",
      "merge",
    ]);
    const named = byName(read.stages);
    expect(named.build).toEqual({
      kind: "done",
      ms: 40 * MINUTE,
      who: "agent",
    });
    expect(named.review).toEqual({ kind: "skipped" });
    expect(doubtsOf(read.trail)).toEqual([]);
  });

  it("gives the pictured trivial work its build and its three CI runs, upgraded or not", () => {
    // Merged; no planner; CI ran three times, red twice — and the upgrade's
    // marker at its end.
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = check(work, "checks-running", 20, 7, "f1");
    work = check(work, "checks-failed", 30, 7, "f1");
    work = check(work, "checks-running", 40, 7, "f2");
    work = check(work, "checks-failed", 50, 7, "f2");
    work = check(work, "checks-running", 60, 7, "f3");
    work = check(work, "checks-passed", 70, 7, "f3");
    work = mergeState(work, { kind: "can" }, 70, 7, "f3");
    work = merged(work, 80);
    const upgraded = handOffsKept(work, 80);
    const read = waterfall(upgraded, TRIVIAL, at(90));
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "build",
      "checks",
      "build",
      "checks",
      "build",
      "checks",
      "merge",
    ]);
    const named = byName(read.stages);
    expect(named.build).toEqual({
      kind: "done",
      ms: 40 * MINUTE,
      who: "agent",
    });
    expect(named.checks).toEqual({ kind: "done", ms: 30 * MINUTE, who: "ci" });
    expect(movedTimes(read.trail, "build", "checks")).toEqual({
      kind: "exactly",
      times: 3,
    });
    expect(movedTimes(read.trail, "checks", "build")).toEqual({
      kind: "exactly",
      times: 2,
    });
    expect(read.trail.some((visit) => isDoubt(visit.stage))).toBe(false);
    // ... the same as the record without the marker.
    const plain = waterfall(work, TRIVIAL, at(90));
    expect(read.trail.map((visit) => visit.stage)).toEqual(
      plain.trail.map((visit) => visit.stage),
    );
    expect(read.stages).toEqual(plain.stages);
  });

  it("believes nothing about who held a saved work before the upgrade", () => {
    // The planner's stop was folded away before kolu kept hand-offs, so its
    // record still reads as if it held the work.
    let work = join(opened(), "planner", 0);
    work = ask(work, "approve", 20);
    work = answer(work, "approve", 25);
    work = join(work, "implementor", 25);
    work = handOffsKept(work, 60);
    // The Conductor hands the work to the implementor, which stops: nobody
    // handed it to the planner, so it is the build, not the review.
    work = told(work, IMPLEMENTOR, 70);
    work = stop(work, IMPLEMENTOR, 90);
    expect(waterfall(work, FULL, at(95)).where.place).toBe("build");
    // ... and the next word to the planner hands it over.
    work = told(work, PLANNER, 95);
    const read = waterfall(work, FULL, at(100));
    expect(read.where.place).toBe("review");
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "plan",
      "approve",
      "build-or-review",
      "build",
      "review",
    ]);
  });

  it("says a saved work's sent-back plan was the plan or the approval, rather than filing it as the approval", () => {
    // Plan 20m, your answer 5m, the planner changing it 20m (no hand-off
    // kept), your second answer 5m, and the implementor a minute later.
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 20);
    work = ask(work, "a1", 20);
    work = answer(work, "a1", 25);
    work = ask(work, "a2", 45);
    work = answer(work, "a2", 50);
    work = join(work, "implementor", 51);
    work = handOffsKept(work, 60);
    const read = waterfall(work, FULL, at(70));
    expect(
      read.trail.map(
        (visit) =>
          `${visit.stage} ${(visit.time.agent + visit.time.you + visit.time.ci) / MINUTE}m`,
      ),
    ).toEqual([
      "plan 20m",
      "approve 5m",
      "plan-or-approve 20m",
      "approve 5m",
      // The minute between your answer and the implementor joining was the
      // planner's again, or the approval's: its own doubt.
      "plan-or-approve 1m",
      "build-or-review 19m",
    ]);
    // No round counted that nobody can say was asked for, and none hidden
    // inside Approve either.
    expect(byName(read.stages).approve).toMatchObject({
      kind: "done",
      ms: 10 * MINUTE,
    });
    expect(movedTimes(read.trail, "approve", "plan")).toEqual({
      kind: "at-least",
      times: 0,
    });
  });

  it("does not call the build of a saved work that never had one unrecorded", () => {
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 20);
    work = ask(work, "approve", 20);
    work = answer(work, "approve", 25);
    work = endWork(work, {
      outcome: { kind: "stopped", by: "you" },
      at: at(30),
    });
    work = handOffsKept(work, 30);
    const read = waterfall(work, FULL, at(40));
    expect(read.trail.map((visit) => visit.stage)).toEqual([
      "plan",
      "approve",
      "plan-or-approve",
    ]);
    const named = byName(read.stages);
    expect(named.build).toEqual({ kind: "skipped" });
    expect(named.review).toEqual({ kind: "skipped" });
  });

  it("counts across a doubt only from below", () => {
    // A full saved work: two CI runs, red both times.
    let work = join(opened(), "planner", 0);
    work = stop(work, PLANNER, 3);
    work = join(work, "implementor", 5);
    work = prOpened(work, 10);
    work = check(work, "checks-running", 20, 7, "a1");
    work = check(work, "checks-failed", 30, 7, "a1");
    work = check(work, "checks-running", 40, 7, "f2");
    work = check(work, "checks-failed", 50, 7, "f2");
    work = handOffsKept(work, 55);
    const saved = waterfall(work, FULL, at(55)).trail;
    expect(movedTimes(saved, "build", "checks")).toEqual({
      kind: "at-least",
      times: 0,
    });
    expect(visitedTimes(saved, "checks")).toEqual({
      kind: "exactly",
      times: 2,
    });
    expect(visitedTimes(saved, "build")).toEqual({
      kind: "at-least",
      times: 0,
    });
    // Then two recorded rounds: the implementor is handed it, and the
    // planner and the implementor take turns twice.
    work = stop(work, IMPLEMENTOR, 56);
    work = told(work, IMPLEMENTOR, 58);
    for (const minute of [60, 70]) {
      work = stop(work, IMPLEMENTOR, minute);
      work = told(work, PLANNER, minute);
      work = stop(work, PLANNER, minute + 5);
      work = told(work, IMPLEMENTOR, minute + 5);
    }
    const later = waterfall(work, FULL, at(80)).trail;
    expect(movedTimes(later, "build", "review")).toEqual({
      kind: "at-least",
      times: 2,
    });
  });

  it("keeps the build when the implementor's terminal comes back as an `other`", () => {
    let work = join(opened(), "implementor", 0);
    work = leaveWork(work, {
      terminal: IMPLEMENTOR,
      why: "released",
      at: at(10),
    });
    work = joinWork(work, {
      terminal: IMPLEMENTOR,
      role: "other",
      at: at(12),
    });
    const read = waterfall(work, FULL, at(20));
    expect(read.where.place).toBe("build");
    expect(read.trail.map((visit) => visit.stage)).toEqual(["build"]);
  });
});

describe("green is the forge saying it can merge", () => {
  const blocked = (): Work => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    // Quick checks pass; the required ones have not started.
    work = check(work, "checks-passed", 12);
    return mergeState(work, { kind: "cannot", why: "blocked" }, 12);
  };

  it("leaves a PR the forge will not merge with the implementor, in the build", () => {
    const named = byName(cellsAt(blocked(), FULL, at(30)));
    expect(named.build).toEqual({
      kind: "now",
      ms: 30 * MINUTE,
      here: 30 * MINUTE,
      who: "agent",
    });
    expect(named.checks).toEqual({ kind: "not-started" });
  });

  it("hands it over once the forge says it can merge, and takes it back when it cannot", () => {
    let work = mergeState(blocked(), { kind: "can" }, 30);
    expect(byName(cellsAt(work, FULL, at(40))).merge).toEqual({
      kind: "now",
      ms: 10 * MINUTE,
      here: 10 * MINUTE,
      who: "you",
    });
    // The base moved on: the stale green is gone.
    work = mergeState(work, { kind: "cannot", why: "behind" }, 40);
    expect(byName(cellsAt(work, FULL, at(45))).build.kind).toBe("now");
  });

  it("is green with no checks at all", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = mergeState(work, { kind: "can" }, 10);
    expect(byName(cellsAt(work, FULL, at(15))).merge.kind).toBe("now");
  });

  it("does not let one commit's answer stand for a push", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = check(work, "checks-passed", 12);
    work = mergeState(work, { kind: "can" }, 12);
    expect(byName(cellsAt(work, FULL, at(14))).merge.kind).toBe("now");
    // A push GitHub has not worked out yet: not green, back to the build.
    work = mergeState(work, { kind: "unsettled" }, 20, 7, "b2");
    expect(byName(cellsAt(work, FULL, at(22))).build.kind).toBe("now");
    // ... and checks about the new commit take the old answer away too.
    let checked = mergeState(blocked(), { kind: "can" }, 14);
    checked = check(checked, "checks-passed", 20, 7, "b2");
    expect(byName(cellsAt(checked, FULL, at(22))).build.kind).toBe("now");
  });

  it("forgets the checks and the answer when a work stopped green is reopened", () => {
    let work = mergeState(blocked(), { kind: "can" }, 14);
    work = endWork(work, {
      outcome: { kind: "stopped", by: "you" },
      at: at(16),
    });
    work = reopenWork(work, at(60));
    // Fourteen minutes of building before it went green, then ten since the
    // reopen — not a merge waiting on you off an answer from before it
    // stopped.
    const named = byName(cellsAt(work, FULL, at(70)));
    expect(named.build).toEqual({
      kind: "now",
      ms: 24 * MINUTE,
      here: 10 * MINUTE,
      who: "agent",
    });
  });

  it("keeps one answer per check run, and every answer outside one", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = check(work, "checks-running", 11);
    // GitHub flips while the required checks land: one row stands for them.
    for (let flip = 0; flip < 20; flip += 1)
      work = mergeState(
        work,
        flip % 2 === 0 ? { kind: "can" } : { kind: "cannot", why: "blocked" },
        12 + flip,
      );
    const answers = () =>
      work.events.filter((one) => one.kind === "merge-state").length;
    expect(answers()).toBe(1);
    // The run ends; what GitHub says after it is each its own row.
    work = check(work, "checks-passed", 40);
    work = mergeState(work, { kind: "can" }, 41);
    work = mergeState(work, { kind: "cannot", why: "behind" }, 50);
    expect(answers()).toBe(3);
  });

  it("keeps at most a bounded number of check results for one commit, never losing the newest", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    // Two suites out of phase: the word flips on every poll.
    for (let poll = 0; poll < 40; poll += 1)
      work = check(
        work,
        poll % 2 === 0 ? "checks-running" : "checks-passed",
        11 + poll,
      );
    const kept = work.events.filter(
      (one) => one.kind === "checks-running" || one.kind === "checks-passed",
    );
    expect(kept).toHaveLength(PR_FACTS_PER_COMMIT);
    // The first says when the checks began; the newest is the word it reads.
    expect(kept.at(0)?.at).toBe(at(11));
    expect(kept.at(-1)?.at).toBe(at(50));
    expect(kept.at(-1)?.kind).toBe("checks-passed");
    expect(byName(cellsAt(work, FULL, at(60))).checks.kind).not.toBe("now");
  });

  it("keeps a hand-over's time when a ninth check result arrives", () => {
    // Eight flips ending green, GitHub says it can merge, and the PR waits on
    // you for half an hour — then a re-run reports. The green the wait was
    // filed under must still be on the record.
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    for (let poll = 0; poll < PR_FACTS_PER_COMMIT; poll += 1)
      work = check(
        work,
        poll % 2 === 0 ? "checks-running" : "checks-passed",
        11 + poll,
      );
    work = mergeState(work, { kind: "can" }, 20);
    work = check(work, "checks-running", 50);
    const cells = byName(cellsAt(work, FULL, at(55)));
    expect(cells.merge).toEqual({ kind: "done", ms: 30 * 60_000, who: "you" });
    expect(cells.checks.kind).toBe("now");
    expect(
      work.events.filter((one) => one.kind === "checks-passed").at(-1)?.at,
    ).toBe(at(18));
  });

  it("keeps at most a bounded number of merge answers for one commit, never losing the newest", () => {
    // The base moves for days: GitHub works it out again, then can again.
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = check(work, "checks-passed", 11);
    for (let move = 0; move < 30; move += 1)
      work = mergeState(
        work,
        move % 2 === 0 ? { kind: "can" } : { kind: "unsettled" },
        12 + move,
      );
    const answers = work.events.filter((one) => one.kind === "merge-state");
    expect(answers).toHaveLength(PR_FACTS_PER_COMMIT);
    expect(answers.at(0)?.at).toBe(at(12));
    expect(answers.at(-1)?.at).toBe(at(41));
  });
});

describe("a draft cannot merge", () => {
  /** The merge answer the timeline reads for the work's PR. */
  const readMerge = (work: Work) => Option.getOrThrow(prOf(work)).merge;

  it("reads cannot: draft even after a stray merge answer that says it can", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10, 7, "draft");
    expect(readMerge(work)).toEqual({ kind: "cannot", why: "draft" });
    work = check(work, "checks-passed", 12);
    work = mergeState(work, { kind: "can" }, 12);
    expect(readMerge(work)).toEqual({ kind: "cannot", why: "draft" });
    expect(byName(cellsAt(work, FULL, at(20))).merge.kind).not.toBe("now");
  });

  it("forgets the merge answer on entering a draft and on leaving one", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = mergeState(work, { kind: "can" }, 12);
    expect(readMerge(work)).toEqual({ kind: "can" });
    work = draftState(work, "draft", 14);
    expect(readMerge(work)).toEqual({ kind: "cannot", why: "draft" });
    // Ready again: the `can` from before is not the answer for it now.
    work = draftState(work, "ready", 16);
    expect(readMerge(work)).toEqual({ kind: "unknown" });
  });

  it("keeps the answer when an unrecorded PR learns it was ready all along", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10, 7, "unrecorded");
    work = mergeState(work, { kind: "can" }, 12);
    work = draftState(work, "ready", 14);
    expect(readMerge(work)).toEqual({ kind: "can" });
  });

  it("keeps the draft word through a reopen", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10, 7, "draft");
    work = endWork(work, {
      outcome: { kind: "stopped", by: "you" },
      at: at(12),
    });
    work = reopenWork(work, at(20));
    expect(Option.getOrThrow(prOf(work)).draft).toBe("draft");
    expect(readMerge(work)).toEqual({ kind: "cannot", why: "draft" });
  });

  it("never lets a merge answer after a draft flip replace the one before it", () => {
    // Checks running on one commit: GitHub's flips there keep only their
    // latest — but a draft flip between two answers is somebody's act, so
    // both answers stay on the timeline.
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = check(work, "checks-running", 11);
    work = mergeState(work, { kind: "cannot", why: "blocked" }, 12);
    work = draftState(work, "draft", 13);
    work = draftState(work, "ready", 14);
    work = mergeState(work, { kind: "can" }, 15);
    expect(
      work.events
        .filter((one) => one.kind === "merge-state")
        .map((one) => one.at),
    ).toEqual([at(12), at(15)]);
  });
});

describe("the work's life", () => {
  it("leaves out the time a work spent ended before it was reopened", () => {
    let work = endWork(opened(), {
      outcome: { kind: "stopped", by: "you" },
      at: at(5),
    });
    work = reopenWork(work, at(8));
    // 5 minutes, then 3 closed, then 2 more.
    expect(lifetime(work, at(10))).toBe(7 * MINUTE);
    expect(took(work, at(10)).reduce((sum, one) => sum + one.ms, 0)).toBe(
      7 * MINUTE,
    );
  });
});
