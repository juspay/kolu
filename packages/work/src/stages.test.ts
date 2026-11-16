/**
 * THE SIX STAGES, checked against numbers computed without the folds.
 *
 * Two kinds of generated record. The CHAOTIC ones throw every event the
 * timeline can hold at a work — questions, members joining and leaving, two
 * pull requests, checks, the forge's merge answers, merges, closes, stops,
 * reopens, events stamped out of order — and check what must hold whatever
 * happens: the stages add up to the work's life, measured here from the
 * events directly, and the strip names a current stage exactly while the work
 * is open. The SCRIPTED ones walk a waterfall through its stages with random
 * durations, and check each stage's time against the duration that was put
 * there. Seeded, so a failure names the seed that reproduces it.
 */

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
  openAsks,
  openWork,
  type Policy,
  recordEvent,
  reopenWork,
  type Stage,
  type StageName,
  stageMs,
  stages,
  timeSpent,
  took,
  type Work,
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

const prOpened = (work: Work, minute: number, pr = 7): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "kolu",
    kind: "pr-opened",
    about: ABOUT_WORK,
    pr,
    title: "the PR",
    url: { kind: "link", href: `https://forge.example/pr/${pr}` },
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
): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "kolu",
    kind: "merge-state",
    about: ABOUT_WORK,
    pr,
    head: { kind: "commit", sha: "a1" },
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

const FULL: Policy = {
  handOver: true,
  run: { kind: "waterfall", planner: true },
};
const TRIVIAL: Policy = {
  handOver: true,
  run: { kind: "waterfall", planner: false },
};

/** The six stages of a waterfall, or a failure saying the policy gave none. */
const strip = (work: Work, policy: Policy, now: string) => {
  const read = stages(work, policy, now);
  if (read.kind !== "waterfall") throw new Error(`no stages: ${read.kind}`);
  return read.stages;
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
      work = join(
        work,
        pick() < 0.5 ? "planner" : "implementor",
        when,
        terminal,
      );
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
      work = prOpened(work, when, pr);
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
        `h${step}`,
      );
    } else if (roll < 0.6) {
      const answers: ReadonlyArray<MergeState> = [
        { kind: "can" },
        { kind: "cannot", why: "blocked" },
        { kind: "cannot", why: "behind" },
      ];
      work = mergeState(
        work,
        answers[Math.floor(pick() * answers.length)] ?? { kind: "can" },
        when,
        pr,
      );
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
      work = recordEvent(work, {
        at: at(when),
        by: "agent",
        kind: "stopped",
        about: { kind: "member", terminal: "local/t0" },
        why: { kind: "none" },
      });
    }
  }
  return work;
};

describe("on chaotic records", () => {
  it.each(Array.from({ length: 300 }, (_, one) => one + 1))(
    "the stages add up to the life measured from the events, record %i",
    (seed) => {
      const work = chaotic(seed, 34);
      const pick = seeded(seed * 7919);
      const policy: Policy = {
        handOver: pick() < 0.5,
        run: { kind: "waterfall", planner: pick() < 0.6 },
      };
      const now = at(34 * 12 + Math.floor(pick() * 60));
      const life = lifeOf(work, now);
      const all = strip(work, policy, now);
      const spent = timeSpent(work, policy, now);
      expect(lifetime(work, now), `seed ${seed}: lifetime`).toBe(life);
      expect(total(all), `seed ${seed}: stages`).toBe(life);
      expect(spent.agent + spent.you + spent.ci, `seed ${seed}: spent`).toBe(
        life,
      );
      expect(all.filter((one) => one.state.kind === "now").length).toBe(
        work.state.kind === "open" ? 1 : 0,
      );
      // What did not happen, or has not started, had no time.
      for (const one of all)
        if (one.state.kind === "skipped" || one.state.kind === "not-started")
          expect(stageMs(one.state)).toBe(0);
      if (policy.run.kind === "waterfall" && !policy.run.planner) {
        const named = byName(all);
        expect(named.plan.kind === "done" || named.plan.kind === "now").toBe(
          false,
        );
        expect(
          named.approve.kind === "done" || named.approve.kind === "now",
        ).toBe(false);
      }
    },
  );
});

describe("on scripted waterfalls", () => {
  it.each(Array.from({ length: 200 }, (_, one) => one + 1))(
    "each stage holds the time put in it, waterfall %i",
    (seed) => {
      const pick = seeded(seed);
      const span = (): number => Math.floor(pick() * 30);
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
        work = ask(work, "approve", minute);
        want.approve = span();
        minute += want.approve;
        work = answer(work, "approve", minute);
      }
      work = join(work, "implementor", minute);
      want.build = span();
      minute += want.build;
      work = prOpened(work, minute);
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
      work = check(work, "checks-running", minute);
      want.checks = span();
      minute += want.checks;
      work = check(work, "checks-passed", minute);
      work = mergeState(work, { kind: "can" }, minute);
      want.merge = span();
      minute += want.merge;
      work = merged(work, minute);
      const named = byName(strip(work, planner ? FULL : TRIVIAL, at(minute)));
      for (const name of Object.keys(want) as StageName[]) {
        if (!planner && (name === "plan" || name === "approve")) {
          expect(named[name], `seed ${seed}: ${name}`).toEqual({
            kind: "skipped",
          });
          continue;
        }
        // Every stage of this waterfall happened, however long it took.
        expect(named[name], `seed ${seed}: ${name}`).toEqual({
          kind: "done",
          ms: want[name] * MINUTE,
        });
      }
    },
  );
});

describe("where a work's stages stand", () => {
  it("plans, then waits on you to approve", () => {
    let work = join(opened(), "planner", 0);
    work = ask(work, "approve", 22);
    const named = byName(strip(work, FULL, at(34)));
    expect(named.plan).toEqual({ kind: "done", ms: 22 * MINUTE });
    expect(named.approve).toEqual({ kind: "now", ms: 12 * MINUTE, who: "you" });
    expect(named.build).toEqual({ kind: "not-started" });
  });

  it("is the human's while the build stops on a question", () => {
    let work = join(opened(), "implementor", 5);
    work = ask(work, "which", 20);
    expect(byName(strip(work, FULL, at(25))).build).toEqual({
      kind: "now",
      ms: 20 * MINUTE,
      who: "you",
    });
  });

  it("keeps a question after the PR opens in the review, the human's", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = ask(work, "which", 14);
    const named = byName(strip(work, FULL, at(20)));
    expect(named.review).toEqual({ kind: "now", ms: 10 * MINUTE, who: "you" });
    expect(named.merge).toEqual({ kind: "not-started" });
  });

  it("has no plan and no approval when no planner runs", () => {
    const work = join(opened(), "implementor", 3);
    const read = strip(work, TRIVIAL, at(10));
    expect(read.map((one) => one.state.kind)).toEqual([
      "skipped",
      "skipped",
      "now",
      "not-started",
      "not-started",
      "not-started",
    ]);
  });

  it("names no stages for a plain watch, and none yet before the mode is chosen", () => {
    const work = join(opened(), "implementor", 3);
    expect(
      stages(work, { handOver: false, run: { kind: "watch" } }, at(9)),
    ).toEqual({ kind: "watch" });
    expect(
      stages(work, { handOver: false, run: { kind: "unset" } }, at(9)),
    ).toEqual({ kind: "unset" });
  });

  it("counts a review that took no time as done, and a merge kolu made itself", () => {
    // `pr-opened` and the first check event land at one instant, as the
    // observer stamps them; the forge merged it with nobody handed anything.
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 40);
    work = check(work, "checks-running", 40);
    work = check(work, "checks-passed", 52);
    work = merged(work, 52);
    const named = byName(
      strip(work, { ...TRIVIAL, handOver: false }, at(90)),
    );
    expect(named.review).toEqual({ kind: "done", ms: 0 });
    expect(named.checks).toEqual({ kind: "done", ms: 12 * MINUTE });
    expect(named.merge).toEqual({ kind: "done", ms: 0 });
  });

  it("builds again on a second attempt after the first PR was closed", () => {
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
    const named = byName(strip(work, TRIVIAL, at(50)));
    // 10 before the first PR, 15 after the reopen before the second.
    expect(named.build).toEqual({ kind: "done", ms: 25 * MINUTE });
    expect(named.review).toEqual({ kind: "now", ms: 15 * MINUTE, who: "agent" });
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

  it("leaves a PR the forge will not merge with the agents, in review", () => {
    const named = byName(strip(blocked(), FULL, at(30)));
    expect(named.review).toEqual({ kind: "now", ms: 20 * MINUTE, who: "agent" });
    expect(named.checks).toEqual({ kind: "not-started" });
  });

  it("hands it over once the forge says it can merge, and takes it back when it cannot", () => {
    let work = mergeState(blocked(), { kind: "can" }, 30);
    expect(byName(strip(work, FULL, at(40))).merge).toEqual({
      kind: "now",
      ms: 10 * MINUTE,
      who: "you",
    });
    // The base moved on: the stale green is gone.
    work = mergeState(work, { kind: "cannot", why: "behind" }, 40);
    expect(byName(strip(work, FULL, at(45))).review.kind).toBe("now");
  });

  it("is green with no checks at all", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = mergeState(work, { kind: "can" }, 10);
    expect(byName(strip(work, FULL, at(15))).merge.kind).toBe("now");
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
