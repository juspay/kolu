import { describe, expect, it } from "vitest";
import {
  AGENT_STATES_KEPT,
  AGENT_STATE_KINDS,
  answerAsk,
  askQuestions,
  capFinished,
  deserted,
  driverOf,
  dropAsk,
  endWork,
  handBack,
  joinWork,
  leaveWork,
  membershipOf,
  missingSetup,
  openAsks,
  openWork,
  policyOf,
  type SetupAsk,
  type SetupKey,
  prOf,
  recordEvent,
  setupOf,
  standing,
  takeOver,
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

describe("what a setup must carry, before any work exists", () => {
  const ask = (
    key: SetupKey,
    options: ReadonlyArray<string>,
    given?: string,
  ): SetupAsk => ({
    key,
    question: `${key}?`,
    options,
    ...(given === undefined ? {} : { given }),
  });

  it("needs exactly the given mode's keys when the request already said the mode", () => {
    // "Trivial, implementor claude on claude-sonnet-5-5, hand it over on
    // green": nobody will be asked which mode, so a trivial waterfall's
    // planner questions are questions about a role it does not run.
    expect(
      missingSetup([
        ask("host", ["naiveintent"], "naiveintent"),
        ask("mode", ["trivial", "full"], "trivial"),
        ask("implementor.harness", ["claude"], "claude"),
        ask("implementor.model", ["claude-sonnet-5-5"], "claude-sonnet-5-5"),
        ask("on-green", ["hand-over"], "hand-over"),
      ]),
    ).toEqual([]);
  });

  it("needs every offered mode's keys while the mode is still a question", () => {
    expect(
      missingSetup([
        ask("host", ["naiveintent"]),
        ask("mode", ["full", "trivial"]),
        ask("implementor.harness", ["claude"]),
        ask("implementor.model", ["claude-sonnet-5-5"]),
        ask("on-green", ["hand-over"]),
      ]),
    ).toEqual(["planner.harness", "planner.model"]);
  });
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
    expect(waitingOn(asked, policyOf(asked))).toBe("you");
    expect(standing(asked, policyOf(asked)).what).toBe("Which host?");
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
    expect(waitingOn(work, policyOf(work))).toBe("agent");
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
    expect(standing(work, policyOf(work))).toEqual({
      who: "you",
      why: "question",
      what: "Approve the plan?",
      ref: null,
      since: T(14),
    });
    work = answerAsk(work, {
      ask: "plan",
      at: T(18),
      from: "card",
      values: new Map([["q-plan", ["Approve"]]]),
    });
    expect(standing(work, policyOf(work))).toMatchObject({
      who: "agent",
      since: T(18),
    });
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
    expect(standing(work, policyOf(work))).toEqual({
      who: "ci",
      why: "ci",
      what: "",
      ref: null,
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
    expect(standing(work, policyOf(work))).toEqual({
      who: "you",
      why: "merge",
      what: "",
      ref: 9,
      since: T(50),
    });
    expect(
      waitingOn(setUp(opened(), "merge"), policyOf(setUp(opened(), "merge"))),
    ).toBe("agent");
  });

  it("is done once ended", () => {
    const work = endWork(setUp(opened()), { outcome: "merged", at: T(60) });
    expect(standing(work, policyOf(work))).toEqual({
      who: "done",
      why: "merged",
      what: "",
      ref: null,
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
    expect(timeBar(story(), policyOf(story()), T(99))).toEqual([
      { who: "you", ms: 1 * minute },
      { who: "agent", ms: 13 * minute },
      { who: "you", ms: 4 * minute },
      { who: "agent", ms: 12 * minute },
      { who: "ci", ms: 6 * minute },
      { who: "agent", ms: 4 * minute },
    ]);
    expect(timeSpent(story(), policyOf(story()), T(99))).toEqual({
      agent: 29 * minute,
      you: 5 * minute,
      ci: 6 * minute,
    });
  });

  it("runs a work in progress to now, and its last step stays open", () => {
    const work = setUp(opened());
    expect(timeSpent(work, policyOf(work), T(10)).agent).toBe(9 * 60_000);
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
      driver: "conductor",
    });
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
    const { kept, dropped } = capFinished(works, 20);
    expect(kept).toHaveLength(21);
    expect(kept[0]?.id).toBe("live");
    expect(dropped.map((one) => one.id)).toEqual(["f0", "f1", "f2"]);
    expect(waitingOnYou(kept)).toBe(0);
  });
});

describe("who drives a member terminal", () => {
  const driven = (): Work =>
    joinWork(setUp(opened()), {
      terminal: "local/p",
      role: "planner",
      at: T(2),
    });

  it("is the Conductor from the moment a member joins a work it runs", () => {
    expect(driverOf(driven(), "local/p")).toBe("conductor");
  });

  it("is you once you take it over, and the Conductor again once you hand it back", () => {
    const mine = takeOver(driven(), "local/p", T(4));
    expect(driverOf(mine, "local/p")).toBe("you");
    expect(membershipOf([mine]).get("local/p")?.driver).toBe("you");
    expect(driverOf(handBack(mine, "local/p", T(6)), "local/p")).toBe(
      "conductor",
    );
  });

  it("ends by itself when the member leaves, and a terminal that rejoins is the Conductor's again", () => {
    const left = leaveWork(takeOver(driven(), "local/p", T(4)), {
      terminal: "local/p",
      at: T(5),
      why: "released",
    });
    expect(driverOf(left, "local/p")).toBeNull();
    const again = joinWork(left, {
      terminal: "local/p",
      role: "planner",
      at: T(6),
    });
    expect(driverOf(again, "local/p")).toBe("conductor");
  });

  it("nobody drives a terminal that is no member, a watch, or a work that has ended", () => {
    const work = driven();
    expect(driverOf(work, "local/elsewhere")).toBeNull();
    expect(
      driverOf(endWork(work, { outcome: "merged", at: T(9) }), "local/p"),
    ).toBeNull();
    // A `watch` is the human's own terminal: kolu keeps an eye on it and
    // never types into it, so there is nothing to take over.
    const watched = joinWork(
      askQuestions(opened("w-watch"), {
        ask: "setup",
        at: T(0),
        questions: [
          {
            id: "q-host",
            key: "host",
            question: "Which host?",
            options: ["naiveintent"],
            multiple: false,
            given: "naiveintent",
          },
          {
            id: "q-mode",
            key: "mode",
            question: "Which mode?",
            options: ["watch"],
            multiple: false,
            given: "watch",
          },
        ],
      }),
      { terminal: "local/w", role: "other", at: T(1) },
    );
    expect(driverOf(watched, "local/w")).toBeNull();
    expect(membershipOf([watched]).get("local/w")?.driver).toBeNull();
  });
});

describe("the agent-state bound", () => {
  /** The agent stopping and coming up again, for as long as you like. */
  const stopping = (work: Work, times: number): Work => {
    let next = work;
    for (let i = 0; i < times; i += 1) {
      next = recordEvent(next, {
        at: T(20 + i),
        by: "agent",
        kind: i % 2 === 0 ? "stopped" : "ready",
        terminal: "local/p",
        detail: "",
      });
    }
    return next;
  };

  it("keeps the most recent 30 agent-state events and counts the rest into one folded event", () => {
    const work = stopping(
      joinWork(setUp(opened()), {
        terminal: "local/p",
        role: "planner",
        at: T(2),
      }),
      1_000,
    );
    const states = work.events.filter((one) =>
      (AGENT_STATE_KINDS as ReadonlyArray<string>).includes(one.kind),
    );
    expect(states).toHaveLength(AGENT_STATES_KEPT);
    expect(states).toHaveLength(30);
    const folded = work.events.filter((one) => one.kind === "folded");
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({
      by: "kolu",
      terminal: null,
      detail: String(1_000 - 30),
    });
    // It sits where the oldest event it stands for sat: before every state
    // event that survived, and after the membership it happened under.
    const at = work.events.indexOf(folded[0] as (typeof work.events)[number]);
    expect(work.events.slice(0, at).map((one) => one.kind)).toEqual([
      "requested",
      "question",
      "answered",
      "joined",
    ]);
    // Nothing else is ever folded.
    expect(work.events.filter((one) => one.kind === "joined")).toHaveLength(1);
  });

  it("leaves the folds alone: the same work unbounded says the same thing", () => {
    let base = joinWork(setUp(opened()), {
      terminal: "local/p",
      role: "planner",
      at: T(2),
    });
    base = askQuestions(base, {
      ask: "plan",
      at: T(14),
      questions: [
        {
          id: "q-plan",
          key: null,
          question: "Approve the plan?",
          options: ["Approve"],
          multiple: false,
        },
      ],
    });
    base = answerAsk(base, {
      ask: "plan",
      at: T(16),
      from: "card",
      values: new Map([["q-plan", ["Approve"]]]),
    });
    const bounded = recordEvent(stopping(base, 400), {
      at: T(900),
      by: "ci",
      kind: "checks-running",
      terminal: "local/p",
      detail: "",
    });
    // The SAME events, with nothing dropped — the bound is the only
    // difference, and the folds must not be able to tell.
    const unbounded: Work = {
      ...bounded,
      events: [
        ...base.events,
        ...Array.from({ length: 400 }, (_at, i) => ({
          at: T(20 + i),
          by: "agent" as const,
          kind: (i % 2 === 0 ? "stopped" : "ready") as "stopped" | "ready",
          terminal: "local/p",
          detail: "",
        })),
        {
          at: T(900),
          by: "ci",
          kind: "checks-running",
          terminal: "local/p",
          detail: "",
        },
      ],
    };
    expect(unbounded.events.length).toBeGreaterThan(bounded.events.length);
    expect(waitingOn(bounded, policyOf(bounded))).toEqual(
      waitingOn(unbounded, policyOf(unbounded)),
    );
    expect(standing(bounded, policyOf(bounded))).toEqual(
      standing(unbounded, policyOf(unbounded)),
    );
    expect(timeBar(bounded, policyOf(bounded), T(1_000))).toEqual(
      timeBar(unbounded, policyOf(unbounded), T(1_000)),
    );
  });
});
