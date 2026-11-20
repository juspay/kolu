// @vitest-environment happy-dom
/**
 * The stage strip is one thin line now, and what it says about each stage
 * did not get thinner with it: every segment still carries its stage, its
 * state, whose time it was and a spoken label, and a stage that has had time
 * is still the button into its part of the timeline. On screen, one stage is
 * named — the one the work is in.
 */

import type { StageName, Stages } from "kolu-work";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import StageStrip from "./StageStrip";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

const MIN = 60_000;

/** One stage in each state: two done (agents', yours), the current one (CI's
 *  time), one skipped and two not reached. */
const STAGED: Stages = {
  kind: "staged",
  stages: [
    { name: "plan", state: { kind: "done", ms: 4 * MIN, who: "agent" } },
    { name: "approve", state: { kind: "done", ms: 2 * MIN, who: "you" } },
    { name: "build", state: { kind: "now", ms: 3 * MIN, who: "ci" } },
    { name: "review", state: { kind: "skipped" } },
    { name: "checks", state: { kind: "not-started" } },
    { name: "merge", state: { kind: "not-started" } },
  ],
  events: [],
  current: "build",
};

function mount(stages: Stages, withIndex: boolean) {
  const [shown, setShown] = createSignal<StageName | undefined>();
  const pressed: StageName[] = [];
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <StageStrip
        stages={stages}
        size="full"
        testId="stage-strip"
        index={
          withIndex
            ? {
                shown,
                show: (stage) => {
                  pressed.push(stage);
                  setShown(stage);
                },
              }
            : undefined
        }
      />
    ),
    root,
  );
  return { el: root, pressed };
}

const segment = (el: HTMLElement, stage: string): HTMLElement => {
  const found = el.querySelector<HTMLElement>(
    `[data-testid="stage"][data-stage="${stage}"]`,
  );
  if (found === null) throw new Error(`no segment for ${stage}`);
  return found;
};

describe("the stage strip's segments", () => {
  it("carry their stage, state and whose time it was", () => {
    const { el } = mount(STAGED, true);
    const read = [
      ...el.querySelectorAll<HTMLElement>('[data-testid="stage"]'),
    ].map((li) => [li.dataset.stage, li.dataset.state, li.dataset.who]);
    expect(read).toEqual([
      ["plan", "done", "agent"],
      ["approve", "done", "you"],
      ["build", "now", "ci"],
      ["review", "skipped", undefined],
      ["checks", "not-started", undefined],
      ["merge", "not-started", undefined],
    ]);
    expect(segment(el, "plan").title).toBe("Plan 4m");
    expect(segment(el, "review").getAttribute("title")).toBeNull();
  });

  it("speak every stage, though the line names only one", () => {
    const { el } = mount(STAGED, true);
    const spoken = (stage: string) =>
      segment(el, stage).querySelector(".sr-only")?.textContent;
    expect(spoken("plan")).toBe("Plan 4m, the agents' time, done");
    expect(spoken("build")).toBe("Build 3m, CI's time, now");
    expect(spoken("review")).toBe("Review, did not happen");
    expect(spoken("checks")).toBe("Checks, not started");
    expect(el.querySelector('[aria-label="Stages"]')?.tagName).toBe("OL");
  });

  it("are buttons into the timeline only for a stage that had time", () => {
    const { el, pressed } = mount(STAGED, true);
    const cell = (stage: string) =>
      segment(el, stage).querySelector<HTMLButtonElement>(
        '[data-testid="stage-cell"]',
      );
    expect(cell("plan")).not.toBeNull();
    expect(cell("approve")).not.toBeNull();
    expect(cell("build")).not.toBeNull();
    expect(cell("review")).toBeNull();
    expect(cell("checks")).toBeNull();

    cell("approve")?.click();
    expect(pressed).toEqual(["approve"]);
    expect(cell("approve")?.getAttribute("aria-pressed")).toBe("true");
    expect(segment(el, "approve").dataset.shown).toBe("");
    expect(cell("plan")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("stay plain in a hover card, which has no timeline to index", () => {
    const { el } = mount(STAGED, false);
    expect(el.querySelectorAll('[data-testid="stage-cell"]')).toHaveLength(0);
    expect(el.querySelectorAll('[data-testid="stage"]')).toHaveLength(6);
  });

  it("keep a positioned box round each spoken label", () => {
    // The sr-only label is placed against its nearest positioned ancestor;
    // a segment that is not one lets the pane grow a second scrollbar.
    const { el } = mount(STAGED, true);
    for (const label of el.querySelectorAll(".sr-only")) {
      expect(label.parentElement?.classList.contains("relative")).toBe(true);
    }
  });
});

describe("the stage named beside the line", () => {
  it("is the stage the work is in, with its time", () => {
    const { el } = mount(STAGED, true);
    expect(el.querySelector('[data-testid="stage-now"]')?.textContent).toBe(
      "Build · 3m",
    );
  });

  it("is absent while no stage is current", () => {
    const { el } = mount({ kind: "unset" }, true);
    expect(el.querySelectorAll('[data-testid="stage"]')).toHaveLength(6);
    expect(el.querySelector('[data-testid="stage-now"]')).toBeNull();
  });

  it("goes with the strip when the mode has no stages", () => {
    const { el } = mount({ kind: "none" }, true);
    expect(el.querySelector('[data-testid="stage-strip"]')).toBeNull();
  });
});
