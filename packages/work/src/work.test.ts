import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AGENT_STATE_KINDS,
  AGENT_STATES_KEPT,
  answerAsk,
  askQuestions,
  capFinished,
  driverOf,
  dropAsk,
  endWork,
  handBack,
  InvalidWorkStore,
  isAnswered,
  isAsked,
  joinWork,
  keepFiles,
  leaveWork,
  membershipOf,
  missingSetup,
  openAsks,
  openWork,
  parseStore,
  policyOf,
  prOf,
  recordEvent,
  reopenWork,
  roleRank,
  SETUP_KEYS,
  type SetupAsk,
  setupOf,
  standing,
  takeOver,
  timeBar,
  timeSpent,
  took,
  type Work,
  type WorkId,
  type WorkKey,
  type WorkMember,
  WorkSchema,
  waitingOn,
  waitingOnYou,
  waterfallFileName,
  workDirOf,
  workIdOf,
  workKeyOf,
} from "./index.ts";

const T = (minute: number): string =>
  new Date(Date.UTC(2026, 10, 14, 10, minute)).toISOString();

const KEY: WorkKey = {
  kind: "branch",
  host: "remote:naiveintent",
  repo: "/home/me/code/kolu",
  branch: "agent-distro-update-errors",
};
const ID = workIdOf(KEY);

const opened = (key: WorkKey = KEY): Work =>
  openWork({
    key,
    title: "Show agent-distro update errors",
    at: T(0),
    request: "waterfall ~/code/kolu — show the error",
  });

const SETUP = [
  {
    id: "q-mode",
    key: "mode",
    header: "",
    question: "Which mode?",
    options: ["full", "trivial"],
    multiple: false,
    file: "",
  },
  {
    id: "q-ph",
    key: "planner.harness",
    header: "",
    question: "Planner harness?",
    options: ["omp", "claude"],
    multiple: false,
    file: "",
  },
  {
    id: "q-pm",
    key: "planner.model",
    header: "",
    question: "Planner model?",
    options: ["fable", "opus"],
    multiple: false,
    file: "",
  },
  {
    id: "q-ih",
    key: "implementor.harness",
    header: "",
    question: "Implementor harness?",
    options: ["omp", "claude"],
    multiple: false,
    file: "",
  },
  {
    id: "q-im",
    key: "implementor.model",
    header: "",
    question: "Implementor model?",
    options: ["fable", "opus"],
    multiple: false,
    file: "",
  },
  {
    id: "q-green",
    key: "on-green",
    header: "",
    question: "On green?",
    options: ["merge", "hand-over"],
    multiple: false,
    file: "",
  },
] as const;

const setUp = (work: Work): Work =>
  answerAsk(askQuestions(work, { ask: "ask-1", questions: SETUP, at: T(1) }), {
    ask: "ask-1",
    values: new Map([
      ["q-mode", ["full"]],
      ["q-ph", ["omp"]],
      ["q-pm", ["fable"]],
      ["q-ih", ["omp"]],
      ["q-im", ["opus"]],
      ["q-green", ["merge"]],
    ]),
    from: "card",
    at: T(2),
  });

const member = (over: Partial<WorkMember> = {}): WorkMember => ({
  work: ID,
  role: "planner",
  joinedAt: T(3),
  worktree: null,
  ...over,
});

describe("a work IS its key", () => {
  it("encodes and decodes a branch key, separators and all", () => {
    expect(ID).toBe(
      "branch:remote%3Anaiveintent/%2Fhome%2Fme%2Fcode%2Fkolu/agent-distro-update-errors",
    );
    expect(workKeyOf(ID)).toEqual(KEY);
  });

  it("is injective — two keys never share an id", () => {
    const sneaky: WorkKey = {
      kind: "branch",
      host: "remote:naiveintent",
      repo: "/home/me/code",
      branch: "kolu/agent-distro-update-errors",
    };
    expect(workIdOf(sneaky)).not.toBe(ID);
    expect(workKeyOf(workIdOf(sneaky))).toEqual(sneaky);
  });

  it("encodes and decodes a watch key", () => {
    const key: WorkKey = { kind: "watch", terminal: "local/abc-123" };
    expect(workKeyOf(workIdOf(key))).toEqual(key);
  });

  it("answers nothing for a string that is no work id", () => {
    expect(workKeyOf("w1")).toBeNull();
    expect(workKeyOf("branch:host//branch")).toBeNull();
  });

  it("names a kept-file directory that is filesystem-safe", () => {
    expect(workDirOf(ID)).toMatch(/^[0-9a-f]{16}$/);
    expect(workDirOf(ID)).toBe(workDirOf(ID));
    expect(workDirOf(ID)).not.toBe(workDirOf(`${ID}x`));
  });

  it("reads the host off the key, with no decision involved", () => {
    expect(setupOf(opened()).host).toBe("remote:naiveintent");
    expect(SETUP_KEYS).not.toContain("host");
    expect(
      missingSetup([
        { key: "mode", question: "?", options: ["full"] },
      ] as ReadonlyArray<SetupAsk>),
    ).not.toContain("host");
  });
});

describe("parseStore — what the types cannot say", () => {
  const openWorks = (): Record<WorkId, Work> => ({ [ID]: opened() });

  it("takes a store whose every rule holds", () => {
    const store = parseStore(openWorks(), {
      "local/a": member(),
      "local/b": member({ role: "implementor" }),
      "local/c": member({ role: "other" }),
      "local/d": member({ role: "other" }),
    });
    expect([...store.works.keys()]).toEqual([ID]);
    expect(store.members.size).toBe(4);
  });

  it("refuses a work filed under a key that is not its own identity", () => {
    expect(() => parseStore({ "work:random": opened() }, {})).toThrow(
      /stored under "work:random" but says it is/,
    );
  });

  it("refuses a member of a work that does not exist", () => {
    expect(() =>
      parseStore(openWorks(), { "local/a": member({ work: "branch:x/y/z" }) }),
    ).toThrow(/there is no such piece of work/);
  });

  it("refuses a member of a work that has ended", () => {
    const ended = endWork(opened(), {
      outcome: { kind: "merged", pr: 181 },
      at: T(9),
    });
    expect(() => parseStore({ [ID]: ended }, { "local/a": member() })).toThrow(
      /which has ended/,
    );
  });

  it("refuses two terminals in one role", () => {
    expect(() =>
      parseStore(openWorks(), {
        "local/a": member(),
        "local/b": member(),
      }),
    ).toThrow(/two terminals in the planner role/);
  });

  it("throws a value a face can act on", () => {
    try {
      parseStore({ "work:random": opened() }, {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidWorkStore);
      expect((err as InvalidWorkStore).why).toMatch(/identified by its branch/);
    }
  });
});

describe("the states that cannot be written down", () => {
  it("has no `abandoned` outcome to decode", () => {
    const decode = Schema.decodeUnknownResult(WorkSchema);
    const work = {
      ...opened(),
      state: {
        kind: "ended",
        at: T(9),
        outcome: { kind: "abandoned" },
        kept: [],
      },
    };
    expect(decode(work)._tag).toBe("Failure");
  });

  it("has nowhere to put kept files on a work in progress", () => {
    const open = opened();
    expect(
      keepFiles(open, { files: [{ path: "a.md", bytes: 1 }], at: T(4) }),
    ).toBe(open);
    expect(open.state.kind).toBe("open");
  });

  it("keeps files on the ended arm, where the end's own time is", () => {
    const ended = keepFiles(
      endWork(opened(), { outcome: { kind: "stopped", by: "you" }, at: T(9) }),
      { files: [{ path: ".waterfall/plan.md", bytes: 12 }], at: T(9) },
    );
    expect(ended.state).toMatchObject({
      kind: "ended",
      outcome: { kind: "stopped", by: "you" },
      kept: [{ path: ".waterfall/plan.md", bytes: 12 }],
    });
  });

  it("refuses a check event with no pull request", () => {
    const decode = Schema.decodeUnknownResult(WorkSchema);
    const work = {
      ...opened(),
      events: [
        {
          at: T(5),
          by: "ci",
          kind: "checks-passed",
          terminal: null,
          head: "abc",
          failing: [],
        },
      ],
    };
    expect(decode(work)._tag).toBe("Failure");
  });

  it("is a question OR an answer, never answered-with-null", () => {
    const asked = askQuestions(opened(), {
      ask: "ask-1",
      questions: [SETUP[0]],
      at: T(1),
    });
    expect(asked.decisions.every(isAsked)).toBe(true);
    const answered = answerAsk(asked, {
      ask: "ask-1",
      values: new Map([["q-mode", ["full"]]]),
      from: "card",
      at: T(2),
    });
    const one = answered.decisions[0];
    expect(one !== undefined && isAnswered(one) && one.answer.how).toBe(
      "answered",
    );
  });
});

describe("opening, ending, reopening", () => {
  it("opens with a `requested` event carrying the words", () => {
    const work = opened();
    expect(work.state).toEqual({ kind: "open" });
    expect(work.events).toEqual([
      {
        at: T(0),
        by: "you",
        kind: "requested",
        terminal: null,
        text: "waterfall ~/code/kolu — show the error",
      },
    ]);
  });

  it("ends once, with the outcome on the timeline", () => {
    const ended = endWork(setUp(opened()), {
      outcome: { kind: "merged", pr: 181 },
      at: T(9),
    });
    expect(ended.state).toMatchObject({ kind: "ended" });
    expect(ended.events.at(-1)).toMatchObject({
      kind: "ended",
      outcome: { kind: "merged", pr: 181 },
    });
    expect(
      endWork(ended, { outcome: { kind: "stopped", by: "you" }, at: T(10) }),
    ).toBe(ended);
  });

  it("reopens, keeping every decision and the whole timeline", () => {
    const ended = endWork(setUp(opened()), {
      outcome: { kind: "stopped", by: "conductor" },
      at: T(9),
    });
    const again = reopenWork(ended, T(10));
    expect(again.state).toEqual({ kind: "open" });
    expect(again.decisions).toEqual(ended.decisions);
    expect(again.events.slice(0, ended.events.length)).toEqual(ended.events);
    expect(again.events.at(-1)?.kind).toBe("reopened");
    expect(reopenWork(again, T(11))).toBe(again);
    expect(standing(again, policyOf(again)).who).not.toBe("done");
  });
});

describe("the readings", () => {
  const worked = (): Work => {
    let work = setUp(opened());
    work = joinWork(work, { terminal: "local/a", role: "planner", at: T(3) });
    work = recordEvent(work, {
      at: T(4),
      by: "agent",
      kind: "pr-opened",
      terminal: "local/a",
      pr: 181,
      title: "The docs are 24 pages",
    });
    work = recordEvent(work, {
      at: T(5),
      by: "ci",
      kind: "checks-running",
      terminal: null,
      pr: 181,
      head: "abc1234",
      failing: [],
    });
    return recordEvent(work, {
      at: T(6),
      by: "ci",
      kind: "checks-passed",
      terminal: null,
      pr: 181,
      head: "abc1234",
      failing: [],
    });
  };

  it("reads the PR off typed events rather than prose", () => {
    expect(prOf(worked())).toEqual({
      number: 181,
      state: "open",
      checks: "passed",
    });
  });

  it("reads the setup off the decisions and the host off the key", () => {
    const setup = setupOf(setUp(opened()));
    expect(setup.mode).toBe("full");
    expect(setup.onGreen).toBe("merge");
    expect(setup.host).toBe("remote:naiveintent");
    expect(setup.roles.map((one) => one.role)).toEqual([
      "planner",
      "implementor",
    ]);
  });

  it("keeps MANY open asks, in the order they were asked", () => {
    let work = askQuestions(opened(), {
      ask: "ask-1",
      questions: [SETUP[0]],
      at: T(1),
    });
    work = askQuestions(work, {
      ask: "ask-2",
      questions: [{ ...SETUP[1], id: "q-plan" }],
      at: T(2),
    });
    expect(openAsks(work)).toEqual(["ask-1", "ask-2"]);
    work = dropAsk(work, "ask-1", T(3));
    expect(openAsks(work)).toEqual(["ask-2"]);
  });

  it("waits on the human while an ask is open and on the agent after", () => {
    const asked = askQuestions(setUp(opened()), {
      ask: "ask-2",
      questions: [{ ...SETUP[0], id: "q-plan", key: null }],
      at: T(4),
    });
    expect(waitingOn(asked, policyOf(asked))).toBe("you");
    expect(standing(asked, policyOf(asked)).why).toBe("question");
    expect(waitingOnYou([asked])).toBe(1);
    const answered = answerAsk(asked, {
      ask: "ask-2",
      values: new Map([["q-plan", ["full"]]]),
      from: "card",
      at: T(5),
    });
    expect(waitingOn(answered, policyOf(answered))).toBe("agent");
  });

  it("says how a finished work finished, whole", () => {
    const ended = endWork(worked(), {
      outcome: { kind: "stopped", by: "conductor" },
      at: T(9),
    });
    const where = standing(ended, policyOf(ended));
    expect(where).toMatchObject({
      who: "done",
      why: "stopped",
      outcome: { kind: "stopped", by: "conductor" },
      since: T(9),
    });
  });

  it("bounds the agent-state events and counts what it folded", () => {
    let work = opened();
    for (let at = 0; at < AGENT_STATES_KEPT + 5; at += 1) {
      work = recordEvent(work, {
        at: T(at),
        by: "agent",
        kind: AGENT_STATE_KINDS[0],
        terminal: "local/a",
        why: "",
      });
    }
    const states = work.events.filter(
      (one) => one.kind === AGENT_STATE_KINDS[0],
    );
    expect(states.length).toBe(AGENT_STATES_KEPT);
    const folded = work.events.find((one) => one.kind === "folded");
    expect(folded).toMatchObject({ kind: "folded", count: 5 });
  });

  it("measures the time bar and what each step took", () => {
    const work = worked();
    const bar = timeBar(work, policyOf(work), T(10));
    expect(bar.reduce((sum, one) => sum + one.ms, 0)).toBe(10 * 60_000);
    expect(timeSpent(work, policyOf(work), T(10)).ci).toBeGreaterThan(0);
    expect(took(work, T(10)).at(-1)?.open).toBe(true);
  });
});

describe("membership", () => {
  it("indexes the one members map against the open works", () => {
    const work = setUp(opened());
    const index = membershipOf(
      new Map([[ID, work]]),
      new Map([
        ["local/a", member()],
        ["local/b", member({ role: "implementor" })],
      ]),
    );
    expect(index.get("local/a")).toMatchObject({ work: ID, role: "planner" });
    expect(index.get("local/b")?.driver).toBe("conductor");
  });

  it("drops a member whose work has ended", () => {
    const ended = endWork(setUp(opened()), {
      outcome: { kind: "merged", pr: 1 },
      at: T(9),
    });
    expect(
      membershipOf(new Map([[ID, ended]]), new Map([["local/a", member()]]))
        .size,
    ).toBe(0);
  });

  it("hands the keys over and back, per terminal", () => {
    let work = joinWork(setUp(opened()), {
      terminal: "local/a",
      role: "planner",
      at: T(3),
    });
    work = takeOver(work, "local/a", T(4));
    expect(driverOf(work, "local/a", member())).toBe("you");
    work = handBack(work, "local/a", T(5));
    expect(driverOf(work, "local/a", member())).toBe("conductor");
    expect(driverOf(work, "local/a", undefined)).toBeNull();
  });

  it("says a member left without ending anything", () => {
    const left = leaveWork(setUp(opened()), {
      terminal: "local/a",
      why: "gone",
      at: T(6),
    });
    expect(left.state).toEqual({ kind: "open" });
    expect(left.events.at(-1)).toMatchObject({ kind: "left", why: "gone" });
  });

  it("orders the roles without spelling any words", () => {
    expect(roleRank("planner")).toBeLessThan(roleRank("implementor"));
    expect(roleRank("implementor")).toBeLessThan(roleRank("other"));
  });

  it("names a waterfall file without a regex at the call site", () => {
    expect(waterfallFileName(".waterfall/plan.md")).toBe("plan.md");
    expect(waterfallFileName("README.md")).toBe("README.md");
  });
});

describe("the history cap", () => {
  it("keeps every open work and the newest finished ones", () => {
    const rows = [0, 1, 2].map((at): readonly [WorkId, Work] => [
      `branch:local/%2Frepo/b${at}`,
      endWork(opened(), { outcome: { kind: "merged", pr: at }, at: T(at + 5) }),
    ]);
    const open: readonly [WorkId, Work] = [ID, opened()];
    const capped = capFinished([open, ...rows], 2);
    expect(capped.kept.map(([id]) => id)).toEqual([
      ID,
      "branch:local/%2Frepo/b1",
      "branch:local/%2Frepo/b2",
    ]);
    expect(capped.dropped.map(([id]) => id)).toEqual([
      "branch:local/%2Frepo/b0",
    ]);
  });
});
