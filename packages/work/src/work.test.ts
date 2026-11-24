import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ABOUT_WORK,
  aboutMember,
  AGENT_STATE_KINDS,
  AGENT_STATES_KEPT,
  answerAsk,
  askedAnswersOf,
  askQuestions,
  capFinished,
  childFolderOf,
  compareWaterfallPaths,
  type DecisionAnswer,
  driverOf,
  dropAsk,
  dropQuestions,
  endWork,
  givenAnswersOf,
  handBack,
  harnessForModel,
  InvalidWorkStore,
  isAsked,
  isKoluChoice,
  isSettled,
  joinWork,
  keepFailed,
  keepFiles,
  keysToAsk,
  KOLU_CHOICE_KEYS,
  type KoluChoiceKey,
  type KoluChoices,
  koluKeysOf,
  leaveWork,
  membershipOf,
  missingSetup,
  modelHarnessesOf,
  notKeptOf,
  openAsks,
  openSetupQuestions,
  openWork,
  parseStore,
  policyOf,
  prOf,
  type Question,
  recordEvent,
  reopenWork,
  roleRank,
  savedAnswersOf,
  SETUP_KEYS,
  type SentAnswer,
  type SetupAsk,
  setupMemory,
  setupOf,
  setupStanding,
  setupValue,
  standing,
  startBlockers,
  type StoreFault,
  takeOver,
  timeSpent,
  took,
  unofferedAnswers,
  needsYou,
  WAITER_OF,
  waitingOn,
  WATERFALL_DIR,
  waterfallBytes,
  waterfallFileName,
  waterfallLevel,
  type Work,
  type WorkId,
  type WorkKey,
  type WorkMember,
  WorkSchema,
  workIdOf,
  workKeyOf,
} from "./index.ts";

const T = (minute: number): string =>
  new Date(Date.UTC(2026, 10, 14, 10, minute)).toISOString();

/** The value a reading found, or a failure naming the reading that found
 *  nothing — what a test asserts on now that a lookup answers an `Option`. */
const got = <A>(found: Option.Option<A>): A => Option.getOrThrow(found);

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
    request: { kind: "said", text: "waterfall ~/code/kolu — show the error" },
  });

const koluQuestion = (id: string, key: KoluChoiceKey, question: string) =>
  ({ id, topic: "setup", key, question, given: { kind: "ask" } }) as const;

const SETUP = [
  {
    id: "q-mode",
    topic: "setup",
    key: "mode",
    question: "Which mode?",
    options: ["full", "trivial"],
    given: { kind: "ask" },
  },
  // kolu's own four: no options to write down.
  koluQuestion("q-ph", "planner.harness", "Planner harness?"),
  koluQuestion("q-pm", "planner.model", "Planner model?"),
  koluQuestion("q-ih", "implementor.harness", "Implementor harness?"),
  koluQuestion("q-im", "implementor.model", "Implementor model?"),
  {
    id: "q-green",
    topic: "setup",
    key: "on-green",
    question: "On green?",
    options: ["merge", "hand-over"],
    given: { kind: "ask" },
  },
] as const satisfies ReadonlyArray<Question>;

/** A question about the WORK — the asker's own, with its header, options and
 *  the file it is about. */
const aboutWork = (
  id: string,
  question: string,
  options: ReadonlyArray<string> = ["yes", "no"],
): Question => ({
  id,
  topic: "work",
  question,
  header: { kind: "none" },
  options,
  multiple: false,
  file: { kind: "none" },
});

const ALL_SETUP: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ["q-mode", ["full"]],
  ["q-ph", ["omp"]],
  ["q-pm", ["fable"]],
  ["q-ih", ["omp"]],
  ["q-im", ["opus"]],
  ["q-green", ["merge"]],
]);

const askSetup = (work: Work): Work =>
  askQuestions(work, { ask: "ask-1", questions: SETUP, at: T(1) });

const setUp = (work: Work): Work =>
  answerAsk(askSetup(work), {
    ask: "ask-1",
    at: T(2),
    from: "card",
    reply: { kind: "answered", values: ALL_SETUP },
  });

const member = (over: Partial<WorkMember> = {}): WorkMember => ({
  work: ID,
  role: "planner",
  joinedAt: T(3),
  worktree: { kind: "unread" },
  ...over,
});

describe("a work IS its key", () => {
  it("encodes and decodes a branch key, separators and all", () => {
    expect(ID).toBe(
      "branch:remote%3Anaiveintent/%2Fhome%2Fme%2Fcode%2Fkolu/agent-distro-update-errors",
    );
    expect(got(workKeyOf(ID))).toEqual(KEY);
  });

  it("is injective — two keys never share an id", () => {
    const sneaky: WorkKey = {
      kind: "branch",
      host: "remote:naiveintent",
      repo: "/home/me/code",
      branch: "kolu/agent-distro-update-errors",
    };
    expect(workIdOf(sneaky)).not.toBe(ID);
    expect(got(workKeyOf(workIdOf(sneaky)))).toEqual(sneaky);
  });

  it("encodes and decodes a watch key", () => {
    const key: WorkKey = { kind: "watch", terminal: "local/abc-123" };
    expect(got(workKeyOf(workIdOf(key)))).toEqual(key);
  });

  it("answers nothing for a string that is no work id", () => {
    expect(Option.isNone(workKeyOf("w1"))).toBe(true);
    expect(Option.isNone(workKeyOf("branch:host//branch"))).toBe(true);
    // A pasted link with a broken escape is refused, never thrown.
    expect(Option.isNone(workKeyOf("branch:local/%E0%A4%A/b"))).toBe(true);
  });

  it("reads the host off the key, with no decision involved", () => {
    expect(setupOf(opened()).host).toBe("remote:naiveintent");
    expect(SETUP_KEYS).not.toContain("host");
    expect(
      missingSetup([
        {
          key: "mode",
          question: "?",
          options: ["full"],
          given: { kind: "ask" },
        },
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
  const asked = (): Work => askSetup(opened());

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
      got(
        harnessForModel(
          work,
          "ask-1",
          "planner.model",
          new Map([["q-ph", ["claude"]]]),
        ),
      ),
    ).toBe("claude");
    expect(
      Option.isNone(harnessForModel(work, "ask-1", "planner.model", new Map())),
    ).toBe(true);
    // A later ask about the model alone reads the harness already decided.
    const later = askQuestions(setUp(opened()), {
      ask: "ask-2",
      questions: [koluQuestion("q-pm2", "planner.model", "Model?")],
      at: T(3),
    });
    expect(
      got(harnessForModel(later, "ask-2", "planner.model", new Map())),
    ).toBe("omp");
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
    const answers = askedAnswersOf(work, "ask-1", values);
    expect(modelHarnessesOf(answers)).toEqual(["omp", "claude"]);
    expect(unofferedAnswers(answers, CHOICES)).toEqual([]);

    const bad = new Map<string, ReadonlyArray<string>>([
      ["q-ph", ["codex"]],
      ["q-ih", ["omp"]],
      ["q-im", ["claude-fable-5-1"]],
    ]);
    expect(
      unofferedAnswers(askedAnswersOf(work, "ask-1", bad), CHOICES),
    ).toEqual([
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
        askedAnswersOf(
          work,
          "ask-1",
          new Map([["q-pm", ["anthropic/claude-fable-5-2"]]]),
        ),
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
    expect(
      unofferedAnswers(askedAnswersOf(work, "ask-1", values), CHOICES),
    ).toEqual([
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
      reply: {
        kind: "answered",
        values: new Map([
          ["q-ph", ["claude"]],
          ["q-pm", ["fable 5.2"]],
          ["q-ih", ["omp"]],
          ["q-im", ["claude-opus-5-5"]],
        ]),
      },
    });
    expect(modelHarnessesOf(savedAnswersOf(saved, KOLU_CHOICE_KEYS))).toEqual([
      "claude",
      "omp",
    ]);
    expect(
      unofferedAnswers(savedAnswersOf(saved, koluKeysOf("planner")), CHOICES),
    ).toEqual([
      {
        key: "planner.model",
        value: "fable 5.2",
        why: "not-a-model-id",
        harness: "claude",
      },
    ]);
    expect(
      unofferedAnswers(
        savedAnswersOf(saved, koluKeysOf("implementor")),
        CHOICES,
      ),
    ).toEqual([
      {
        key: "implementor.model",
        value: "claude-opus-5-5",
        why: "not-listed",
        harness: "omp",
      },
    ]);
    // A harness this kolu stopped carrying takes its model down with it.
    expect(
      unofferedAnswers(savedAnswersOf(saved, koluKeysOf("planner")), {
        harnesses: ["omp"],
        models: CHOICES.models,
      }).map((one) => one.why),
    ).toEqual(["not-installed", "no-harness"]);
    // ... and a model the REQUEST gives is of the harness given beside it,
    // else of the one the work recorded.
    expect(
      givenAnswersOf(
        [{ key: "planner.model", value: "x" }],
        Option.some(saved),
      ),
    ).toEqual([
      {
        key: "planner.model",
        values: ["x"],
        chosen: "picked",
        harness: Option.some("claude"),
      },
    ]);
    expect(
      got(
        got(
          Option.fromUndefinedOr(
            givenAnswersOf(
              [
                { key: "planner.harness", value: "omp" },
                { key: "planner.model", value: "x" },
              ],
              Option.some(saved),
            )[1],
          ),
        ).harness,
      ),
    ).toBe("omp");
  });

  it("records an answer to one of them as the one value, with no words beside it", () => {
    const work = answerAsk(asked(), {
      ask: "ask-1",
      at: T(2),
      from: "card",
      reply: {
        kind: "answered",
        values: new Map([["q-im", ["claude-opus-4-6"]]]),
      },
    });
    const model = work.decisions.find((one) => one.id === "q-im");
    expect(model !== undefined && isSettled(model) ? model.answer : {}).toEqual(
      {
        how: "answered",
        at: T(2),
        from: "card",
        value: "claude-opus-4-6",
        chosen: "picked",
      },
    );
    expect(got(setupValue(work, "implementor.model"))).toBe("claude-opus-4-6");
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
          reply: {
            kind: "answered",
            values: new Map([
              ["q-mode", ["full"]],
              ["q-ph", ["omp"]],
              ["q-pm", [models[0]]],
              ["q-ih", ["claude"]],
              ["q-im", [models[1]]],
              ["q-green", ["hand-over"]],
            ]),
          },
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
    expect(got(memory.last("planner.harness", Option.none())).value).toBe(
      "omp",
    );
    expect(got(memory.last("on-green", Option.none())).value).toBe("hand-over");
    // The newest on THIS host, not the newest anywhere.
    expect(got(memory.last("planner.model", Option.some("omp"))).value).toBe(
      "anthropic/claude-fable-5-2",
    );
    // A model is a model of its harness, whichever role ran it.
    expect(got(memory.last("planner.model", Option.some("claude"))).value).toBe(
      "claude-opus-4-6",
    );
    expect(
      Option.isNone(memory.last("implementor.model", Option.some("codex"))),
    ).toBe(true);
    // What a harness that cannot list offers: every model it ran, newest
    // first, each as it was chosen.
    expect(memory.modelsUsed("claude")).toEqual([
      { value: "claude-sonnet-4-6", chosen: "picked" },
      { value: "claude-opus-4-6", chosen: "picked" },
      { value: "claude-opus-4-5", chosen: "picked" },
    ]);
  });

  it("remembers a TYPED model as typed, and offers it back that way", () => {
    const work = answerAsk(asked(), {
      ask: "ask-1",
      at: T(2),
      from: "card",
      reply: {
        kind: "answered",
        values: new Map<string, SentAnswer>([
          ["q-ph", ["omp"]],
          ["q-pm", { typed: "opus" }],
        ]),
      },
    });
    const memory = setupMemory([work], KEY.host);
    expect(memory.last("planner.model", Option.some("omp"))).toEqual(
      Option.some({ value: "opus", chosen: "typed" }),
    );
    expect(memory.modelsUsed("omp")).toEqual([
      { value: "opus", chosen: "typed" },
    ]);
    // ... and the rule holds it to no list: `opus` is not one omp lists.
    expect(
      unofferedAnswers(savedAnswersOf(work, ["planner.model"]), {
        harnesses: ["omp"],
        models: new Map(),
      }),
    ).toEqual([]);
  });

  it("gives each ROLE its own last model on a harness both run", () => {
    // Plans on one model, implements on another, one harness: each role gets
    // its own back, so pressing Answer unchanged repeats the setup.
    const work = answerAsk(asked(), {
      ask: "ask-1",
      at: T(2),
      from: "card",
      reply: {
        kind: "answered",
        values: new Map([
          ["q-ph", ["omp"]],
          ["q-pm", ["anthropic/claude-fable-5-2"]],
          ["q-ih", ["omp"]],
          ["q-im", ["litellm/claude-fable-5-2"]],
        ]),
      },
    });
    const memory = setupMemory([work], KEY.host);
    expect(got(memory.last("planner.model", Option.some("omp"))).value).toBe(
      "anthropic/claude-fable-5-2",
    );
    expect(
      got(memory.last("implementor.model", Option.some("omp"))).value,
    ).toBe("litellm/claude-fable-5-2");
    // A role that never ran that harness falls back to the model another
    // role ran it on.
    const plannerOnly = answerAsk(asked(), {
      ask: "ask-1",
      at: T(2),
      from: "card",
      reply: {
        kind: "answered",
        values: new Map([
          ["q-ph", ["omp"]],
          ["q-pm", ["anthropic/claude-fable-5-2"]],
        ]),
      },
    });
    expect(
      got(
        setupMemory([plannerOnly], KEY.host).last(
          "implementor.model",
          Option.some("omp"),
        ),
      ).value,
    ).toBe("anthropic/claude-fable-5-2");
  });
});

describe("an answer HAS a value — the states that cannot be written down", () => {
  const decode = Schema.decodeUnknownSync(WorkSchema);

  /** The human's stored bytes, as the new shape would try to hold them: one
   *  decision on an otherwise ordinary work. */
  const stored = (decision: object): object => ({
    ...opened(),
    decisions: [decision],
  });

  const koluChoice = (answer: object): object =>
    stored({
      kind: "settled",
      id: "q-ph",
      ask: "ask-1",
      at: T(1),
      topic: "setup",
      key: "planner.harness",
      question: "Which harness?",
      answer,
    });

  const aboutTheWork = (answer: object): object =>
    stored({
      kind: "settled",
      id: "q-plan",
      ask: "ask-1",
      at: T(1),
      topic: "work",
      question: "Does the plan look right?",
      header: { kind: "none" },
      options: ["yes", "no"],
      multiple: false,
      file: { kind: "none" },
      answer,
    });

  it("does not decode a kolu-choice decision answered with nothing", () => {
    // THE BUG, as bytes: "answered", from a face, and no answer in it.
    expect(() =>
      decode(koluChoice({ how: "answered", at: T(2), from: "chat" })),
    ).toThrow();
    expect(() =>
      decode(
        koluChoice({ how: "answered", at: T(2), from: "chat", value: "" }),
      ),
    ).toThrow();
    // ... while the same decision WITH a value is a value.
    expect(
      decode(
        koluChoice({
          how: "answered",
          at: T(2),
          from: "chat",
          value: "omp",
          chosen: "picked",
        }),
      ),
    ).toMatchObject({
      decisions: [{ kind: "settled", answer: { value: "omp" } }],
    });
  });

  it("does not decode a question about the work answered with nothing said", () => {
    expect(() =>
      decode(
        aboutTheWork({
          how: "answered",
          at: T(2),
          from: "card",
          said: { kind: "picked", picked: [] },
        }),
      ),
    ).toThrow();
    expect(() =>
      decode(
        aboutTheWork({
          how: "answered",
          at: T(2),
          from: "card",
          said: { kind: "typed", text: "" },
        }),
      ),
    ).toThrow();
    expect(() =>
      decode(
        aboutTheWork({
          how: "answered",
          at: T(2),
          from: "card",
          said: { kind: "typed", text: "  " },
        }),
      ),
    ).toThrow();
    expect(
      decode(
        aboutTheWork({
          how: "answered",
          at: T(2),
          from: "card",
          said: { kind: "picked", picked: ["yes"] },
        }),
      ),
    ).toMatchObject({
      decisions: [{ answer: { said: { picked: ["yes"] } } }],
    });
  });

  it("does not decode a mode answered with words that are not kolu's", () => {
    expect(() =>
      decode(
        stored({
          kind: "settled",
          id: "q-mode",
          ask: "ask-1",
          at: T(1),
          topic: "setup",
          key: "mode",
          question: "Which mode?",
          options: ["full", "trivial"],
          answer: {
            how: "answered",
            at: T(2),
            from: "card",
            value: "the full thing",
          },
        }),
      ),
    ).toThrow();
  });

  it("cannot be constructed either — an answer with no value is not a type", () => {
    // @ts-expect-error — `answered` carries its value; there is no arm without one.
    const noAnswer: DecisionAnswer = {
      how: "answered",
      at: T(2),
      from: "chat",
    };
    expect(noAnswer.how).toBe("answered");
  });

  it("has no `abandoned` outcome to decode", () => {
    expect(() =>
      decode({
        ...opened(),
        state: {
          kind: "ended",
          at: T(9),
          outcome: { kind: "abandoned" },
          kept: [],
        },
      }),
    ).toThrow();
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
    expect(() =>
      decode({
        ...opened(),
        events: [
          {
            at: T(5),
            by: "ci",
            kind: "checks-passed",
            about: { kind: "work" },
            head: { kind: "commit", sha: "abc" },
            failing: [],
          },
        ],
      }),
    ).toThrow();
  });

  it("is asked OR settled, and settled carries how", () => {
    const asked = askQuestions(opened(), {
      ask: "ask-1",
      questions: [SETUP[0]],
      at: T(1),
    });
    expect(asked.decisions.every(isAsked)).toBe(true);
    const answered = answerAsk(asked, {
      ask: "ask-1",
      at: T(2),
      from: "card",
      reply: { kind: "answered", values: new Map([["q-mode", ["full"]]]) },
    });
    const one = answered.decisions[0];
    expect(one !== undefined && isSettled(one) && one.answer.how).toBe(
      "answered",
    );
  });
});

describe("a question left blank stays asked", () => {
  const blank = (): Work => {
    const values = new Map(ALL_SETUP);
    values.delete("q-pm");
    return answerAsk(askSetup(opened()), {
      ask: "ask-1",
      at: T(2),
      from: "card",
      reply: { kind: "answered", values },
    });
  };

  it("records the ones filled in and leaves the blank one asked, in the same ask", () => {
    const work = blank();
    const stillAsked = work.decisions.filter(isAsked);
    expect(stillAsked.map((one) => one.id)).toEqual(["q-pm"]);
    expect(stillAsked[0]?.ask).toBe("ask-1");
    expect(work.decisions.filter(isSettled).map((one) => one.id)).toEqual([
      "q-mode",
      "q-ph",
      "q-ih",
      "q-im",
      "q-green",
    ]);
    expect(got(setupValue(work, "mode"))).toBe("full");
    expect(got(setupValue(work, "implementor.model"))).toBe("opus");
    expect(Option.isNone(setupValue(work, "planner.model"))).toBe(true);
  });

  it("says PART of the ask was answered, and still waits on the human", () => {
    const work = blank();
    expect(work.events.at(-1)).toMatchObject({
      kind: "answered-part",
      ask: "ask-1",
    });
    expect(openAsks(work)).toEqual(["ask-1"]);
    expect(setupStanding(work, "planner.model")).toEqual({
      kind: "open",
      ask: "ask-1",
    });
    expect(waitingOn(work, policyOf(work))).toBe("you");
    expect(standing(work, policyOf(work))).toMatchObject({
      why: "question",
      question: "Planner model?",
    });
  });

  it("closes the ask once the blank one is answered too", () => {
    const work = answerAsk(blank(), {
      ask: "ask-1",
      at: T(3),
      from: "card",
      reply: { kind: "answered", values: new Map([["q-pm", ["fable"]]]) },
    });
    expect(work.events.at(-1)).toMatchObject({
      kind: "answered",
      ask: "ask-1",
    });
    expect(openAsks(work)).toEqual([]);
    expect(setupStanding(work, "planner.model")).toEqual({
      kind: "answered",
      value: "fable",
    });
    expect(waitingOn(work, policyOf(work))).toBe("agent");
    expect(standing(work, policyOf(work)).why).not.toBe("question");
  });

  it("changes nothing at all when the reply settles nothing", () => {
    const work = blank();
    expect(
      answerAsk(work, {
        ask: "ask-1",
        at: T(3),
        from: "card",
        reply: { kind: "answered", values: new Map([["q-pm", [""]]]) },
      }),
    ).toBe(work);
    expect(
      answerAsk(work, {
        ask: "ask-1",
        at: T(3),
        from: "card",
        reply: { kind: "answered", values: new Map() },
      }),
    ).toBe(work);
    // ... including a reply to an ask whose every question is settled.
    const done = setUp(opened());
    expect(
      answerAsk(done, {
        ask: "ask-1",
        at: T(3),
        from: "card",
        reply: { kind: "declined" },
      }),
    ).toBe(done);
  });

  it("declines everything that is still open, from the face it came from", () => {
    const work = answerAsk(blank(), {
      ask: "ask-1",
      at: T(4),
      from: "chat",
      reply: { kind: "declined" },
    });
    expect(work.decisions.filter(isAsked)).toEqual([]);
    const declined = work.decisions.find((one) => one.id === "q-pm");
    expect(
      declined !== undefined && isSettled(declined) ? declined.answer : {},
    ).toEqual({ how: "declined", at: T(4), from: "chat" });
    // The ones already answered keep their answers and their own face.
    const mode = work.decisions.find((one) => one.id === "q-mode");
    expect(
      mode !== undefined && isSettled(mode) ? mode.answer : {},
    ).toMatchObject({ how: "answered", from: "card", value: "full" });
    expect(work.events.at(-1)).toMatchObject({
      kind: "answered",
      ask: "ask-1",
    });
    expect(openAsks(work)).toEqual([]);
  });

  it("drops only the questions named, and says so only for an ask left empty", () => {
    const work = askSetup(opened());
    const one = dropQuestions(work, new Set(["q-pm"]), T(3));
    expect(one.decisions.filter(isAsked).map((d) => d.id)).toEqual([
      "q-mode",
      "q-ph",
      "q-ih",
      "q-im",
      "q-green",
    ]);
    expect(one.events.some((e) => e.kind === "question-dropped")).toBe(false);
    expect(openAsks(one)).toEqual(["ask-1"]);
    expect(setupStanding(one, "planner.model")).toEqual({ kind: "unasked" });
    // ... and the last of them takes the ask with it.
    const rest = dropQuestions(
      one,
      openSetupQuestions(one, [...SETUP_KEYS]),
      T(4),
    );
    expect(rest.decisions.filter(isAsked)).toEqual([]);
    expect(
      rest.events.filter((e) => e.kind === "question-dropped").length,
    ).toBe(1);
    expect(openAsks(rest)).toEqual([]);
  });
});

describe("what starting waits on, and what a new form asks", () => {
  it("names a key that is in front of the human and one that is asked of nobody", () => {
    const nothing = opened();
    expect(startBlockers(nothing, "planner")).toEqual([
      { key: "mode", standing: { kind: "unasked" } },
      { key: "planner.harness", standing: { kind: "unasked" } },
      { key: "planner.model", standing: { kind: "unasked" } },
    ]);
    const asked = askSetup(nothing);
    expect(startBlockers(asked, "planner")).toEqual([
      { key: "mode", standing: { kind: "open", ask: "ask-1" } },
      { key: "planner.harness", standing: { kind: "open", ask: "ask-1" } },
      { key: "planner.model", standing: { kind: "open", ask: "ask-1" } },
    ]);
    // A declined question waits on nobody — only `work_open` puts it again.
    const declined = answerAsk(asked, {
      ask: "ask-1",
      at: T(2),
      from: "card",
      reply: { kind: "declined" },
    });
    expect(
      startBlockers(declined, "planner").map((one) => one.standing),
    ).toEqual([{ kind: "unasked" }, { kind: "unasked" }, { kind: "unasked" }]);
    expect(startBlockers(setUp(opened()), "planner")).toEqual([]);
  });

  it("asks every key with no value, open ones included, and the reasked", () => {
    const keys = [...SETUP_KEYS];
    expect(keysToAsk(Option.none(), keys, new Set())).toEqual(keys);
    const asked = askSetup(opened());
    expect(keysToAsk(Option.some(asked), keys, new Set())).toEqual(keys);
    const done = setUp(opened());
    expect(keysToAsk(Option.some(done), keys, new Set())).toEqual([]);
    expect(
      keysToAsk(Option.some(done), keys, new Set(["planner.model"])),
    ).toEqual(["planner.model"]);
    // The open questions the new form takes the place of.
    expect(openSetupQuestions(asked, ["mode", "planner.model"])).toEqual(
      new Set(["q-mode", "q-pm"]),
    );
    expect(openSetupQuestions(done, keys)).toEqual(new Set());
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
        about: ABOUT_WORK,
        request: {
          kind: "said",
          text: "waterfall ~/code/kolu — show the error",
        },
      },
    ]);
  });

  it("opens off something else with no words, rather than empty ones", () => {
    const work = openWork({
      key: { kind: "watch", terminal: "local/abc" },
      title: "A terminal",
      at: T(0),
      request: { kind: "none" },
    });
    expect(work.events[0]).toMatchObject({
      kind: "requested",
      request: { kind: "none" },
    });
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
    expect(WAITER_OF[standing(again, policyOf(again)).why]).not.toBe("done");
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
      about: aboutMember("local/a"),
      pr: 181,
      title: "The docs are 24 pages",
      url: { kind: "link", href: "https://github.com/juspay/kolu/pull/181" },
      draft: "ready",
    });
    work = recordEvent(work, {
      at: T(5),
      by: "ci",
      kind: "checks-running",
      about: ABOUT_WORK,
      pr: 181,
      head: { kind: "commit", sha: "abc1234" },
      failing: [],
    });
    return recordEvent(work, {
      at: T(6),
      by: "ci",
      kind: "checks-passed",
      about: ABOUT_WORK,
      pr: 181,
      head: { kind: "commit", sha: "abc1234" },
      failing: [],
    });
  };

  it("reads the PR off typed events rather than prose", () => {
    expect(got(prOf(worked()))).toMatchObject({
      number: 181,
      state: "open",
      checks: "passed",
      link: { kind: "link", href: "https://github.com/juspay/kolu/pull/181" },
      merge: { kind: "unknown" },
    });
    expect(Option.isNone(prOf(opened()))).toBe(true);
  });

  it("reads the setup off the decisions and the host off the key", () => {
    const setup = setupOf(setUp(opened()));
    expect(got(setup.mode)).toBe("full");
    expect(got(setup.onGreen)).toBe("merge");
    expect(setup.host).toBe("remote:naiveintent");
    expect(setup.roles).toEqual([
      {
        role: "planner",
        setup: { kind: "harness-and-model", harness: "omp", model: "fable" },
      },
      {
        role: "implementor",
        setup: { kind: "harness-and-model", harness: "omp", model: "opus" },
      },
    ]);
  });

  it("says a role whose questions are still open has chosen nothing", () => {
    const asked = askSetup(opened());
    // No mode, so no roles to read a setup for at all.
    expect(setupOf(asked).roles).toEqual([]);
    expect(Option.isNone(setupOf(asked).mode)).toBe(true);
    const modeOnly = answerAsk(asked, {
      ask: "ask-1",
      at: T(2),
      from: "card",
      reply: { kind: "answered", values: new Map([["q-mode", ["trivial"]]]) },
    });
    expect(setupOf(modeOnly).roles).toEqual([
      { role: "implementor", setup: { kind: "not-chosen" } },
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
      questions: [aboutWork("q-plan", "Does the plan look right?")],
      at: T(2),
    });
    expect(openAsks(work)).toEqual(["ask-1", "ask-2"]);
    work = dropAsk(work, "ask-1", T(3));
    expect(openAsks(work)).toEqual(["ask-2"]);
  });

  it("waits on the human while an ask is open and on the agent after", () => {
    const asked = askQuestions(setUp(opened()), {
      ask: "ask-2",
      questions: [aboutWork("q-plan", "Does the plan look right?")],
      at: T(4),
    });
    expect(waitingOn(asked, policyOf(asked))).toBe("you");
    expect(standing(asked, policyOf(asked)).why).toBe("question");
    expect(needsYou([["w", asked]]).length).toBe(1);
    const answered = answerAsk(asked, {
      ask: "ask-2",
      at: T(5),
      from: "card",
      reply: { kind: "answered", values: new Map([["q-plan", ["yes"]]]) },
    });
    expect(waitingOn(answered, policyOf(answered))).toBe("agent");
    const plan = answered.decisions.find((one) => one.id === "q-plan");
    expect(
      plan !== undefined && isSettled(plan) ? plan.answer : {},
    ).toMatchObject({ said: { kind: "picked", picked: ["yes"] } });
  });

  it("says `done` once the work has ended", () => {
    const ended = endWork(worked(), {
      outcome: { kind: "stopped", by: "conductor" },
      at: T(9),
    });
    expect(waitingOn(ended, policyOf(ended))).toBe("done");
    expect(standing(ended, policyOf(ended))).toMatchObject({
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
        about: aboutMember("local/a"),
        why: { kind: "none" },
      });
    }
    const states = work.events.filter(
      (one) => one.kind === AGENT_STATE_KINDS[0],
    );
    expect(states.length).toBe(AGENT_STATES_KEPT);
    const folded = work.events.find((one) => one.kind === "folded");
    expect(folded).toMatchObject({ kind: "folded", count: 5 });
  });

  it("keeps every hand-off and every stop that let go of the work, and folds the rest past the bound", () => {
    let work = joinWork(opened(), {
      terminal: "local/a",
      role: "implementor",
      at: T(0),
    });
    const state = (kind: "asking" | "stopped", at: number) =>
      recordEvent(work, {
        at: T(at),
        by: "agent",
        kind,
        about: aboutMember("local/a"),
        why: { kind: "none" },
      });
    // Forty rounds: the agent asks a person (it lets go of nothing), stops
    // (it lets go), and is handed the work again.
    for (let round = 0; round < 40; round += 1) {
      work = state("asking", round);
      work = state("stopped", round);
      work = recordEvent(work, {
        at: T(round),
        by: "agent",
        kind: "told",
        about: aboutMember("local/a"),
      });
    }
    const count = (kind: string) =>
      work.events.filter((one) => one.kind === kind).length;
    expect(count("told")).toBe(40);
    expect(count("stopped")).toBe(40);
    expect(count("asking")).toBe(AGENT_STATES_KEPT);
    expect(work.events.find((one) => one.kind === "folded")).toMatchObject({
      count: 40 - AGENT_STATES_KEPT,
    });
  });

  it("measures where the time went and what each step took", () => {
    const work = worked();
    const spent = timeSpent(work, policyOf(work), T(10));
    expect(spent.agent + spent.you + spent.ci).toBe(10 * 60_000);
    expect(spent.ci).toBeGreaterThan(0);
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
    expect(driverOf(work, "local/a", Option.some(member()))).toBe("you");
    work = handBack(work, "local/a", T(5));
    expect(driverOf(work, "local/a", Option.some(member()))).toBe("conductor");
    // Nobody drives a terminal that is no member of it ...
    expect(driverOf(work, "local/a", Option.none())).toBe("nobody");
    // ... nor any terminal of a work whose mode nobody has answered.
    const unset = joinWork(opened(), {
      terminal: "local/a",
      role: "planner",
      at: T(3),
    });
    expect(driverOf(unset, "local/a", Option.some(member()))).toBe("nobody");
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

describe("a work's files, read as a tree", () => {
  const kept = (path: string, bytes: number) => ({
    path: `.waterfall/${path}`,
    bytes: Option.some(bytes),
  });
  const files = [
    kept("mockup/fonts/b.woff2", 300),
    kept("plan.md", 10),
    kept("mockup/index.html", 20),
    kept("mockup/fonts/a.woff2", 200),
    kept("notes.md", 5),
  ];

  it("draws a level as its files, then its folders, in tree order", () => {
    const top = waterfallLevel(files, WATERFALL_DIR);
    expect(top.files.map((one) => one.path)).toEqual([
      ".waterfall/notes.md",
      ".waterfall/plan.md",
    ]);
    expect(top.folders.map((one) => one.folder)).toEqual([
      ".waterfall/mockup/",
    ]);
    const mockup = waterfallLevel(files, ".waterfall/mockup/");
    expect(mockup.files.map((one) => one.path)).toEqual([
      ".waterfall/mockup/index.html",
    ]);
    expect(mockup.folders.map((one) => one.folder)).toEqual([
      ".waterfall/mockup/fonts/",
    ]);
  });

  it("counts every file beneath a folder, at any depth, and sums its size", () => {
    const [mockup] = waterfallLevel(files, WATERFALL_DIR).folders;
    expect(mockup?.files).toHaveLength(3);
    expect(waterfallBytes(mockup?.files ?? [])).toEqual(Option.some(520));
    // A live listing has no sizes, so its folder has none either.
    expect(
      waterfallBytes([
        ...(mockup?.files ?? []),
        { path: ".waterfall/mockup/new.html", bytes: Option.none() },
      ]),
    ).toEqual(Option.none());
  });

  it("orders a tree: a folder's files, then everything beneath each folder", () => {
    expect(
      [
        ".waterfall/z/a.md",
        ".waterfall/b.md",
        ".waterfall/a/z.md",
        ".waterfall/a/b/c.md",
        ".waterfall/a.md",
      ].sort(compareWaterfallPaths),
    ).toEqual([
      ".waterfall/a.md",
      ".waterfall/b.md",
      ".waterfall/a/z.md",
      ".waterfall/a/b/c.md",
      ".waterfall/z/a.md",
    ]);
  });

  it("says which top folder holds a path", () => {
    expect(
      childFolderOf(WATERFALL_DIR, ".waterfall/mockup/fonts/a.woff2"),
    ).toEqual(Option.some(".waterfall/mockup/"));
    expect(childFolderOf(WATERFALL_DIR, ".waterfall/plan.md")).toEqual(
      Option.none(),
    );
  });
});

describe("what a work's ending did not keep", () => {
  const stopped = {
    outcome: { kind: "stopped", by: "you" },
    at: T(9),
  } as const;

  it("is the sentence the latest ending recorded, and nothing before that", () => {
    const once = keepFailed(
      keepFiles(endWork(opened(), stopped), {
        files: [{ path: ".waterfall/plan.md", bytes: 12 }],
        at: T(9),
      }),
      "big.mov did not fit",
      T(9),
    );
    expect(notKeptOf(once)).toEqual(Option.some("big.mov did not fit"));
    // Opened again and ended again with everything kept: the old sentence is
    // about files that ending had, not these.
    const again = keepFiles(
      endWork(reopenWork(once, T(10)), { ...stopped, at: T(11) }),
      { files: [{ path: ".waterfall/plan.md", bytes: 12 }], at: T(11) },
    );
    expect(notKeptOf(again)).toEqual(Option.none());
    expect(notKeptOf(reopenWork(once, T(10)))).toEqual(Option.none());
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
