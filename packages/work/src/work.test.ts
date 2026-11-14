import { describe, expect, it } from "vitest";
import {
  answerAsk,
  askQuestions,
  capFinished,
  deserted,
  dropAsk,
  endWork,
  joinWork,
  leaveWork,
  membershipOf,
  openAsks,
  openWork,
  prOf,
  recordEvent,
  setupOf,
  standing,
  timeBar,
  timeSpent,
  took,
  waitingOn,
  waitingOnYou,
  type Work,
} from "./index.ts";

const T = (minute: number): string =>
  new Date(Date.UTC(2026, 10, 14, 10, minute)).toISOString();

const opened = (id = "w1"): Work =>
  openWork({
    id,
    title: "Show agent-distro update errors",
    repo: "/home/me/code/kolu",
    branch: "agent-distro-update-errors",
    at: T(0),
    request: "waterfall ~/code/kolu — show the error",
  });

const SETUP = [
  {
    id: "q-host",
    key: "host",
    question: "Which host?",
    options: ["naiveintent", "pureintent"],
    multiple: false,
  },
  {
    id: "q-mode",
    key: "mode",
    question: "Which mode?",
    options: ["full", "trivial"],
    multiple: false,
  },
  {
    id: "q-ph",
    key: "planner.harness",
    question: "Planner harness?",
    options: ["omp"],
    multiple: false,
  },
  {
    id: "q-pm",
    key: "planner.model",
    question: "Planner model?",
    options: ["Fable 5.2"],
    multiple: false,
  },
  {
    id: "q-ih",
    key: "implementor.harness",
    question: "Implementor harness?",
    options: ["omp"],
    multiple: false,
  },
  {
    id: "q-im",
    key: "implementor.model",
    question: "Implementor model?",
    options: ["Opus 5.5"],
    multiple: false,
  },
  {
    id: "q-green",
    key: "on-green",
    question: "On green?",
    options: ["merge", "hand-over"],
    multiple: false,
  },
] as const;

const setUp = (work: Work, onGreen: "merge" | "hand-over" = "merge"): Work =>
  answerAsk(askQuestions(work, { ask: "setup", at: T(0), questions: SETUP }), {
    ask: "setup",
    at: T(1),
    from: "card",
    values: new Map([
      ["q-host", ["naiveintent"]],
      ["q-mode", ["full"]],
      ["q-ph", ["omp"]],
      ["q-pm", ["Fable 5.2"]],
      ["q-ih", ["omp"]],
      ["q-im", ["Opus 5.5"]],
      ["q-green", [onGreen]],
    ]),
  });

describe("the setup is a reading of the decisions", () => {
  it("reads host, mode, roles and on-green off the answers, with no second copy", () => {
    const setup = setupOf(setUp(opened()));
    expect(setup).toEqual({
      host: "naiveintent",
      mode: "full",
      roles: [
        { role: "planner", harness: "omp", model: "Fable 5.2" },
        { role: "implementor", harness: "omp", model: "Opus 5.5" },
      ],
      onGreen: "merge",
    });
  });

  it("knows nothing until the human answers", () => {
    const asked = askQuestions(opened(), {
      ask: "setup",
      at: T(0),
      questions: SETUP,
    });
    expect(setupOf(asked).host).toBeNull();
    expect(waitingOn(asked)).toBe("you");
    expect(standing(asked).what).toBe("Which host?");
  });

  it("records a given answer as decided by the request, and asks nothing", () => {
    const work = askQuestions(opened(), {
      ask: "setup",
      at: T(0),
      questions: [{ ...SETUP[1], given: "trivial" }],
    });
    expect(work.decisions[0]?.answer).toMatchObject({
      from: "request",
      picked: ["trivial"],
    });
    expect(work.events.map((one) => one.kind)).toEqual(["requested"]);
    expect(setupOf(work).roles.map((one) => one.role)).toEqual(["implementor"]);
  });

  it("keeps typed words apart from the options picked", () => {
    const work = answerAsk(
      askQuestions(opened(), { ask: "a", at: T(0), questions: [SETUP[0]] }),
      {
        ask: "a",
        at: T(1),
        from: "chat",
        values: new Map([["q-host", ["gossamer"]]]),
      },
    );
    expect(work.decisions[0]?.answer).toMatchObject({
      picked: [],
      text: "gossamer",
      from: "chat",
    });
    expect(setupOf(work).host).toBe("gossamer");
  });

  it("drops an unanswered ask once, and answers nothing twice", () => {
    const asked = askQuestions(opened(), {
      ask: "a",
      at: T(0),
      questions: [SETUP[0]],
    });
    const dropped = dropAsk(asked, "a", T(2));
    expect(openAsks(dropped)).toEqual([]);
    expect(dropAsk(dropped, "a", T(3))).toBe(dropped);
    expect(
      answerAsk(dropped, { ask: "a", at: T(3), from: "card", values: null }),
    ).toBe(dropped);
  });
});

describe("who a work is waiting on, and since when", () => {
  it("is the agents after setup, you while a question is open, CI while checks run", () => {
    let work = setUp(opened());
    expect(waitingOn(work)).toBe("agent");
    work = askQuestions(work, {
      ask: "plan",
      at: T(14),
      questions: [
        {
          id: "q-plan",
          key: null,
          question: "Approve the plan?",
          options: ["Approve", "Change it"],
          multiple: false,
        },
      ],
    });
    expect(standing(work)).toEqual({
      who: "you",
      what: "Approve the plan?",
      since: T(14),
    });
    work = answerAsk(work, {
      ask: "plan",
      at: T(18),
      from: "card",
      values: new Map([["q-plan", ["Approve"]]]),
    });
    expect(standing(work)).toMatchObject({ who: "agent", since: T(18) });
    work = recordEvent(work, {
      at: T(40),
      by: "agent",
      kind: "pr-opened",
      terminal: "local/i",
      detail: "#178 Slim the README",
    });
    work = recordEvent(work, {
      at: T(41),
      by: "ci",
      kind: "checks-running",
      terminal: null,
      detail: "",
    });
    expect(standing(work)).toEqual({
      who: "ci",
      what: "CI running",
      since: T(41),
    });
    expect(prOf(work)).toEqual({
      number: 178,
      state: "open",
      checks: "running",
    });
  });

  it("hands a green PR to you when the decision says hand it over", () => {
    let work = setUp(opened(), "hand-over");
    work = recordEvent(work, {
      at: T(40),
      by: "agent",
      kind: "pr-opened",
      terminal: null,
      detail: "#9 x",
    });
    work = recordEvent(work, {
      at: T(41),
      by: "ci",
      kind: "checks-running",
      terminal: null,
      detail: "",
    });
    work = recordEvent(work, {
      at: T(50),
      by: "ci",
      kind: "checks-passed",
      terminal: null,
      detail: "",
    });
    expect(standing(work)).toEqual({
      who: "you",
      what: "merge PR #9",
      since: T(50),
    });
    expect(waitingOn(setUp(opened(), "merge"))).toBe("agent");
  });

  it("is done once ended", () => {
    const work = endWork(setUp(opened()), { outcome: "merged", at: T(60) });
    expect(standing(work)).toEqual({
      who: "done",
      what: "merged",
      since: T(60),
    });
    expect(endWork(work, { outcome: "closed", at: T(61) })).toBe(work);
  });
});

describe("where the time went", () => {
  const story = (): Work => {
    let work = setUp(opened()); // you 0→1
    work = askQuestions(work, {
      ask: "plan",
      at: T(14),
      questions: [
        {
          id: "q",
          key: null,
          question: "Approve?",
          options: ["Approve"],
          multiple: false,
        },
      ],
    });
    work = answerAsk(work, {
      ask: "plan",
      at: T(18),
      from: "chat",
      values: new Map([["q", ["Approve"]]]),
    });
    work = recordEvent(work, {
      at: T(30),
      by: "ci",
      kind: "checks-running",
      terminal: null,
      detail: "",
    });
    work = recordEvent(work, {
      at: T(36),
      by: "ci",
      kind: "checks-passed",
      terminal: null,
      detail: "",
    });
    return endWork(work, { outcome: "merged", at: T(40) });
  };

  it("cuts the life into stretches by who it waited on, merging neighbours", () => {
    const minute = 60_000;
    expect(timeBar(story(), T(99))).toEqual([
      { who: "you", ms: 1 * minute },
      { who: "agent", ms: 13 * minute },
      { who: "you", ms: 4 * minute },
      { who: "agent", ms: 12 * minute },
      { who: "ci", ms: 6 * minute },
      { who: "agent", ms: 4 * minute },
    ]);
    expect(timeSpent(story(), T(99))).toEqual({
      agent: 29 * minute,
      you: 5 * minute,
      ci: 6 * minute,
    });
  });

  it("runs a work in progress to now, and its last step stays open", () => {
    const work = setUp(opened());
    expect(timeSpent(work, T(10)).agent).toBe(9 * 60_000);
    expect(took(work, T(10)).at(-1)).toEqual({ ms: 9 * 60_000, open: true });
  });
});

describe("membership", () => {
  it("indexes the active members of work in progress, and leaving ends a deserted work's claim", () => {
    let work = joinWork(setUp(opened()), {
      terminal: "local/p",
      role: "planner",
      at: T(2),
    });
    work = joinWork(work, {
      terminal: "local/p",
      role: "implementor",
      at: T(3),
    });
    expect(work.members).toHaveLength(1);
    expect(membershipOf([work]).get("local/p")).toEqual({
      work: "w1",
      title: work.title,
      role: "planner",
    });
    expect(deserted(work)).toBe(false);
    work = leaveWork(work, { terminal: "local/p", at: T(5), why: "closed" });
    expect(deserted(work)).toBe(true);
    expect(membershipOf([work]).size).toBe(0);
  });
});

describe("the history", () => {
  it("keeps every work in progress and the 20 most recently finished", () => {
    const works: Work[] = [opened("live")];
    for (let i = 0; i < 23; i++)
      works.push(endWork(opened(`f${i}`), { outcome: "merged", at: T(i + 1) }));
    const { kept, dropped } = capFinished(works);
    expect(kept).toHaveLength(21);
    expect(kept[0]?.id).toBe("live");
    expect(dropped.map((one) => one.id)).toEqual(["f0", "f1", "f2"]);
    expect(waitingOnYou(kept)).toBe(0);
  });
});
