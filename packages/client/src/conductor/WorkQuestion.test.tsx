// @vitest-environment happy-dom
/**
 * THE SETUP FORM, AND WHOSE OPTIONS ARE WHOSE.
 *
 * Four of a work's setup questions are not the asker's to offer: a role's
 * harness comes from the listing this kolu was built with, and its model from
 * the WORK'S HOST, asked live for the harness that was chosen. So what is
 * pinned here is what a person sees and what one press of Answer sends:
 *
 *  - a harness that cannot list its models offers the ones this person has
 *    run on it before, and takes a typed one — and the typed one travels,
 *    alone, AS TYPED;
 *  - the last answers are already selected, so Answer with nothing touched
 *    sends the whole setup;
 *  - a model list that FAILED says so in the host's own words, and beside
 *    them offers what a harness with no list gets — the models used before
 *    and a box — so the person can still answer, knowingly;
 *  - the model question is of the harness being answered BESIDE it, not of
 *    the one the record happens to hold.
 *
 * The three sources are stubbed at their module seams (the works mirror, the
 * agent-distro listing, the host's padi) exactly as `ConductorAsk.test.tsx`
 * stubs the conductor; the form, the drafts and the seeding are the real
 * ones.
 */

import { Effect } from "effect";
import type {
  Asked,
  Chosen,
  Decision,
  KoluChoiceKey,
  Said,
  Work,
  WorkId,
  WorkMode,
} from "kolu-work";
import { WORK_MODES } from "kolu-work";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

/** What the work is told — the exact values one press of Answer sends. */
const answerWork = vi.hoisted(() => vi.fn());
vi.mock("./useConductor", () => ({
  useConductor: () => ({ answerWork }),
}));

/** Every call the form made to a host's padi, and what that host answers. */
const host = vi.hoisted(() => ({
  asked: [] as { harness: string; cwd: string }[],
  reply: (_harness: string): Effect.Effect<unknown, Error> =>
    Effect.succeed({
      launch: { kind: "flag", flag: "--model" },
      models: { kind: "listed", ids: ["sonnet-4", "opus-4.9"] },
    }),
}));
vi.mock("../wire", () => ({
  padiRpcOf: () => ({
    agentDistro: {
      models: (input: { harness: string; cwd: string }) => {
        host.asked.push(input);
        return host.reply(input.harness);
      },
    },
  }),
}));

/** The file-name reading — stubbed so this test does not pull the viewer's
 *  world in for a button it never presses. */
vi.mock("./workFile", () => ({
  workFileName: (path: string) => path.split("/").pop() ?? path,
}));

type Listing =
  | { kind: "unavailable" }
  | {
      kind: "available";
      harnesses: readonly { name: string; title: string; version: string }[];
    };

const [listing, setListing] = createSignal<Listing | undefined>({
  kind: "available",
  harnesses: [
    { name: "claude", title: "Claude Code", version: "1.0" },
    { name: "codex", title: "Codex", version: "2.0" },
  ],
});
vi.mock("../agents/useAgentDistro", () => ({
  agentDistroListing: () => listing(),
}));

const [works, setWorks] = createSignal<ReadonlyMap<WorkId, Work>>(new Map());
vi.mock("./useWorks", () => ({
  useWorkMap: () => works,
}));

import { forgetAskDraft } from "./drafts";
import WorkQuestion from "./WorkQuestion";

const ASK = "ask-1";
const AT = "2026-01-01T00:00:00.000Z";
const REPO = "/src/kolu";

/** ONE OF KOLU'S OWN SETUP QUESTIONS — no options and no words of its own on
 *  the record: the harnesses and the models are read live. */
const koluAsked = (
  id: string,
  key: KoluChoiceKey,
): Extract<Asked, { readonly key: KoluChoiceKey }> => ({
  kind: "asked",
  id,
  ask: ASK,
  at: AT,
  topic: "setup",
  key,
  question: `Which ${key}?`,
});

/** The mode, whose options are kolu's own words. */
const modeAsked = (id: string): Extract<Asked, { readonly key: "mode" }> => ({
  kind: "asked",
  id,
  ask: ASK,
  at: AT,
  topic: "setup",
  key: "mode",
  options: [...WORK_MODES],
  question: "Which mode?",
});

/** A QUESTION ABOUT THE WORK — the asker's own, which is the only kind with
 *  a box to type in. */
const workAsked = (
  id: string,
  over: {
    readonly question?: string;
    readonly header?: string;
    readonly options?: readonly string[];
  } = {},
): Extract<Asked, { readonly topic: "work" }> => ({
  kind: "asked",
  id,
  ask: ASK,
  at: AT,
  topic: "work",
  question: over.question ?? "Approve the plan?",
  header:
    over.header === undefined
      ? { kind: "none" }
      : { kind: "header", text: over.header },
  options: over.options ?? ["Approve", "Ask for changes"],
  multiple: false,
  file: { kind: "none" },
});

/** ... and that question, settled with what was said. */
const workSaid = (id: string, value: Said): Decision => ({
  ...workAsked(id),
  kind: "settled",
  answer: { how: "answered", at: AT, from: "card", said: value },
});

/** A setup question already answered — on this work (the harness the record
 *  holds) or on an earlier one (what this person chose last time). */
const koluAnswered = (
  id: string,
  key: KoluChoiceKey,
  value: string,
  at = AT,
  chosen: Chosen = "picked",
): Decision => ({
  ...koluAsked(id, key),
  ask: `${id}-ask`,
  at,
  kind: "settled",
  answer: { how: "answered", at, from: "card", value, chosen },
});

const modeAnswered = (id: string, value: WorkMode, at = AT): Decision => ({
  ...modeAsked(id),
  ask: `${id}-ask`,
  at,
  kind: "settled",
  answer: { how: "answered", at, from: "card", value },
});

const workOf = (branch: string, decisions: readonly Decision[]): Work => ({
  key: { kind: "branch", host: "local", repo: REPO, branch },
  title: `work on ${branch}`,
  startedAt: AT,
  decisions,
  events: [],
  state: { kind: "open" },
});

/** The work this person answered LAST TIME, in the saved works: a mode, a
 *  harness and the model they ran on it, as they chose it. */
const earlier = (
  model = "sonnet-4",
  chosen: Chosen = "picked",
): ReadonlyMap<WorkId, Work> =>
  new Map([
    [
      "branch:local/src/before",
      workOf("before", [
        modeAnswered("p-mode", "trivial", "2025-12-01T00:00:00Z"),
        koluAnswered(
          "p-harness",
          "planner.harness",
          "claude",
          "2025-12-01T00:00:01Z",
        ),
        koluAnswered(
          "p-model",
          "planner.model",
          model,
          "2025-12-01T00:00:02Z",
          chosen,
        ),
      ]),
    ],
  ]);

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

function mount(work: Work): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  root = el;
  dispose = render(
    () => (
      <WorkQuestion
        work={work}
        id="branch:local/src/now"
        ask={ASK}
        from="card"
      />
    ),
    el,
  );
  return el;
}

/** Let the host's answer land and the form settle on it. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn += 1) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  }
};

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root?.remove();
  root = undefined;
  forgetAskDraft(ASK);
  answerWork.mockClear();
  host.asked.length = 0;
  host.reply = () =>
    Effect.succeed({
      launch: { kind: "flag", flag: "--model" },
      models: { kind: "listed", ids: ["sonnet-4", "opus-4.9"] },
    });
  setWorks(new Map());
  setListing({
    kind: "available",
    harnesses: [
      { name: "claude", title: "Claude Code", version: "1.0" },
      { name: "codex", title: "Codex", version: "2.0" },
    ],
  });
});

/** The options drawn for one question, in the order a person reads them. */
const options = (el: HTMLElement, field: string): string[] =>
  [
    ...el.querySelectorAll(
      `[data-testid="conductor-ask-option"][data-field="${field}"]`,
    ),
  ].map((one) => one.getAttribute("data-value") ?? "");

const chip = (el: HTMLElement, field: string, value: string): HTMLElement => {
  const found = el.querySelector(
    `[data-testid="conductor-ask-option"][data-field="${field}"][data-value="${value}"]`,
  );
  if (found === null) throw new Error(`no option ${value} for ${field}`);
  return found as HTMLElement;
};

const selected = (el: HTMLElement, field: string): string[] =>
  [
    ...el.querySelectorAll(
      `[data-testid="conductor-ask-option"][data-field="${field}"][data-active]`,
    ),
  ].map((one) => one.getAttribute("data-value") ?? "");

const typeInto = (box: HTMLInputElement, words: string): void => {
  box.value = words;
  box.dispatchEvent(new Event("input", { bubbles: true }));
};

const press = (el: HTMLElement, testid: string): void => {
  const button = el.querySelector(`[data-testid="${testid}"]`);
  if (button === null) throw new Error(`no ${testid}`);
  (button as HTMLElement).click();
};

/** THE ANSWER BUTTON ITSELF — what a person reads before pressing: it is
 *  dead while there is nothing in the form to record. */
const submit = (el: HTMLElement): HTMLButtonElement => {
  const button = el.querySelector('[data-testid="conductor-ask-submit"]');
  if (button === null) throw new Error("no Answer button");
  return button as HTMLButtonElement;
};

/** The record lines a form draws above its open questions — what was already
 *  said, by field. */
const recorded = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-testid="conductor-ask-answer"]')].map((one) =>
    (one.textContent ?? "").replace(/\s+/g, " ").trim(),
  );

/** The questions still drawn as FIELDS, by decision id. */
const fields = (el: HTMLElement): string[] =>
  [...el.querySelectorAll("fieldset[data-decision]")].map(
    (one) => one.getAttribute("data-decision") ?? "",
  );

/** What the last Answer press sent, by field. */
const sent = (): Record<string, unknown> =>
  answerWork.mock.calls.at(-1)?.[2] as Record<string, unknown>;

describe("a harness that cannot list its models", () => {
  it("offers the models used before and takes a typed one", async () => {
    setWorks(earlier());
    host.reply = () =>
      Effect.succeed({
        launch: { kind: "flag", flag: "--model" },
        models: { kind: "unlisted" },
      });
    const el = mount(
      workOf("now", [
        koluAnswered("now-harness", "planner.harness", "claude"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();

    expect(host.asked).toEqual([{ harness: "claude", cwd: REPO }]);
    expect(options(el, "ask-model")).toEqual(["sonnet-4"]);

    const box = el.querySelector(
      '[data-testid="conductor-ask-other"][data-field="ask-model"]',
    ) as HTMLInputElement;
    typeInto(box, "opus-4.9");
    expect(selected(el, "ask-model")).toEqual([]);

    press(el, "conductor-ask-submit");
    expect(sent()).toEqual({ "ask-model": { typed: "opus-4.9" } });
  });

  it("says why typed words are not a model, and never offers saved ones back", async () => {
    // The human's own store: a planner model saved as WORDS, before kolu drew
    // these options. A launch would refuse it, so it is neither offered nor
    // put back under their hands.
    setWorks(earlier("fable 5.2"));
    host.reply = () =>
      Effect.succeed({
        launch: { kind: "flag", flag: "--model" },
        models: { kind: "unlisted" },
      });
    const el = mount(
      workOf("now", [
        koluAnswered("now-harness", "planner.harness", "claude"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();
    expect(options(el, "ask-model")).toEqual([]);
    const box = el.querySelector(
      '[data-testid="conductor-ask-other"][data-field="ask-model"]',
    ) as HTMLInputElement;
    expect(box.value).toBe("");

    const why = () =>
      el.querySelector(
        '[data-testid="conductor-ask-invalid"][data-field="ask-model"]',
      )?.textContent ?? null;
    typeInto(box, "fable 5.2");
    expect(why()).toBe(
      '"fable 5.2" is not a model id — a model id is one word, with no spaces.',
    );
    typeInto(box, "claude-fable-5-2");
    expect(why()).toBeNull();
  });
});

describe("the answers from last time", () => {
  it("are already selected, drawn first, and sent by one press", async () => {
    setWorks(earlier());
    const el = mount(
      workOf("now", [
        modeAsked("ask-mode"),
        koluAsked("ask-harness", "planner.harness"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();

    // The default leads each list, and is the one showing as pressed.
    expect(options(el, "ask-mode")[0]).toBe("trivial");
    expect(selected(el, "ask-mode")).toEqual(["trivial"]);
    expect(options(el, "ask-harness")[0]).toBe("claude");
    expect(selected(el, "ask-harness")).toEqual(["claude"]);
    expect(selected(el, "ask-model")).toEqual(["sonnet-4"]);

    press(el, "conductor-ask-submit");
    expect(sent()).toEqual({
      "ask-mode": ["trivial"],
      "ask-harness": ["claude"],
      "ask-model": ["sonnet-4"],
    });
  });

  it("leave a question alone once its words have been typed over", async () => {
    setWorks(earlier("sonnet-4"));
    host.reply = () =>
      Effect.succeed({
        launch: { kind: "flag", flag: "--model" },
        models: { kind: "unlisted" },
      });
    const el = mount(
      workOf("now", [
        koluAnswered("now-harness", "planner.harness", "claude"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();
    expect(selected(el, "ask-model")).toEqual(["sonnet-4"]);
    // Typing takes the pick off a single-answer question; the default must
    // not come back over the words.
    const box = el.querySelector(
      '[data-testid="conductor-ask-other"][data-field="ask-model"]',
    ) as HTMLInputElement;
    typeInto(box, "opus-4.9");
    await settle();

    expect(selected(el, "ask-model")).toEqual([]);
    press(el, "conductor-ask-submit");
    expect(sent()).toEqual({ "ask-model": { typed: "opus-4.9" } });
  });

  it("offers no box at all for a question answered in kolu's own words", async () => {
    setWorks(earlier());
    const el = mount(workOf("now", [modeAsked("ask-mode")]));
    await settle();
    // The mode is one of three words the record takes and the start command
    // reads back; words outside them are refused where they are recorded, so
    // there is nowhere here to type them.
    expect(
      el.querySelector(
        '[data-testid="conductor-ask-other"][data-field="ask-mode"]',
      ),
    ).toBeNull();
  });
});

describe("a model list that could not be read", () => {
  it("says so in the host's own words, and still offers the models used before and a box", async () => {
    setWorks(earlier());
    host.reply = () =>
      Effect.fail(
        new Error(
          "agent-distro claude: error: cannot list its models: LITELLM_API_KEY is not set",
        ),
      );
    const el = mount(
      workOf("now", [
        koluAnswered("now-harness", "planner.harness", "claude"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();

    // THE HOST'S OWN WORDS, on the question — not an empty menu.
    expect(
      el.querySelector('[data-testid="conductor-ask-failed"]')?.textContent,
    ).toContain("LITELLM_API_KEY is not set");
    // ... and beside them, what a harness with no list gets: the model run
    // before, already selected, and a box to type another.
    expect(options(el, "ask-model")).toEqual(["sonnet-4"]);
    expect(selected(el, "ask-model")).toEqual(["sonnet-4"]);
    expect(
      el.querySelector(
        '[data-testid="conductor-ask-other"][data-field="ask-model"]',
      ),
    ).not.toBeNull();
    // It is answerable: nothing says it stays open.
    expect(
      el.querySelector('[data-testid="conductor-ask-stays-open"]'),
    ).toBeNull();
    press(el, "conductor-ask-submit");
    expect(sent()).toEqual({ "ask-model": ["sonnet-4"] });
  });

  it("brings a model typed before back into the box, to be sent as typed", async () => {
    setWorks(earlier("opus", "typed"));
    host.reply = () =>
      Effect.fail(new Error("agent-distro claude: error: gateway down"));
    const el = mount(
      workOf("now", [
        koluAnswered("now-harness", "planner.harness", "claude"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();

    const box = el.querySelector(
      '[data-testid="conductor-ask-other"][data-field="ask-model"]',
    ) as HTMLInputElement;
    expect(box.value).toBe("opus");
    // Its chip reads as the answer, and pressing Answer sends it typed — a
    // typed model is never held to a list.
    expect(selected(el, "ask-model")).toEqual(["opus"]);
    press(el, "conductor-ask-submit");
    expect(sent()).toEqual({ "ask-model": { typed: "opus" } });
  });
});

describe("the model question", () => {
  it("is of the harness picked in the same form", async () => {
    host.reply = (harness: string) =>
      Effect.succeed({
        launch: { kind: "flag", flag: "--model" },
        models: {
          kind: "listed",
          ids: harness === "codex" ? ["gpt-5-codex"] : ["sonnet-4"],
        },
      });
    const el = mount(
      workOf("now", [
        koluAsked("ask-harness", "planner.harness"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();

    // Nobody has said which harness yet, so nothing has been asked of the
    // host and the question says what it is waiting for.
    expect(host.asked).toEqual([]);
    expect(
      el.querySelector('[data-testid="conductor-ask-waiting"]')?.textContent,
    ).toContain("harness first");

    chip(el, "ask-harness", "codex").click();
    await settle();

    expect(host.asked).toEqual([{ harness: "codex", cwd: REPO }]);
    expect(options(el, "ask-model")).toEqual(["gpt-5-codex"]);

    chip(el, "ask-model", "gpt-5-codex").click();
    press(el, "conductor-ask-submit");
    expect(sent()).toEqual({
      "ask-harness": ["codex"],
      "ask-model": ["gpt-5-codex"],
    });
  });

  it("asks again for the harness the form moves to", async () => {
    setWorks(earlier());
    const el = mount(
      workOf("now", [
        koluAsked("ask-harness", "planner.harness"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();
    expect(selected(el, "ask-model")).toEqual(["sonnet-4"]);

    host.reply = () =>
      Effect.succeed({
        launch: { kind: "flag", flag: "--model" },
        models: { kind: "listed", ids: ["gpt-5-codex"] },
      });
    chip(el, "ask-harness", "codex").click();
    await settle();

    // The model of the harness they left is not a model of this one.
    expect(options(el, "ask-model")).toEqual(["gpt-5-codex"]);
    expect(selected(el, "ask-model")).toEqual([]);
  });
});

describe("a kolu built without agent-distro", () => {
  it("says it carries no agent rather than drawing an empty row", async () => {
    setListing({ kind: "unavailable" });
    const el = mount(
      workOf("now", [koluAsked("ask-harness", "planner.harness")]),
    );
    await settle();

    expect(
      el.querySelector('[data-testid="conductor-ask-none"]')?.textContent,
    ).toContain("without agent-distro");
    expect(options(el, "ask-harness")).toEqual([]);
    expect(el.querySelector('[data-testid="conductor-ask-other"]')).toBeNull();
  });
});

describe("a long list of models", () => {
  it("rests on what was used before, searches all of it, and unfolds", async () => {
    const many = Array.from({ length: 12 }, (_, at) => `model-${at}`);
    host.reply = () =>
      Effect.succeed({
        launch: { kind: "flag", flag: "--model" },
        models: { kind: "listed", ids: many },
      });
    const el = mount(
      workOf("now", [
        koluAnswered("now-harness", "planner.harness", "claude"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();

    // Nothing used before with this harness: no chips at rest, only the
    // box and the line that counts the rest.
    const more = () =>
      el.querySelector(
        '[data-testid="conductor-ask-more"][data-field="ask-model"]',
      );
    const all = () =>
      el.querySelector(
        '[data-testid="conductor-ask-all"][data-field="ask-model"]',
      ) as HTMLElement;
    expect(options(el, "ask-model")).toEqual([]);
    expect(more()?.getAttribute("data-hidden")).toBe("12");
    const search = el.querySelector(
      '[data-testid="conductor-ask-search"][data-field="ask-model"]',
    ) as HTMLInputElement;
    typeInto(search, "model-1");
    expect(options(el, "ask-model")).toEqual([
      "model-1",
      "model-10",
      "model-11",
    ]);
    // A pick from the search stays drawn, and selected, once it is cleared.
    chip(el, "ask-model", "model-10").click();
    typeInto(search, "");
    expect(options(el, "ask-model")).toEqual(["model-10"]);
    expect(selected(el, "ask-model")).toEqual(["model-10"]);
    // "show all" unfolds the whole list in place, and folds back.
    all().click();
    expect(options(el, "ask-model")).toHaveLength(12);
    all().click();
    expect(options(el, "ask-model")).toEqual(["model-10"]);
  });
});

describe("a form answered in part", () => {
  it("shows what was said as a line and keeps the blank question a field", async () => {
    mount(
      workOf("now", [
        workSaid("w-plan", { kind: "picked", picked: ["Approve"] }),
        workAsked("w-review", {
          question: "Who reviews it?",
          header: "Reviewer",
        }),
      ]),
    );
    await settle();
    const el = root ?? document.body;
    // The answered one is the record, the blank one is still asked.
    expect(recorded(el)).toEqual([expect.stringContaining("Approve")]);
    expect(fields(el)).toEqual(["w-review"]);
    // Nothing filled in yet: nothing to send, and the button says so.
    expect(submit(el).disabled).toBe(true);
    chip(el, "w-review", "Ask for changes").click();
    await settle();
    expect(submit(el).disabled).toBe(false);
    submit(el).click();
    // Only the open question is sent — the answered one is not sent again.
    expect(sent()).toEqual({ "w-review": ["Ask for changes"] });
  });

  it("sends only what was filled in, leaving the rest for the record to keep open", async () => {
    mount(
      workOf("now", [
        workAsked("w-plan"),
        workAsked("w-review", { question: "Who reviews it?" }),
      ]),
    );
    await settle();
    const el = root ?? document.body;
    expect(submit(el).disabled).toBe(true);
    chip(el, "w-plan", "Approve").click();
    await settle();
    submit(el).click();
    expect(sent()).toEqual({ "w-plan": ["Approve"] });
  });
});
