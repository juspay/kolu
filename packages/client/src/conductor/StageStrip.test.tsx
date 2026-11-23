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
  trail: [],
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
    expect(segment(el, "plan").title).toBe("Plan 4m, the agents' time, done");
    expect(segment(el, "review").title).toBe("Review, did not happen");
  });

  it("name every stage under its bar, and emphasise the one it is in", () => {
    const { el } = mount(STAGED, true);
    const labels = [
      ...el.querySelectorAll<HTMLElement>('[data-testid="stage-label"]'),
    ].map((label) => [
      label.dataset.stage,
      label.textContent,
      label.dataset.emphasis,
    ]);
    expect(labels).toEqual([
      ["plan", "Plan", undefined],
      ["approve", "Approve", undefined],
      ["build", "Build", ""],
      ["review", "Review", undefined],
      ["checks", "Checks", undefined],
      ["merge", "Merge", undefined],
    ]);
  });

  it("emphasise the last stage that happened when none is current", () => {
    const done: Stages = {
      kind: "staged",
      stages: [
        { name: "plan", state: { kind: "done", ms: MIN, who: "agent" } },
        { name: "approve", state: { kind: "done", ms: MIN, who: "you" } },
        { name: "build", state: { kind: "done", ms: MIN, who: "agent" } },
        { name: "review", state: { kind: "done", ms: MIN, who: "you" } },
        { name: "checks", state: { kind: "done", ms: MIN, who: "ci" } },
        { name: "merge", state: { kind: "done", ms: MIN, who: "ci" } },
      ],
      events: [],
      current: "merge",
      trail: [],
    };
    const { el } = mount(done, true);
    const emphasised = [
      ...el.querySelectorAll<HTMLElement>('[data-testid="stage-label"]'),
    ].filter((label) => label.dataset.emphasis === "");
    expect(emphasised.map((label) => label.dataset.stage)).toEqual(["merge"]);
  });

  it("give the colour a word: whose time it was, in every title", () => {
    const { el } = mount(STAGED, true);
    expect(segment(el, "plan").title).toContain("the agents' time");
    expect(segment(el, "approve").title).toContain("your time");
    expect(segment(el, "build").title).toContain("CI's time");
    // A stage with no colour of its own says what it is instead.
    expect(segment(el, "checks").title).toBe("Checks, not started");
  });

  it("speak every stage, with its time and where it stands", () => {
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

describe("each stage's own time", () => {
  const time = (el: HTMLElement, stage: string) =>
    el.querySelector<HTMLElement>(
      `[data-testid="stage-time"][data-stage="${stage}"]`,
    )?.textContent;

  it("prints a finished stage's duration under its label", () => {
    const { el } = mount(STAGED, true);
    expect(time(el, "plan")).toBe("4m");
    expect(time(el, "approve")).toBe("2m");
  });

  it("prints the current stage's duration, which is the one that ticks", () => {
    const { el } = mount(STAGED, true);
    expect(time(el, "build")).toBe("3m");
    // The card re-reads the stages on its clock; the strip draws the number it
    // is given, so a later reading is a longer one.
    const longer: Stages = {
      ...STAGED,
      stages: STAGED.stages.map((one) =>
        one.name === "build"
          ? { name: "build", state: { kind: "now", ms: 4 * MIN, who: "ci" } }
          : one,
      ),
    };
    dispose?.();
    root?.remove();
    expect(time(mount(longer, true).el, "build")).toBe("4m");
  });

  it("prints no time for a skipped or unreached stage", () => {
    const { el } = mount(STAGED, true);
    expect(time(el, "review")).toBeUndefined();
    expect(time(el, "checks")).toBeUndefined();
    expect(time(el, "merge")).toBeUndefined();
    expect(el.querySelectorAll('[data-testid="stage-time"]')).toHaveLength(3);
  });

  it("prints the time in one unit where the label's column is narrow", () => {
    const long: Stages = {
      kind: "staged",
      stages: STAGED.stages.map((one) =>
        one.name === "plan"
          ? {
              name: "plan",
              state: { kind: "done", ms: (14 * 60 + 20) * MIN, who: "agent" },
            }
          : one,
      ),
      events: [],
      current: "build",
      trail: [],
    };
    const { el } = mount(long, true);
    // "14h 20m" would be cut in a sixth of the row; "14h" is the one-unit
    // form, and the two-unit time stays whole in the title.
    expect(time(el, "plan")).toBe("14h");
    expect(segment(el, "plan").title).toBe(
      "Plan 14h 20m, the agents' time, done",
    );
  });

  it("keeps the time in the tooltip, and speaks it", () => {
    const { el } = mount(STAGED, true);
    expect(segment(el, "plan").title).toBe("Plan 4m, the agents' time, done");
    expect(segment(el, "build").title).toBe("Build 3m, CI's time, now");
  });

  it("goes with the strip when the mode has no stages", () => {
    const { el } = mount({ kind: "none" }, true);
    expect(el.querySelector('[data-testid="stage-strip"]')).toBeNull();
  });
});
