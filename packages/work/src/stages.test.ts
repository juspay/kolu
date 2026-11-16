/**
 * THE SIX STAGES, checked over random records and on the shapes a person
 * meets.
 *
 * The property: whatever happens to a work — questions asked and answered,
 * a planner and an implementor joining, a PR opening, checks running,
 * passing and failing, the work ending and being reopened, events stamped out
 * of order — its stage times add up to its lifetime, exactly as the time
 * bar's stretches do, and the strip says where it is now exactly while it is
 * open. Seeded, so a failure names the seed that reproduces it.
 */

import { describe, expect, it } from "vitest";
import {
  aboutMember,
  ABOUT_WORK,
  answerAsk,
  askQuestions,
  endWork,
  joinWork,
  lifetime,
  openAsks,
  openWork,
  type Policy,
  recordEvent,
  reopenWork,
  type Stage,
  stageMs,
  stages,
  timeBar,
  type Work,
} from "./index.ts";
import { seeded } from "./seeded.ts";

const T0 = Date.UTC(2026, 10, 16, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

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
    reply: {
      kind: "answered",
      values: new Map([[`${id}-q`, ["Approve"]]]),
    },
  });

const check = (
  work: Work,
  kind: "checks-running" | "checks-passed" | "checks-failed",
  minute: number,
  sha = "a1",
): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "ci",
    kind,
    about: ABOUT_WORK,
    pr: 7,
    head: { kind: "commit", sha },
    failing: [],
  });

const prOpened = (work: Work, minute: number): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "kolu",
    kind: "pr-opened",
    about: ABOUT_WORK,
    pr: 7,
    title: "the PR",
  });

const total = (strip: ReadonlyArray<Stage>): number =>
  strip.reduce((sum, one) => sum + stageMs(one.state), 0);

/** One random record, built through the package's own transitions, with a
 *  clock that mostly moves forward and sometimes stamps an event before the
 *  one ahead of it. */
const generated = (seed: number, steps: number): Work => {
  const pick = seeded(seed);
  let work = opened();
  let minute = 0;
  let asks = 0;
  for (let step = 0; step < steps; step += 1) {
    minute += Math.floor(pick() * 12);
    const when = pick() < 0.08 ? minute - 3 : minute;
    const roll = pick();
    const open = openAsks(work);
    if (roll < 0.14) {
      asks += 1;
      work = ask(work, `a${asks}`, when);
    } else if (roll < 0.26 && open[0] !== undefined) {
      work = answer(work, open[0], when);
    } else if (roll < 0.34) {
      work = joinWork(work, {
        terminal: `local/t${step}`,
        role: pick() < 0.5 ? "planner" : "implementor",
        at: at(when),
      });
    } else if (roll < 0.4) {
      work = prOpened(work, when);
    } else if (roll < 0.62) {
      const kinds = [
        "checks-running",
        "checks-passed",
        "checks-failed",
      ] as const;
      work = check(
        work,
        kinds[Math.floor(pick() * kinds.length)] ?? "checks-running",
        when,
        `h${step}`,
      );
    } else if (roll < 0.7) {
      work = recordEvent(work, {
        at: at(when),
        by: "agent",
        kind: "stopped",
        about: aboutMember("local/t0"),
        why: { kind: "none" },
      });
    } else if (roll < 0.76) {
      work = endWork(work, {
        outcome: { kind: "stopped", by: "you" },
        at: at(when),
      });
    } else if (roll < 0.84) {
      work = reopenWork(work, at(when));
    } else {
      work = recordEvent(work, {
        at: at(when),
        by: "agent",
        kind: "note",
        about: ABOUT_WORK,
        text: "a note",
      });
    }
  }
  return work;
};

const policyFrom = (pick: () => number): Policy => ({
  handOver: pick() < 0.5,
  watching: pick() < 0.2,
  planned: pick() < 0.7,
});

describe("the stages add up to the work's life", () => {
  it.each(
    Array.from({ length: 300 }, (_, one) => one + 1),
  )("for generated record %i", (seed) => {
    const work = generated(seed, 30);
    const pick = seeded(seed * 7919);
    const policy = policyFrom(pick);
    const now = at(30 * 12 + Math.floor(pick() * 60));
    const strip = stages(work, policy, now);
    const life = lifetime(work, now);
    const bar = timeBar(work, policy, now).reduce(
      (sum, one) => sum + one.ms,
      0,
    );
    expect(strip.map((one) => one.name)).toEqual([
      "plan",
      "approve",
      "build",
      "review",
      "checks",
      "merge",
    ]);
    expect(total(strip), `seed ${seed}: stages vs lifetime`).toBe(life);
    expect(bar, `seed ${seed}: bar vs lifetime`).toBe(life);
    const nows = strip.filter((one) => one.state.kind === "now");
    expect(nows.length).toBe(work.state.kind === "open" ? 1 : 0);
    // A stage after the current one has had no time if it says it has not
    // started; one that did not happen never has any.
    for (const one of strip)
      if (one.state.kind === "skipped" || one.state.kind === "not-started")
        expect(stageMs(one.state)).toBe(0);
    if (!policy.planned) {
      expect(stageMs(strip[0]?.state ?? { kind: "skipped" })).toBe(0);
      expect(stageMs(strip[1]?.state ?? { kind: "skipped" })).toBe(0);
    }
  });
});

describe("where a work's stages stand", () => {
  const FULL: Policy = { handOver: true, watching: false, planned: true };
  const kinds = (strip: ReadonlyArray<Stage>) =>
    strip.map((one) => one.state.kind);

  it("plans, then waits on you to approve", () => {
    let work = joinWork(opened(), {
      terminal: "local/p",
      role: "planner",
      at: at(0),
    });
    work = ask(work, "approve", 22);
    const strip = stages(work, FULL, at(34));
    expect(strip[0]?.state).toEqual({ kind: "done", ms: 22 * 60_000 });
    expect(strip[1]?.state).toEqual({
      kind: "now",
      ms: 12 * 60_000,
      who: "you",
    });
    expect(kinds(strip).slice(2)).toEqual([
      "not-started",
      "not-started",
      "not-started",
      "not-started",
    ]);
  });

  it("is the human's while the build stops on a question", () => {
    let work = joinWork(opened(), {
      terminal: "local/i",
      role: "implementor",
      at: at(5),
    });
    work = ask(work, "which", 20);
    const strip = stages(work, FULL, at(25));
    expect(strip[2]?.state).toEqual({
      kind: "now",
      ms: 20 * 60_000,
      who: "you",
    });
  });

  it("has no plan and no approval when no planner runs", () => {
    const work = joinWork(opened(), {
      terminal: "local/i",
      role: "implementor",
      at: at(3),
    });
    const strip = stages(work, { ...FULL, planned: false }, at(10));
    expect(kinds(strip)).toEqual([
      "skipped",
      "skipped",
      "now",
      "not-started",
      "not-started",
      "not-started",
    ]);
    expect(stageMs(strip[2]?.state ?? { kind: "skipped" })).toBe(10 * 60_000);
  });

  it("files the time after the PR opens by who it waited on", () => {
    let work = joinWork(opened(), {
      terminal: "local/i",
      role: "implementor",
      at: at(0),
    });
    work = prOpened(work, 40);
    work = check(work, "checks-running", 55);
    work = check(work, "checks-passed", 61);
    const strip = stages(work, FULL, at(70));
    expect(strip.map((one) => [one.name, one.state])).toEqual([
      ["plan", { kind: "skipped" }],
      ["approve", { kind: "skipped" }],
      ["build", { kind: "done", ms: 40 * 60_000 }],
      ["review", { kind: "done", ms: 15 * 60_000 }],
      ["checks", { kind: "done", ms: 6 * 60_000 }],
      ["merge", { kind: "now", ms: 9 * 60_000, who: "you" }],
    ]);
  });

  it("names no current stage once the work is over", () => {
    let work = prOpened(opened(), 10);
    work = endWork(work, { outcome: { kind: "merged", pr: 7 }, at: at(20) });
    const strip = stages(work, FULL, at(90));
    expect(strip.some((one) => one.state.kind === "now")).toBe(false);
    expect(strip.some((one) => one.state.kind === "not-started")).toBe(false);
    expect(total(strip)).toBe(20 * 60_000);
  });
});
