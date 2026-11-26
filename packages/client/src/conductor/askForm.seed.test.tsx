// @vitest-environment happy-dom
/**
 * WHAT A QUESTION OPENS ON IS READ, NOT WRITTEN.
 *
 * A setup question opens on what this person chose last time, already
 * selected, so one press of Answer sends the whole setup. That default is a
 * fact about the options drawn — and for a model, about the HARNESS answered
 * beside it and what the host says that harness offers, which changes while
 * the form is open.
 *
 * Written into the draft, it arrives one flush after the options it belongs
 * to: for a frame the model question shows the new harness's list with the
 * previous harness's model still selected, and every chip binding runs twice
 * for one press. Read through the default instead, the list and the selection
 * are the same flush's.
 *
 * Both halves are stated here — the selection lands with the list over four
 * harness changes (which is what `@kolu/solid-test-setup` grades as a relay
 * tear while the draft is written from an effect), and a question somebody
 * CLEARED stays cleared when the memory behind it moves, which is the
 * distinction a written default cannot keep.
 */

import { Effect } from "effect";
import type {
  Asked,
  Decision,
  KoluChoiceKey,
  Work,
  WorkId,
  WorkMode,
} from "kolu-work";
import { WORK_MODES } from "kolu-work";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const answerWork = vi.hoisted(() => vi.fn());
vi.mock("./useConductor", () => ({
  useConductor: () => ({ answerWork }),
}));

/** What each harness offers on this host. */
const host = vi.hoisted(() => ({
  models: {
    claude: ["sonnet-4", "opus-4.9"],
    codex: ["gpt-5", "o4"],
  } as Record<string, readonly string[]>,
  listed: true,
}));
vi.mock("../wire", () => ({
  padiRpcOf: () => ({
    agentDistro: {
      models: (input: { harness: string }) =>
        Effect.succeed({
          launch: { kind: "flag", flag: "--model" },
          models: host.listed
            ? { kind: "listed", ids: host.models[input.harness] ?? [] }
            : { kind: "unlisted" },
        }),
    },
  }),
}));

vi.mock("./workFile", () => ({
  workFileName: (path: string) => path.split("/").pop() ?? path,
}));

vi.mock("../agents/useAgentDistro", () => ({
  agentDistroListing: () => ({
    kind: "available",
    harnesses: [
      { name: "claude", title: "Claude Code", version: "1.0" },
      { name: "codex", title: "Codex", version: "2.0" },
    ],
  }),
}));

const [works, setWorks] = createSignal<ReadonlyMap<WorkId, Work>>(new Map());
vi.mock("./useWorks", async () => {
  const { setupAnswersOf } = await import("kolu-work");
  return {
    useWorkMap: () => works,
    useSetupAnswers: () => () =>
      [...works().values()].flatMap((record) => setupAnswersOf(record)),
  };
});

import { Shown } from "../ui/shown";
import { forgetAskDraft } from "./drafts";
import WorkQuestion from "./WorkQuestion";

const ASK = "ask-1";
const AT = "2026-01-01T00:00:00.000Z";
const REPO = "/src/kolu";

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

const koluAnswered = (
  id: string,
  key: KoluChoiceKey,
  value: string,
  at = AT,
): Decision => ({
  ...koluAsked(id, key),
  ask: `${id}-ask`,
  at,
  kind: "settled",
  answer: { how: "answered", at, from: "card", value, chosen: "picked" },
});

/** The mode — a setup question the ASKER draws the options for, so it needs
 *  no host behind it: what it opens on is the memory alone. */
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

const modeAnswered = (id: string, value: WorkMode, at: string): Decision => ({
  ...modeAsked(id),
  ask: `${id}-ask`,
  at,
  kind: "settled",
  answer: { how: "answered", at, from: "card", value },
});

const workOf = (branch: string, decisions: readonly Decision[]): Work => ({
  key: {
    kind: "branch",
    host: "local",
    repo: REPO,
    branch,
    repoBy: { kind: "git" },
  },
  title: `work on ${branch}`,
  startedAt: AT,
  decisions,
  events: [],
  state: { kind: "open" },
  worktree: { kind: "unread" },
});

/** The works this person already answered — one model per harness, which is
 *  what each harness's own default is read from. */
const answeredBefore = (model: string, when: string): ReadonlyMap<WorkId, Work> =>
  new Map([
    [
      `branch:local/src/${model}`,
      workOf(model, [
        koluAnswered(`${model}-harness`, "planner.harness", "claude", when),
        koluAnswered(`${model}-model`, "planner.model", model, when),
      ]),
    ],
  ]);

/** ... and the two harnesses' last models, which is what a harness change
 *  moves between. */
const perHarness = (): ReadonlyMap<WorkId, Work> =>
  new Map([
    [
      "branch:local/src/one",
      workOf("one", [
        koluAnswered(
          "one-harness",
          "planner.harness",
          "claude",
          "2025-12-01T00:00:00Z",
        ),
        koluAnswered(
          "one-model",
          "planner.model",
          "sonnet-4",
          "2025-12-01T00:00:01Z",
        ),
      ]),
    ],
    [
      "branch:local/src/two",
      workOf("two", [
        koluAnswered(
          "two-harness",
          "planner.harness",
          "codex",
          "2025-12-02T00:00:00Z",
        ),
        koluAnswered(
          "two-model",
          "planner.model",
          "gpt-5",
          "2025-12-02T00:00:01Z",
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
      <Shown value={() => true}>
        <WorkQuestion
          work={work}
          id="branch:local/src/now"
          ask={ASK}
          from="card"
        />
      </Shown>
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

const options = (el: HTMLElement, field: string): string[] =>
  [
    ...el.querySelectorAll(
      `[data-testid="conductor-ask-option"][data-field="${field}"]`,
    ),
  ].map((one) => one.getAttribute("data-value") ?? "");

const selected = (el: HTMLElement, field: string): string[] =>
  [
    ...el.querySelectorAll(
      `[data-testid="conductor-ask-option"][data-field="${field}"][data-active]`,
    ),
  ].map((one) => one.getAttribute("data-value") ?? "");

const pressChip = (el: HTMLElement, field: string, value: string): void => {
  const found = el.querySelector(
    `[data-testid="conductor-ask-option"][data-field="${field}"][data-value="${value}"]`,
  );
  if (found === null) throw new Error(`no option ${value} for ${field}`);
  (found as HTMLElement).click();
  flush();
};

const boxOf = (el: HTMLElement, field: string): HTMLInputElement => {
  const found = el.querySelector(
    `[data-testid="conductor-ask-other"][data-field="${field}"]`,
  );
  if (found === null) throw new Error(`no box for ${field}`);
  return found as HTMLInputElement;
};

const typeInto = (box: HTMLInputElement, words: string): void => {
  box.value = words;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
};

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root?.remove();
  root = undefined;
  forgetAskDraft(ASK);
  answerWork.mockClear();
  setWorks(new Map());
  host.listed = true;
});

describe("the default a setup question opens on", () => {
  it("lands with the list it belongs to, over four harness changes", async () => {
    setWorks(perHarness());
    const el = mount(
      workOf("now", [
        koluAsked("ask-harness", "planner.harness"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();

    // The harness opens on the one chosen last, and the model on THAT
    // harness's own last model.
    expect(selected(el, "ask-harness")).toEqual(["codex"]);
    expect(options(el, "ask-model")).toEqual(["gpt-5", "o4"]);
    expect(selected(el, "ask-model")).toEqual(["gpt-5"]);

    for (const [harness, model] of [
      ["claude", "sonnet-4"],
      ["codex", "gpt-5"],
      ["claude", "sonnet-4"],
      ["codex", "gpt-5"],
    ] as const) {
      pressChip(el, "ask-harness", harness);
      await settle();
      // ONE FLUSH, ONE HARNESS: the list on screen is the new harness's, and
      // so is the chip that reads as the answer.
      expect(options(el, "ask-model")[0]).toBe(model);
      expect(selected(el, "ask-model")).toEqual([model]);
    }
  });

  it("leaves a question somebody cleared cleared when the memory moves", async () => {
    host.listed = false;
    setWorks(answeredBefore("sonnet-4", "2025-12-01T00:00:00Z"));
    const el = mount(
      workOf("now", [
        koluAnswered("now-harness", "planner.harness", "claude"),
        koluAsked("ask-model", "planner.model"),
      ]),
    );
    await settle();
    expect(selected(el, "ask-model")).toEqual(["sonnet-4"]);

    // Typed over, then emptied: the question is now ANSWERED WITH NOTHING,
    // which is not the same as never touched.
    const box = boxOf(el, "ask-model");
    typeInto(box, "opus-4.9");
    expect(selected(el, "ask-model")).toEqual([]);
    typeInto(box, "");
    expect(selected(el, "ask-model")).toEqual([]);

    // A later work lands and the memory moves. The question stays empty: the
    // default is not put back under their hands.
    setWorks(answeredBefore("o4", "2025-12-09T00:00:00Z"));
    flush();
    await settle();
    expect(boxOf(el, "ask-model").value).toBe("");
    expect(selected(el, "ask-model")).toEqual([]);
  });

  it("opens on the memory that lands after the form is drawn", () => {
    // THE WORKS ARRIVE ON THEIR OWN STREAM, and often after the question that
    // is answered from them: a form drawn while the mirror is still empty has
    // no default yet. Written into the draft, the default is written ONCE —
    // with nothing, before the memory is there — and the question is marked
    // as seeded, so it never opens on what this person chose at all.
    const el = mount(workOf("now", [modeAsked("ask-mode")]));
    expect(selected(el, "ask-mode")).toEqual([]);

    setWorks(
      new Map([
        [
          "branch:local/src/before",
          workOf("before", [
            modeAnswered("p-mode", "trivial", "2025-12-01T00:00:00Z"),
          ]),
        ],
      ]),
    );
    flush();

    expect(options(el, "ask-mode")[0]).toBe("trivial");
    expect(selected(el, "ask-mode")).toEqual(["trivial"]);
  });
});
