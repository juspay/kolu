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
 *    run on it before, and takes a typed one — and the typed one is what
 *    travels, alone;
 *  - the last answers are already selected, so Answer with nothing touched
 *    sends the whole setup;
 *  - a model list that FAILED says so in the host's own words and offers
 *    nothing — an empty menu would read as "this harness has no models";
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
  Decision,
  KoluChoiceKey,
  OfferedSetupKey,
  Work,
  WorkId,
} from "kolu-work";
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

const koluAsked = (id: string, key: KoluChoiceKey): Decision => ({
  kind: "asked",
  id,
  ask: ASK,
  at: AT,
  key,
  header: "",
  question: `Which ${key}?`,
  file: "",
});

const offeredAsked = (
  id: string,
  key: OfferedSetupKey,
  options: readonly string[],
): Decision => ({
  kind: "asked",
  id,
  ask: ASK,
  at: AT,
  key,
  header: "",
  question: `Which ${key}?`,
  options,
  multiple: false,
  file: "",
});

/** A setup question already answered — on this work (the harness the record
 *  holds) or on an earlier one (what this person chose last time). */
const koluAnswered = (
  id: string,
  key: KoluChoiceKey,
  value: string,
  at = AT,
): Decision => ({
  kind: "answered",
  id,
  ask: `${id}-ask`,
  at,
  key,
  header: "",
  question: `Which ${key}?`,
  file: "",
  answer: { at, how: "answered", picked: [value], text: null, from: "card" },
});

const offeredAnswered = (
  id: string,
  key: OfferedSetupKey,
  value: string,
  at = AT,
): Decision => ({
  kind: "answered",
  id,
  ask: `${id}-ask`,
  at,
  key,
  header: "",
  question: `Which ${key}?`,
  options: [value],
  multiple: false,
  file: "",
  answer: { at, how: "answered", picked: [value], text: null, from: "card" },
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
 *  harness and the model they ran on it. */
const earlier = (model = "sonnet-4"): ReadonlyMap<WorkId, Work> =>
  new Map([
    [
      "branch:local/src/before",
      workOf("before", [
        offeredAnswered("p-mode", "mode", "trivial", "2025-12-01T00:00:00Z"),
        koluAnswered(
          "p-harness",
          "planner.harness",
          "claude",
          "2025-12-01T00:00:01Z",
        ),
        koluAnswered("p-model", "planner.model", model, "2025-12-01T00:00:02Z"),
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

/** What the last Answer press sent, by field. */
const sent = (): Record<string, readonly string[]> =>
  answerWork.mock.calls.at(-1)?.[2] as Record<string, readonly string[]>;

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
    expect(sent()).toEqual({ "ask-model": ["opus-4.9"] });
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
        offeredAsked("ask-mode", "mode", ["full", "trivial", "watch"]),
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

  it("leave a question alone once it has been cleared", async () => {
    setWorks(earlier());
    const el = mount(
      workOf("now", [
        offeredAsked("ask-mode", "mode", ["full", "trivial", "watch"]),
      ]),
    );
    await settle();
    // Typing takes the pick off a single-answer question; the default must
    // not come back over the words.
    const box = el.querySelector(
      '[data-testid="conductor-ask-other"][data-field="ask-mode"]',
    ) as HTMLInputElement;
    typeInto(box, "whatever you think");
    await settle();

    expect(selected(el, "ask-mode")).toEqual([]);
    press(el, "conductor-ask-submit");
    expect(sent()).toEqual({ "ask-mode": ["whatever you think"] });
  });
});

describe("a model list that could not be read", () => {
  it("says so in the host's own words and offers nothing", async () => {
    setWorks(earlier());
    host.reply = () =>
      Effect.fail(
        new Error("agent-distro is not ready on this machine: no bundle"),
      );
    const el = mount(
      workOf("now", [
        koluAnswered("now-harness", "planner.harness", "claude"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();

    const failed = el.querySelector('[data-testid="conductor-ask-failed"]');
    expect(failed?.textContent).toContain(
      "agent-distro is not ready on this machine: no bundle",
    );
    expect(options(el, "ask-model")).toEqual([]);
    // Nothing was seeded into a question nobody could answer.
    press(el, "conductor-ask-submit");
    expect(sent()).toEqual({});
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
  it("gets a box that narrows it", async () => {
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

    expect(options(el, "ask-model")).toHaveLength(12);
    const search = el.querySelector(
      '[data-testid="conductor-ask-search"][data-field="ask-model"]',
    ) as HTMLInputElement;
    typeInto(search, "model-1");
    expect(options(el, "ask-model")).toEqual([
      "model-1",
      "model-10",
      "model-11",
    ]);
  });
});
