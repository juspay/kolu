// @vitest-environment happy-dom
/**
 * A QUESTION'S CHIPS ARE THE SAME BUTTONS FROM ONE PRESS TO THE NEXT.
 *
 * The options are handed to this list minted afresh — every read of the work
 * builds an `AskOption` per value — and the list's own fold re-runs on every
 * pick, because what a long list rests on includes what is picked now. Neither
 * is a reason to replace a chip: a button that is discarded and rebuilt under
 * the press that selected it drops focus and any interaction in flight on it.
 *
 * So the chips are keyed on the option's value, which is its identity, and
 * the fold is gated on what it draws.
 */

import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import {
  isAdvisorySolidDiagnostic,
  takeSolidDiagnostics,
} from "@kolu/solid-test-setup/setup";
import { type AskOption, AskOptions, askOption } from "./AskOptions";

const VALUES = ["Approve", "Ask for changes"] as const;

/** The options as a question hands them over: read again, so new objects
 *  around the same two values. */
const offered = (): ReadonlyArray<AskOption> => VALUES.map(askOption);

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics()
    .filter((event) => !isAdvisorySolidDiagnostic(event))
    .map((event) => `${event.code}: ${event.message}`);

const chips = (el: HTMLElement): ReadonlyArray<HTMLButtonElement> => [
  ...el.querySelectorAll<HTMLButtonElement>(
    '[data-testid="conductor-ask-option"]',
  ),
];

describe("the chips of one question", () => {
  it("keeps the pressed button while the list is handed over five times", () => {
    const [options, setOptions] = createSignal(offered());
    const [picked, setPicked] = createSignal<string | undefined>(undefined);
    root = document.createElement("div");
    document.body.append(root);
    const el = root;
    dispose = render(
      () => (
        <AskOptions
          field="d-1"
          options={options()}
          usedBefore={[]}
          picked={(value) => picked() === value}
          onPick={setPicked}
          searchLabel="options"
        />
      ),
      root,
    );
    flush();
    const before = chips(el);
    expect(before.map((one) => one.dataset.value)).toEqual([...VALUES]);
    takeSolidDiagnostics();

    // The press that selects an option must not take the button with it.
    before[0]?.click();
    flush();
    expect(chips(el)[0]).toBe(before[0]);
    expect(chips(el)[0]?.dataset.active).toBe("");

    // Five, not four: the diagnostic names a memo at four equal publishes.
    for (let read = 1; read <= 5; read += 1) {
      setOptions(offered());
      flush();
    }

    const after = chips(el);
    expect(after).toHaveLength(before.length);
    expect(after.every((one, index) => one === before[index])).toBe(true);
    expect(after[0]?.dataset.active).toBe("");
    expect(findings()).toEqual([]);
  });

  it("still draws what a search leaves, and what the press then says", () => {
    const many = Array.from({ length: 12 }, (_, n) =>
      askOption(`provider/model-${n}`),
    );
    const [picked, setPicked] = createSignal<string | undefined>(undefined);
    root = document.createElement("div");
    document.body.append(root);
    const el = root;
    dispose = render(
      () => (
        <AskOptions
          field="d-2"
          options={many}
          usedBefore={["provider/model-3"]}
          picked={(value) => picked() === value}
          onPick={setPicked}
          searchLabel="models"
        />
      ),
      root,
    );
    flush();
    // At rest a long list draws what was used before, and says how many more.
    expect(chips(el).map((one) => one.dataset.value)).toEqual([
      "provider/model-3",
    ]);
    expect(
      el
        .querySelector('[data-testid="conductor-ask-more"]')
        ?.getAttribute("data-hidden"),
    ).toBe("11");

    const box = el.querySelector<HTMLInputElement>(
      '[data-testid="conductor-ask-search"]',
    );
    if (box === null) throw new Error("the long list has no search box");
    box.value = "model-1";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(chips(el).map((one) => one.dataset.value)).toEqual([
      "provider/model-1",
      "provider/model-10",
      "provider/model-11",
    ]);

    // A model picked from the search stays drawn once the box is cleared.
    chips(el)[2]?.click();
    box.value = "";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(chips(el).map((one) => one.dataset.value)).toEqual([
      "provider/model-3",
      "provider/model-11",
    ]);
    expect(findings()).toEqual([]);
  });
});
