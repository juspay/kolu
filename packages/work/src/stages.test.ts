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

const strip = (work: Work, policy: Policy, now: string) =>
  waterfall(work, policy, now).stages;

const waterfall = (work: Work, policy: Policy, now: string) => {
  const read = stages(work, policy, now);
  if (read.kind !== "staged") throw new Error(`no stages: ${read.kind}`);
  return read;
};

const cells = (work: Work, policy: Policy, now: string): string =>
  strip(work, policy, now)
    .map((one) => {
      const word = {
        now: "now",
        done: "done",
        skipped: "–",
        "not-started": "·",
      }[one.state.kind];
      return `${one.name} ${word}`;
    })
    .join(", ");

const timeByEventStage = (
  work: Work,
  filed: ReadonlyArray<Filed>,
  now: string,
): Record<Filed, number> => {
  const sums: Record<Filed, number> = {
    setup: 0,
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
  it.each(
    Array.from({ length: 300 }, (_, one) => one + 1),
  )("the stages add up to the life measured from the events, record %i", (seed) => {
    const work = chaotic(seed, 34);
    const pick = seeded(seed * 7919);
    const policy = policyFor(pick() < 0.6 ? "full" : "trivial", pick() < 0.5);
    const now = at(34 * 12 + Math.floor(pick() * 60));
    const life = lifeOf(work, now);
    const all = strip(work, policy, now);
    const spent = timeSpent(work, policy, now);
    const read = waterfall(work, policy, now);
    expect(read.events, `seed ${seed}: one per event`).toHaveLength(
      work.events.length,
    );
    const filed = timeByEventStage(work, read.events, now);
    for (const one of read.stages)
      expect(filed[one.name], `seed ${seed}: ${one.name}`).toBe(
        stageMs(one.state),
      );
    expect(lifetime(work, now), `seed ${seed}: lifetime`).toBe(life);
    if (Option.exists(prOf(work), (one) => one.draft === "draft"))
      expect(standing(work, policy).why, `seed ${seed}: draft`).not.toBe(
        "merge",
      );
    expect(total(all) + filed.setup, `seed ${seed}: stages`).toBe(life);
    if (policy.run.kind === "set" && policy.run.stages.includes("plan"))
      expect(filed.setup, `seed ${seed}: setup`).toBe(0);
    expect(spent.agent + spent.you + spent.ci, `seed ${seed}: spent`).toBe(
      life,
    );
    expect(all.filter((one) => one.state.kind === "now").length).toBe(
      work.state.kind === "open" && read.current !== "setup" ? 1 : 0,
    );
    const current = read.stages.find((one) => one.state.kind === "now");
    if (current !== undefined)
      expect(read.current, `seed ${seed}: current`).toBe(current.name);
    for (const one of all) {
      if (one.state.kind === "skipped" || one.state.kind === "not-started")
        expect(stageMs(one.state)).toBe(0);
      if (policy.run.kind === "set" && !policy.run.stages.includes(one.name))
        expect(one.state, `seed ${seed}: ${one.name}`).toEqual({
          kind: "skipped",
        });
    }
  });
});

describe("on scripted waterfalls", () => {
  it.each(
    Array.from({ length: 200 }, (_, one) => one + 1),
  )("each stage holds the time put in it, waterfall %i", (seed) => {
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
    const named = byName(strip(work, FULL, at(34)));
    expect(named.plan).toEqual({ kind: "done", ms: 22 * MINUTE, who: "agent" });
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

  it("has no plan, approval or review when no planner runs", () => {
    const work = join(opened(), "implementor", 3);
    expect(cells(work, TRIVIAL, at(10))).toBe(
      "plan –, approve –, build now, review –, checks ·, merge ·",
    );
  });

  it("files the setup's questions under the plan, before there is one to approve", () => {
    let work = ask(opened(), "setup", 0);
    work = answer(work, "setup", 6);
    work = join(work, "planner", 6);
    work = ask(work, "approve", 20);
    const read = waterfall(work, FULL, at(30));
    const named = byName(read.stages);
    expect(named.plan).toEqual({ kind: "done", ms: 20 * MINUTE, who: "agent" });
    expect(named.approve).toEqual({ kind: "now", ms: 10 * MINUTE, who: "you" });
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
    expect(byName(strip(work, FULL, at(20))).plan).toEqual({
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

  it("counts a review that took no time as done, and a merge kolu made itself", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 40);
    work = check(work, "checks-running", 40);
    work = check(work, "checks-passed", 52);
    work = merged(work, 52);
    const named = byName(strip(work, policyFor("full", false), at(90)));
    expect(named.review).toMatchObject({ kind: "done", ms: 0 });
    expect(named.checks).toMatchObject({ kind: "done", ms: 12 * MINUTE });
    expect(named.merge).toMatchObject({ kind: "done", ms: 0 });
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
    const named = byName(strip(work, FULL, at(50)));
    expect(named.build).toMatchObject({ kind: "done", ms: 25 * MINUTE });
    expect(named.review).toEqual({
      kind: "now",
      ms: 15 * MINUTE,
      who: "agent",
    });
  });
});

describe("the shapes of real works", () => {
  const second = (seconds: number): string =>
    new Date(T0 + seconds * 1000).toISOString();

  it("a full waterfall that opens its own PR, is reviewed, runs CI and is merged", () => {
    let work = join(opened(), "planner", 0);
    work = ask(work, "approve", 20);
    work = answer(work, "approve", 25);
    work = join(work, "implementor", 25);
    work = prOpened(work, 60);
    work = check(work, "checks-running", 80);
    work = check(work, "checks-passed", 95);
    work = mergeState(work, { kind: "can" }, 95);
    work = merged(work, 100);
    expect(cells(work, FULL, at(120))).toBe(
      "plan done, approve done, build done, review done, checks done, merge done",
    );
  });

  it("a trivial work that takes up a PR that already existed (the dependabot card)", () => {
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
    expect(byName(strip(work, FULL, at(10))).plan).toEqual({
      kind: "done",
      ms: 4 * MINUTE,
      who: "you",
    });
  });

  it("a trivial work's setup form, which no stage holds", () => {
    const asking = ask(opened(), "setup", 0);
    expect(cells(asking, TRIVIAL, at(5))).toBe(
      "plan –, approve –, build ·, review –, checks ·, merge ·",
    );
    expect(waterfall(asking, TRIVIAL, at(5)).current).toBe("setup");
    let work = answer(asking, "setup", 5);
    work = join(work, "implementor", 5);
    const named = byName(strip(work, TRIVIAL, at(20)));
    expect(named.build).toEqual({ kind: "now", ms: 15 * MINUTE, who: "agent" });
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
    const named = byName(strip(work, FULL, at(90)));
    expect(named.build).toMatchObject({ kind: "done", ms: 45 * MINUTE });
    expect(cells(work, FULL, at(90))).toBe(
      "plan done, approve done, build done, review –, checks done, merge now",
    );
  });

  it("Page chats open in a pane (olai#702): a draft opened early, never marked ready", () => {
    let work = join(opened(), "planner", 0);
    work = ask(work, "approve", 20);
    work = answer(work, "approve", 25);
    work = join(work, "implementor", 25);
    work = prOpened(work, 145, 7, "draft");
    let ci = 0;
    for (let push = 0; push < 6; push += 1) {
      const start = 145 + push * 60;
      work = check(work, "checks-running", start, 7, `p${push}`);
      work = check(work, "checks-passed", start + 15, 7, `p${push}`);
      ci += 15 * MINUTE;
    }
    const now = at(145 + 6 * 60);
    const named = byName(strip(work, FULL, now));
    expect(named.build).toEqual({
      kind: "now",
      ms: Date.parse(now) - Date.parse(at(25)),
      who: "agent",
    });
    expect(named.review).toEqual({ kind: "not-started" });
    expect(named.checks).toEqual({ kind: "not-started" });
    expect(timeSpent(work, FULL, now).ci).toBe(ci);
  });

  it("One ACP runner for kolu and olai (#2405): green as a draft for a day, merged at ready", () => {
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
    const midDraft = "2026-11-18T12:00:00.000Z";
    expect(waterfall(work, FULL, midDraft).current).toBe("build");
    expect(standing(work, FULL).why).toBe("working");
    work = draftState(work, "ready", minute(ready), 2405);
    work = mergeState(work, { kind: "can" }, minute(ready), 2405, "h3");
    work = merged(work, minute("2026-11-19T02:15:53.000Z"), 2405);
    const named = byName(strip(work, FULL, "2026-11-19T03:00:00.000Z"));
    expect(named.build).toEqual({
      kind: "done",
      ms: Date.parse(ready) - Date.parse(started),
      who: "agent",
    });
    expect(stageMs(named.build)).toBeGreaterThan(25 * 60 * MINUTE);
    expect(stageMs(named.review)).toBe(0);
    expect(stageMs(named.checks)).toBe(0);
  });
});

describe("the build ends when the PR is ready for review", () => {
  it("ends at once for a PR opened ready", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    expect(cells(work, FULL, at(20))).toBe(
      "plan done, approve –, build done, review now, checks ·, merge ·",
    );
  });

  it("does not end at a draft's open, and ends when it is marked ready", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10, 7, "draft");
    expect(waterfall(work, FULL, at(20)).current).toBe("build");
    work = draftState(work, "ready", 30);
    const named = byName(strip(work, FULL, at(45)));
    expect(named.build).toMatchObject({ kind: "done", ms: 30 * MINUTE });
    expect(named.review).toEqual({
      kind: "now",
      ms: 15 * MINUTE,
      who: "agent",
    });
  });

  it("goes back to the build when the PR is turned back into a draft, and the review keeps its time", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = draftState(work, "draft", 25);
    expect(byName(strip(work, FULL, at(40))).build).toMatchObject({
      kind: "now",
      ms: 25 * MINUTE,
    });
    work = draftState(work, "ready", 40);
    const named = byName(strip(work, FULL, at(50)));
    expect(named.build).toMatchObject({ kind: "done", ms: 25 * MINUTE });
    expect(named.review).toMatchObject({ kind: "now", ms: 25 * MINUTE });
  });

  it("reads a PR whose word was never recorded as before: the open ends the build", () => {
    const read = (draft: "ready" | "unrecorded") => {
      let work = join(opened(), "implementor", 0);
      work = prOpened(work, 10, 7, draft);
      work = check(work, "checks-running", 20);
      work = check(work, "checks-passed", 30);
      return strip(work, FULL, at(40));
    };
    expect(read("unrecorded")).toEqual(read("ready"));
    expect(byName(read("unrecorded")).build).toMatchObject({
      kind: "done",
      ms: 10 * MINUTE,
    });
  });

  it("keeps an existing PR's work in the build when kolu learns the PR is ready", () => {
    let work = prOpened(opened(), 0, 7, "unrecorded");
    work = join(work, "implementor", 5);
    const before = cells(work, FULL, at(30));
    expect(waterfall(work, FULL, at(30)).current).toBe("build");
    work = draftState(work, "ready", 20);
    expect(cells(work, FULL, at(30))).toBe(before);
    expect(waterfall(work, FULL, at(30)).current).toBe("build");
  });

  it("keeps the implementor's own PR past the build when kolu learns it is ready", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10, 7, "unrecorded");
    const before = cells(work, FULL, at(30));
    expect(waterfall(work, FULL, at(30)).current).toBe("review");
    work = draftState(work, "ready", 20);
    expect(cells(work, FULL, at(30))).toBe(before);
  });

  it("keeps an existing PR's work in the build when kolu learns the PR is a draft", () => {
    let work = prOpened(opened(), 0, 7, "unrecorded");
    work = join(work, "implementor", 5);
    work = draftState(work, "draft", 20);
    expect(waterfall(work, FULL, at(30)).current).toBe("build");
  });

  it("ends the build when an existing DRAFT is marked ready after the implementor joined", () => {
    let work = prOpened(opened(), 0, 7, "draft");
    work = join(work, "implementor", 5);
    expect(waterfall(work, FULL, at(15)).current).toBe("build");
    work = draftState(work, "ready", 20);
    const named = byName(strip(work, FULL, at(30)));
    expect(named.build).toMatchObject({ kind: "done", ms: 15 * MINUTE });
    expect(named.review).toMatchObject({ kind: "now", ms: 10 * MINUTE });
  });

  it("keeps a trivial work's draft CI in the build, and files CI as checks once it is ready", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10, 7, "draft");
    work = check(work, "checks-running", 15);
    expect(cells(work, TRIVIAL, at(25))).toBe(
      "plan –, approve –, build now, review –, checks ·, merge ·",
    );
    work = check(work, "checks-passed", 25);
    work = draftState(work, "ready", 30);
    work = check(work, "checks-running", 35, 7, "b2");
    const named = byName(strip(work, TRIVIAL, at(45)));
    expect(named.build).toMatchObject({ kind: "done", ms: 35 * MINUTE });
    expect(named.checks).toMatchObject({ kind: "now", ms: 10 * MINUTE });
    expect(named.review).toEqual({ kind: "skipped" });
  });
});

describe("green is the forge saying it can merge", () => {
  const blocked = (): Work => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = check(work, "checks-passed", 12);
    return mergeState(work, { kind: "cannot", why: "blocked" }, 12);
  };

  it("leaves a PR the forge will not merge with the agents, in review", () => {
    const named = byName(strip(blocked(), FULL, at(30)));
    expect(named.review).toEqual({
      kind: "now",
      ms: 20 * MINUTE,
      who: "agent",
    });
    expect(named.checks).toEqual({ kind: "not-started" });
  });

  it("hands it over once the forge says it can merge, and takes it back when it cannot", () => {
    let work = mergeState(blocked(), { kind: "can" }, 30);
    expect(byName(strip(work, FULL, at(40))).merge).toEqual({
      kind: "now",
      ms: 10 * MINUTE,
      who: "you",
    });
    work = mergeState(work, { kind: "cannot", why: "behind" }, 40);
    expect(byName(strip(work, FULL, at(45))).review.kind).toBe("now");
  });

  it("is green with no checks at all", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = mergeState(work, { kind: "can" }, 10);
    expect(byName(strip(work, FULL, at(15))).merge.kind).toBe("now");
  });

  it("does not let one commit's answer stand for a push", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = check(work, "checks-passed", 12);
    work = mergeState(work, { kind: "can" }, 12);
    expect(byName(strip(work, FULL, at(14))).merge.kind).toBe("now");
    work = mergeState(work, { kind: "unsettled" }, 20, 7, "b2");
    expect(byName(strip(work, FULL, at(22))).review.kind).toBe("now");
    let checked = mergeState(blocked(), { kind: "can" }, 14);
    checked = check(checked, "checks-passed", 20, 7, "b2");
    expect(byName(strip(checked, FULL, at(22))).review.kind).toBe("now");
  });

  it("forgets the checks and the answer when a work stopped green is reopened", () => {
    let work = mergeState(blocked(), { kind: "can" }, 14);
    work = endWork(work, {
      outcome: { kind: "stopped", by: "you" },
      at: at(16),
    });
    work = reopenWork(work, at(60));
    const named = byName(strip(work, FULL, at(70)));
    expect(named.review).toEqual({
      kind: "now",
      ms: 14 * MINUTE,
      who: "agent",
    });
  });

  it("keeps one answer per check run, and every answer outside one", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = check(work, "checks-running", 11);
    for (let flip = 0; flip < 20; flip += 1)
      work = mergeState(
        work,
        flip % 2 === 0 ? { kind: "can" } : { kind: "cannot", why: "blocked" },
        12 + flip,
      );
    const answers = () =>
      work.events.filter((one) => one.kind === "merge-state").length;
    expect(answers()).toBe(1);
    work = check(work, "checks-passed", 40);
    work = mergeState(work, { kind: "can" }, 41);
    work = mergeState(work, { kind: "cannot", why: "behind" }, 50);
    expect(answers()).toBe(3);
  });

  it("keeps at most a bounded number of check results for one commit, never losing the newest", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
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
    expect(kept.at(0)?.at).toBe(at(11));
    expect(kept.at(-1)?.at).toBe(at(50));
    expect(kept.at(-1)?.kind).toBe("checks-passed");
    expect(byName(strip(work, FULL, at(60))).checks.kind).not.toBe("now");
  });

  it("keeps a hand-over's time when a ninth check result arrives", () => {
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
    const cells = byName(strip(work, FULL, at(55)));
    expect(cells.merge).toEqual({ kind: "done", ms: 30 * 60_000, who: "you" });
    expect(cells.checks.kind).toBe("now");
    expect(
      work.events.filter((one) => one.kind === "checks-passed").at(-1)?.at,
    ).toBe(at(18));
  });

  it("keeps at most a bounded number of merge answers for one commit, never losing the newest", () => {
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
  const readMerge = (work: Work) => Option.getOrThrow(prOf(work)).merge;

  it("reads cannot: draft even after a stray merge answer that says it can", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10, 7, "draft");
    expect(readMerge(work)).toEqual({ kind: "cannot", why: "draft" });
    work = check(work, "checks-passed", 12);
    work = mergeState(work, { kind: "can" }, 12);
    expect(readMerge(work)).toEqual({ kind: "cannot", why: "draft" });
    expect(byName(strip(work, FULL, at(20))).merge.kind).not.toBe("now");
  });

  it("forgets the merge answer on entering a draft and on leaving one", () => {
    let work = join(opened(), "implementor", 0);
    work = prOpened(work, 10);
    work = mergeState(work, { kind: "can" }, 12);
    expect(readMerge(work)).toEqual({ kind: "can" });
    work = draftState(work, "draft", 14);
    expect(readMerge(work)).toEqual({ kind: "cannot", why: "draft" });
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
    expect(lifetime(work, at(10))).toBe(7 * MINUTE);
    expect(took(work, at(10)).reduce((sum, one) => sum + one.ms, 0)).toBe(
      7 * MINUTE,
    );
  });
});
