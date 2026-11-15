import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  harnessForModel,
  isKoluChoice,
  KOLU_CHOICE_KEYS,
  type KoluChoiceKey,
  type KoluChoices,
  koluKeysOf,
  modelHarnessesOf,
  type Question,
  savedModelHarnessesOf,
  setupMemory,
  unofferedAnswers,
  unofferedSaved,
} from "./index.ts";
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
  type StoreFault,
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

const koluQuestion = (id: string, key: KoluChoiceKey, question: string) =>
  ({ id, key, header: "", question, file: "" }) as const;

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
  // kolu's own four: no options to write down.
  koluQuestion("q-ph", "planner.harness", "Planner harness?"),
  koluQuestion("q-pm", "planner.model", "Planner model?"),
  koluQuestion("q-ih", "implementor.harness", "Implementor harness?"),
  koluQuestion("q-im", "implementor.model", "Implementor model?"),
  {
    id: "q-green",
    key: "on-green",
    header: "",
    question: "On green?",
    options: ["merge", "hand-over"],
    multiple: false,
    file: "",
  },
] as const satisfies ReadonlyArray<Question>;

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

  /** The fault a parse refused with — the VALUE, because the SENTENCE is the
   *  showing face's (`kolu-conductor`'s `faultClause`) and this package holds
   *  no English a person reads. */
  const faultOf = (parse: () => unknown): StoreFault => {
    try {
      parse();
    } catch (err) {
      if (err instanceof InvalidWorkStore) return err.fault;
      throw err;
    }
    throw new Error("the parse did not refuse");
  };

  it("refuses a work filed under a key that is not its own identity", () => {
    expect(faultOf(() => parseStore({ "work:random": opened() }, {}))).toEqual({
      kind: "key-mismatch",
      filedAs: "work:random",
      says: ID,
    });
  });

  it("refuses a member of a work that does not exist", () => {
    expect(
      faultOf(() =>
        parseStore(openWorks(), {
          "local/a": member({ work: "branch:x/y/z" }),
        }),
      ),
    ).toEqual({
      kind: "no-such-work",
      terminal: "local/a",
      work: "branch:x/y/z",
    });
  });

  it("refuses a member of a work that has ended", () => {
    const ended = endWork(opened(), {
      outcome: { kind: "merged", pr: 181 },
      at: T(9),
    });
    expect(
      faultOf(() => parseStore({ [ID]: ended }, { "local/a": member() })),
    ).toEqual({
      kind: "work-ended",
      terminal: "local/a",
      title: "Show agent-distro update errors",
    });
  });

  it("refuses two terminals in one role", () => {
    expect(
      faultOf(() =>
        parseStore(openWorks(), {
          "local/a": member(),
          "local/b": member(),
        }),
      ),
    ).toEqual({
      kind: "role-taken",
      title: "Show agent-distro update errors",
      role: "planner",
      held: "local/a",
      second: "local/b",
    });
  });

  it("throws a value a face can act on", () => {
    try {
      parseStore({ "work:random": opened() }, {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidWorkStore);
      // NO SENTENCE on the class: the kind is what a face branches on, and
      // the words it shows are its own.
      expect((err as InvalidWorkStore).fault.kind).toBe("key-mismatch");
    }
  });
});

describe("kolu's own setup questions — the harness and the model", () => {
  const CHOICES: KoluChoices = {
    harnesses: ["omp", "claude"],
    models: new Map([
      [
        "omp",
        {
          kind: "listed",
          ids: ["anthropic/claude-fable-5-2", "litellm/claude-fable-5-2"],
        },
      ],
      ["claude", { kind: "unlisted" }],
    ]),
  };
  const asked = (): Work =>
    askQuestions(opened(), { ask: "ask-1", questions: SETUP, at: T(1) });

  it("stores no options for them, so a model list is never a copy in the record", () => {
    const work = asked();
    const kolus = work.decisions.filter((one) => isKoluChoice(one));
    expect(kolus.map((one) => one.key)).toEqual([...KOLU_CHOICE_KEYS]);
    for (const one of kolus) {
      expect(one).not.toHaveProperty("options");
      expect(one).not.toHaveProperty("multiple");
    }
    // ... the record decodes as the schema says, and a stored list a reader
    // is handed anyway has nowhere to land: it is not part of the value.
    expect(Schema.decodeUnknownSync(WorkSchema)(work)).toEqual(work);
    const smuggled = Schema.decodeUnknownSync(WorkSchema)({
      ...work,
      decisions: work.decisions.map((one) =>
        isKoluChoice(one) ? { ...one, options: ["omp"], multiple: false } : one,
      ),
    });
    for (const one of smuggled.decisions.filter((d) => isKoluChoice(d)))
      expect(one).not.toHaveProperty("options");
  });

  it("reads a model's harness off the same form, else off the work", () => {
    const work = asked();
    expect(
      harnessForModel(
        work,
        "ask-1",
        "planner.model",
        new Map([["q-ph", ["claude"]]]),
      ),
    ).toBe("claude");
    expect(
      harnessForModel(work, "ask-1", "planner.model", new Map()),
    ).toBeNull();
    // A later ask about the model alone reads the harness already decided.
    const later = askQuestions(setUp(opened()), {
      ask: "ask-2",
      questions: [koluQuestion("q-pm2", "planner.model", "Model?")],
      at: T(3),
    });
    expect(harnessForModel(later, "ask-2", "planner.model", new Map())).toBe(
      "omp",
    );
  });

  it("finds every answer that is not one of kolu's options, and passes the ones that are", () => {
    const work = asked();
    const values = new Map<string, ReadonlyArray<string>>([
      ["q-ph", ["omp"]],
      ["q-pm", ["anthropic/claude-fable-5-2"]],
      ["q-ih", ["claude"]],
      // A harness that cannot list takes whatever model the person names.
      ["q-im", ["claude-opus-4-6"]],
    ]);
    expect(modelHarnessesOf(work, "ask-1", values)).toEqual(["omp", "claude"]);
    expect(unofferedAnswers(work, "ask-1", values, CHOICES)).toEqual([]);

    const bad = new Map<string, ReadonlyArray<string>>([
      ["q-ph", ["codex"]],
      ["q-ih", ["omp"]],
      ["q-im", ["claude-fable-5-1"]],
    ]);
    expect(unofferedAnswers(work, "ask-1", bad, CHOICES)).toEqual([
      { key: "planner.harness", value: "codex", why: "not-installed" },
      {
        key: "implementor.model",
        value: "claude-fable-5-1",
        why: "not-listed",
        harness: "omp",
      },
    ]);
    expect(
      unofferedAnswers(
        work,
        "ask-1",
        new Map([["q-pm", ["anthropic/claude-fable-5-2"]]]),
        CHOICES,
      ),
    ).toEqual([
      {
        key: "planner.model",
        value: "anthropic/claude-fable-5-2",
        why: "no-harness",
      },
    ]);
  });

  it("takes only a model id for a harness that cannot list — one word, no spaces", () => {
    const work = asked();
    const values = new Map<string, ReadonlyArray<string>>([
      ["q-ih", ["claude"]],
      ["q-im", ["fable 5.2"]],
    ]);
    expect(unofferedAnswers(work, "ask-1", values, CHOICES)).toEqual([
      {
        key: "implementor.model",
        value: "fable 5.2",
        why: "not-a-model-id",
        harness: "claude",
      },
    ]);
  });

  it("judges SAVED answers by the same rule — what a start and `work_open` read", () => {
    // The human's store: a model typed as words before kolu drew these
    // options, and one the harness no longer lists.
    const saved = answerAsk(asked(), {
      ask: "ask-1",
      at: T(2),
      from: "card",
      values: new Map([
        ["q-ph", ["claude"]],
        ["q-pm", ["fable 5.2"]],
        ["q-ih", ["omp"]],
        ["q-im", ["claude-opus-5-5"]],
      ]),
    });
    expect(
      savedModelHarnessesOf(saved, KOLU_CHOICE_KEYS, CHOICES.harnesses),
    ).toEqual(["claude", "omp"]);
    expect(unofferedSaved(saved, koluKeysOf("planner"), CHOICES)).toEqual([
      {
        key: "planner.model",
        value: "fable 5.2",
        why: "not-a-model-id",
        harness: "claude",
      },
    ]);
    expect(unofferedSaved(saved, koluKeysOf("implementor"), CHOICES)).toEqual([
      {
        key: "implementor.model",
        value: "claude-opus-5-5",
        why: "not-listed",
        harness: "omp",
      },
    ]);
    // A harness this kolu stopped carrying takes its model down with it.
    expect(
      unofferedSaved(saved, koluKeysOf("planner"), {
        harnesses: ["omp"],
        models: CHOICES.models,
      }).map((one) => one.why),
    ).toEqual(["not-installed", "no-harness"]);
  });

  it("records an answer to one of them as the one value picked", () => {
    const work = answerAsk(asked(), {
      ask: "ask-1",
      at: T(2),
      from: "card",
      values: new Map([["q-im", ["claude-opus-4-6"]]]),
    });
    const model = work.decisions.find((one) => one.id === "q-im");
    expect(model?.kind === "answered" ? model.answer : null).toMatchObject({
      picked: ["claude-opus-4-6"],
      text: null,
    });
  });

  it("remembers the last answers from the SAVED works — per host, a model per harness", () => {
    const elsewhere: WorkKey = { ...KEY, host: "local", branch: "other" };
    const answered = (key: WorkKey, at: number, models: [string, string]) =>
      answerAsk(
        askQuestions(opened(key), {
          ask: "ask-1",
          questions: SETUP,
          at: T(at),
        }),
        {
          ask: "ask-1",
          at: T(at + 1),
          from: "card",
          values: new Map([
            ["q-mode", ["full"]],
            ["q-ph", ["omp"]],
            ["q-pm", [models[0]]],
            ["q-ih", ["claude"]],
            ["q-im", [models[1]]],
            ["q-green", ["hand-over"]],
          ]),
        },
      );
    const works = [
      answered(KEY, 1, ["anthropic/claude-fable-5-1", "claude-opus-4-5"]),
      answered({ ...KEY, branch: "newer" }, 10, [
        "anthropic/claude-fable-5-2",
        "claude-opus-4-6",
      ]),
      answered(elsewhere, 20, ["litellm/open-large", "claude-sonnet-4-6"]),
    ];
    const memory = setupMemory(works, KEY.host);
    expect(memory.last("planner.harness", null)).toBe("omp");
    expect(memory.last("on-green", null)).toBe("hand-over");
    // The newest on THIS host, not the newest anywhere.
    expect(memory.last("planner.model", "omp")).toBe(
      "anthropic/claude-fable-5-2",
    );
    // A model is a model of its harness, whichever role ran it.
    expect(memory.last("planner.model", "claude")).toBe("claude-opus-4-6");
    expect(memory.last("implementor.model", "codex")).toBeNull();
    // What a harness that cannot list offers: every model it ran, newest first.
    expect(memory.modelsUsed("claude")).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "claude-opus-4-5",
    ]);
  });

  it("gives each ROLE its own last model on a harness both run", () => {
    // Plans on one model, implements on another, one harness: each role gets
    // its own back, so pressing Answer unchanged repeats the setup.
    const work = answerAsk(asked(), {
      ask: "ask-1",
      at: T(2),
      from: "card",
      values: new Map([
        ["q-ph", ["omp"]],
        ["q-pm", ["anthropic/claude-fable-5-2"]],
        ["q-ih", ["omp"]],
        ["q-im", ["litellm/claude-fable-5-2"]],
      ]),
    });
    const memory = setupMemory([work], KEY.host);
    expect(memory.last("planner.model", "omp")).toBe(
      "anthropic/claude-fable-5-2",
    );
    expect(memory.last("implementor.model", "omp")).toBe(
      "litellm/claude-fable-5-2",
    );
    // A role that never ran that harness falls back to the model another
    // role ran it on.
    const plannerOnly = answerAsk(asked(), {
      ask: "ask-1",
      at: T(2),
      from: "card",
      values: new Map([
        ["q-ph", ["omp"]],
        ["q-pm", ["anthropic/claude-fable-5-2"]],
      ]),
    });
    expect(
      setupMemory([plannerOnly], KEY.host).last("implementor.model", "omp"),
    ).toBe("anthropic/claude-fable-5-2");
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

  it("has no second answer for a question kolu draws the options for", () => {
    const decode = Schema.decodeUnknownResult(WorkSchema);
    const answer = { at: T(2), how: "answered", from: "card" };
    const harness = (over: object) => ({
      ...opened(),
      decisions: [
        {
          kind: "answered",
          id: "q-ph",
          ask: "ask-1",
          at: T(1),
          key: "planner.harness",
          header: "",
          question: "Which harness?",
          file: "",
          answer: { ...answer, ...over },
        },
      ],
    });
    // A role run on two harnesses, or one picked with words beside it, is
    // not a value — whoever wrote it.
    expect(
      decode(harness({ picked: ["omp", "claude"], text: null }))._tag,
    ).toBe("Failure");
    expect(decode(harness({ picked: ["omp"], text: "codex" }))._tag).toBe(
      "Failure",
    );
    expect(decode(harness({ picked: [], text: "omp" }))._tag).toBe("Failure");
    // One value, or none, is.
    expect(decode(harness({ picked: ["omp"], text: null }))._tag).toBe(
      "Success",
    );
    expect(decode(harness({ picked: [], text: null }))._tag).toBe("Success");
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
