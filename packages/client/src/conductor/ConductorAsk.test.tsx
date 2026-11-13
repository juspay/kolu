// @vitest-environment happy-dom
/**
 * A QUESTION THAT HAS BEEN ANSWERED IS STILL A QUESTION.
 *
 * What a settled card owes a reader is the exchange — every question, and what
 * was said to it — rather than the one word for how it ended. These hold the
 * four endings a card can be found in a day later: answered with picks and
 * typed words, declined, withdrawn, and a card settled by a kolu that kept no
 * answers at all. The last one is the compatibility case: a conversation on
 * disk from before, which must still read as the questions it asked.
 *
 * The adapter's wrapper sentence is held here too, because it is what the
 * human saw INSTEAD of their answer: a form whose fields carry their own
 * labels does not print it, and an ask whose message IS the question (a
 * permission request, a single unlabelled field) still does.
 */

import type { AskField, ConductorAskRow } from "kolu-common/conductor";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./useConductor", () => ({
  // A settled card answers nothing — the form's buttons are gone — so the
  // conversation face is here only to be constructible.
  useConductor: () => ({ answer: () => {} }),
}));

import ConductorAsk from "./ConductorAsk";

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

/** The shape the Claude Code adapter sends for an `AskUserQuestion`: a wrapper
 *  sentence, labelled questions, and an "Other" box attached to one of them. */
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
});

/** Every question line as a person reads it, in order. */
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
    // The typed "Other" joins the question it extends rather than standing as
    // a question of its own — that is how it was asked.
    expect(lines(el)).toEqual([
      "Mode — trivial",
      "Implementor — omp · anthropic/claude-opus-5-5",
    ]);
    expect(outcome(el)).toBe("answered");
    // The form is GONE: a settled question is not answerable twice.
    expect(el.querySelector('[data-testid="conductor-ask-submit"]')).toBeNull();
  });

  it("does not print the adapter's wrapper sentence over labelled fields", () => {
    const el = mount(askRow({ outcome: { how: "answered", answers: [] } }));
    expect(lead(el)).toBeUndefined();
    expect(el.textContent).not.toContain("Please answer the following");
  });

  it("keeps the message when it IS the question", () => {
    // One unlabelled field: the question travels as the ask's own message, so
    // dropping it would leave a card asking nothing.
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
    // A conversation restored from disk: `answered`, and nothing recorded per
    // field. The questions are still the record.
    const el = mount(askRow({ outcome: { how: "answered", answers: [] } }));
    expect(lines(el)).toEqual(["Mode", "Implementor"]);
    expect(outcome(el)).toBe("answered");
  });

  it("still draws the message and the form for a question still waiting", () => {
    // A permission request: no fields, so the message is the whole ask.
    const el = mount(askRow({ fields: [] }, "Allow `rm -rf /tmp/x`?"));
    expect(lead(el)).toBe("Allow `rm -rf /tmp/x`?");
    expect(lines(el)).toEqual([]);
    expect(
      el.querySelector('[data-testid="conductor-ask-submit"]'),
    ).not.toBeNull();
  });
});
