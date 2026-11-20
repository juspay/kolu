// @vitest-environment happy-dom

import {
  type AskAnswer,
  type AskField,
  type ConductorAskRow,
  YES_NO,
} from "kolu-common/conductor";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const answer = vi.hoisted(() => vi.fn());

vi.mock("./useConductor", () => ({
  useConductor: () => ({ answer }),
}));

import ConductorAsk from "./ConductorAsk";
import { forgetAskDraft, setAskDraft } from "./drafts";

const choice = (
  key: string,
  label: string | null,
  values: ReadonlyArray<string>,
): AskField => ({
  key,
  label,
  hint: null,
  kind: "choice",
  choices: values.map((value) => ({ value, label: value, hint: null })),
  required: true,
  attachedTo: null,
});

const multiChoice = (
  key: string,
  label: string | null,
  values: ReadonlyArray<string>,
): AskField => ({
  ...choice(key, label, values),
  kind: "choices",
  required: false,
});

const text = (
  key: string,
  label: string | null,
  attachedTo: string | null,
): AskField => ({
  key,
  label,
  hint: null,
  kind: "text",
  choices: [],
  required: false,
  attachedTo,
});

const FIELDS: ReadonlyArray<AskField> = [
  choice("mode", "Mode", ["trivial", "thorough"]),
  choice("implementor", "Implementor", ["omp", "claude"]),
  text("implementor_other", "Other", "implementor"),
];

const askRow = (
  ask: Partial<ConductorAskRow["ask"]> = {},
  rowText = "Please answer the following questions.",
): ConductorAskRow => ({
  id: "ask:1",
  seq: 3,
  since: "2026-01-01T00:00:00.000Z",
  kind: "ask",
  text: rowText,
  ask: { fields: FIELDS, link: null, outcome: null, ...ask },
});

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

function mount(row: ConductorAskRow): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <ConductorAsk row={row} />, root);
  return root;
}

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  forgetAskDraft("ask:1");
  answer.mockClear();
});

const lines = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-testid="conductor-ask-answer"]')].map((line) =>
    (line.textContent ?? "").trim(),
  );

const outcome = (el: HTMLElement): string | undefined =>
  el
    .querySelector('[data-testid="conductor-ask-outcome"]')
    ?.textContent?.trim();

const lead = (el: HTMLElement): string | undefined =>
  el.querySelector('[data-testid="conductor-ask-text"]')?.textContent?.trim();

describe("a settled ask card", () => {
  it("reads as the record: each question with what was answered", () => {
    const el = mount(
      askRow({
        outcome: {
          how: "answered",
          answers: [
            { key: "mode", values: ["trivial"] },
            { key: "implementor", values: ["omp"] },
            {
              key: "implementor_other",
              values: ["anthropic/claude-opus-5-5"],
            },
          ],
        },
      }),
    );
    expect(lines(el)).toEqual([
      "Mode — trivial",
      "Implementor — omp · anthropic/claude-opus-5-5",
    ]);
    expect(outcome(el)).toBe("answered");
    expect(el.querySelector('[data-testid="conductor-ask-submit"]')).toBeNull();
  });

  it("does not print the adapter's wrapper sentence over labelled fields", () => {
    const el = mount(askRow({ outcome: { how: "answered", answers: [] } }));
    expect(lead(el)).toBeUndefined();
    expect(el.textContent).not.toContain("Please answer the following");
  });

  it("keeps the message when it IS the question", () => {
    const el = mount(
      askRow(
        {
          fields: [choice("days", null, ["7", "30"])],
          outcome: {
            how: "answered",
            answers: [{ key: "days", values: ["30"] }],
          },
        },
        "Retention in days for the new bucket?",
      ),
    );
    expect(lead(el)).toBe("Retention in days for the new bucket?");
    expect(lines(el)).toEqual(["Retention in days for the new bucket? — 30"]);
  });

  it("shows the questions when the person would not say", () => {
    const el = mount(askRow({ outcome: { how: "declined", answers: [] } }));
    expect(lines(el)).toEqual(["Mode", "Implementor"]);
    expect(outcome(el)).toBe("declined");
  });

  it("shows the questions when the agent took them back", () => {
    const el = mount(askRow({ outcome: { how: "withdrawn", answers: [] } }));
    expect(lines(el)).toEqual(["Mode", "Implementor"]);
    expect(outcome(el)).toBe("withdrawn");
  });

  it("shows the questions of a card answered before answers were kept", () => {
    const el = mount(askRow({ outcome: { how: "answered", answers: [] } }));
    expect(lines(el)).toEqual(["Mode", "Implementor"]);
    expect(outcome(el)).toBe("answered");
  });

  it("still draws the message and the form for a question still waiting", () => {
    const el = mount(askRow({ fields: [] }, "Allow `rm -rf /tmp/x`?"));
    expect(lead(el)).toBe("Allow `rm -rf /tmp/x`?");
    expect(lines(el)).toEqual([]);
    expect(
      el.querySelector('[data-testid="conductor-ask-submit"]'),
    ).not.toBeNull();
  });
});

const option = (el: HTMLElement, field: string, value: string): HTMLElement => {
  const chip = el.querySelector<HTMLElement>(
    `[data-testid="conductor-ask-option"][data-field="${field}"][data-value="${value}"]`,
  );
  if (chip === null) throw new Error(`no option \`${value}\` for \`${field}\``);
  return chip;
};

const selected = (el: HTMLElement, field: string, value: string): boolean =>
  option(el, field, value).hasAttribute("data-active");

const otherBox = (el: HTMLElement, field: string): HTMLInputElement => {
  const box = el.querySelector<HTMLInputElement>(
    `[data-testid="conductor-ask-other"][data-field="${field}"]`,
  );
  if (box === null) throw new Error(`no "Other" box \`${field}\``);
  return box;
};

const type = (box: HTMLInputElement, words: string): void => {
  box.value = words;
  box.dispatchEvent(new Event("input", { bubbles: true }));
};

const sent = (): ReadonlyArray<AskAnswer> => {
  const call = answer.mock.calls.at(-1);
  if (call === undefined) throw new Error("the agent was told nothing");
  return call[1] as ReadonlyArray<AskAnswer>;
};

const submit = (el: HTMLElement): void => {
  el.querySelector<HTMLElement>(
    '[data-testid="conductor-ask-submit"]',
  )?.click();
};

describe("a question still waiting", () => {
  it("sends the typed words alone when they replace a pick", () => {
    const el = mount(askRow());
    option(el, "implementor", "omp").click();
    type(otherBox(el, "implementor_other"), "anthropic/claude-opus-5-5");
    expect(selected(el, "implementor", "omp")).toBe(false);
    submit(el);
    expect(sent()).toEqual([
      { key: "implementor_other", values: ["anthropic/claude-opus-5-5"] },
    ]);
  });

  it("sends the pick alone when it replaces typed words", () => {
    const el = mount(askRow());
    type(otherBox(el, "implementor_other"), "anthropic/claude-opus-5-5");
    option(el, "implementor", "omp").click();
    expect(selected(el, "implementor", "omp")).toBe(true);
    expect(otherBox(el, "implementor_other").value).toBe("");
    submit(el);
    expect(sent()).toEqual([{ key: "implementor", values: ["omp"] }]);
  });

  it("sends one answer even if the draft somehow holds both", () => {
    const el = mount(askRow());
    setAskDraft("ask:1", "implementor", ["omp"]);
    setAskDraft("ask:1", "implementor_other", ["opencode"]);
    submit(el);
    expect(sent()).toEqual([
      { key: "implementor_other", values: ["opencode"] },
    ]);
  });

  it("keeps every pick and the typed words for a multi-choice question", () => {
    const el = mount(
      askRow({
        fields: [
          multiChoice("harnesses", "Harnesses", ["omp", "claude"]),
          text("harnesses_other", "Other", "harnesses"),
        ],
      }),
    );
    option(el, "harnesses", "omp").click();
    option(el, "harnesses", "claude").click();
    type(otherBox(el, "harnesses_other"), "opencode");
    expect(selected(el, "harnesses", "omp")).toBe(true);
    expect(selected(el, "harnesses", "claude")).toBe(true);
    submit(el);
    expect(sent()).toEqual([
      { key: "harnesses", values: ["omp", "claude"] },
      { key: "harnesses_other", values: ["opencode"] },
    ]);
  });

  it("keeps one of Yes and No, and lets typed words replace them", () => {
    const el = mount(
      askRow({
        fields: [
          {
            ...choice("green", "On green", []),
            kind: "boolean",
          },
          text("green_other", "Other", "green"),
        ],
      }),
    );
    option(el, "green", YES_NO.yes).click();
    expect(selected(el, "green", YES_NO.yes)).toBe(true);
    type(otherBox(el, "green_other"), "only if the PR is mine");
    expect(selected(el, "green", YES_NO.yes)).toBe(false);
    submit(el);
    expect(sent()).toEqual([
      { key: "green_other", values: ["only if the PR is mine"] },
    ]);
  });
});
