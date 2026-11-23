// @vitest-environment happy-dom
/**
 * The stage map: six stages in fixed places, the loops a work went round
 * counted on its arrows, a ring on the stage it is in, and every stage
 * saying in words what its box says by its look — and, on a card, a stage
 * that has happened is the button into its part of the timeline.
 */

import { Option } from "effect";
import type { Filed, StageName, Stages, Visit } from "kolu-work";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import StageMap from "./StageMap";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

const MIN = 60_000;

/** A trail of `[stage, minutes]` visits, the last one open. */
const trailOf = (
  visits: ReadonlyArray<readonly [Filed, number]>,
): ReadonlyArray<Visit> =>
  visits.map(([stage, minutes], index) => ({
    stage,
    from: new Date(index * MIN).toISOString(),
    until:
      index === visits.length - 1
        ? Option.none()
        : Option.some(new Date((index + 1) * MIN).toISOString()),
    time: { agent: minutes * MIN, you: 0, ci: 0 },
    events: { from: index, until: index + 1 },
  }));

/** THE REPORTED WORK, mid-CI: planned, approved, built, reviewed six times,
 *  checked, fixed, and checked again — a full work with no merge yet. */
const REPORTED: Stages = {
  kind: "staged",
  stages: [
    { name: "plan", state: { kind: "done", ms: 60 * MIN, who: "agent" } },
    { name: "approve", state: { kind: "done", ms: 2 * MIN, who: "you" } },
    { name: "build", state: { kind: "done", ms: 99 * MIN, who: "agent" } },
    { name: "review", state: { kind: "done", ms: 48 * MIN, who: "agent" } },
    { name: "checks", state: { kind: "now", ms: 20 * MIN, who: "ci" } },
    { name: "merge", state: { kind: "not-started" } },
  ],
  events: [],
  current: "checks",
  trail: trailOf([
    ["plan", 60],
    ["approve", 2],
    ["build", 60],
    ...Array.from({ length: 6 }, () => [
      ["review", 8] as const,
      ["build", 4] as const,
    ]).flat(),
    ["checks", 12],
    ["build", 15],
    ["checks", 8],
  ]),
};

/** A trivial work in its build: no Plan, Approve or Review. */
const TRIVIAL: Stages = {
  kind: "staged",
  stages: [
    { name: "plan", state: { kind: "skipped" } },
    { name: "approve", state: { kind: "skipped" } },
    { name: "build", state: { kind: "now", ms: 5 * MIN, who: "agent" } },
    { name: "review", state: { kind: "skipped" } },
    { name: "checks", state: { kind: "not-started" } },
    { name: "merge", state: { kind: "not-started" } },
  ],
  events: [],
  current: "build",
  trail: trailOf([["build", 5]]),
};

/** A WORK SAVED BEFORE KOLU KEPT HAND-OFFS, in its unrecorded stretch: its
 *  build and review were one or the other, and nobody can say which. */
const SAVED: Stages = {
  kind: "staged",
  stages: [
    { name: "plan", state: { kind: "done", ms: 20 * MIN, who: "agent" } },
    { name: "approve", state: { kind: "done", ms: 5 * MIN, who: "you" } },
    { name: "build", state: { kind: "unrecorded", now: true } },
    { name: "review", state: { kind: "unrecorded", now: true } },
    { name: "checks", state: { kind: "done", ms: 10 * MIN, who: "ci" } },
    { name: "merge", state: { kind: "not-started" } },
  ],
  events: [],
  current: "unrecorded",
  trail: trailOf([
    ["plan", 20],
    ["approve", 5],
    ["unrecorded", 60],
    ["checks", 10],
    ["unrecorded", 5],
  ]),
};

function mount(stages: Stages) {
  const [shown, setShown] = createSignal<StageName | undefined>();
  const pressed: StageName[] = [];
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <StageMap
        stages={stages}
        size="full"
        testId="stage-map"
        index={{
          shown,
          show: (stage) => {
            pressed.push(stage);
            setShown(stage);
          },
        }}
      />
    ),
    root,
  );
  return { el: root, pressed };
}

const stage = (el: HTMLElement, name: string): HTMLElement => {
  const found = el.querySelector<HTMLElement>(
    `[data-testid="stage"][data-stage="${name}"]`,
  );
  if (found === null) throw new Error(`no stage ${name}`);
  return found;
};

const arrow = (el: HTMLElement, id: string): HTMLElement => {
  const found = el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (found === null) throw new Error(`no arrow ${id}`);
  return found;
};

describe("the stage map", () => {
  it("rings the stage the work is in, with how long it has been there this time", () => {
    const { el } = mount(REPORTED);
    const now = [
      ...el.querySelectorAll<HTMLElement>('[data-testid="stage"]'),
    ].filter((one) => one.dataset.state === "now");
    expect(now.map((one) => one.dataset.stage)).toEqual(["checks"]);
    // Twenty minutes over two runs; eight in this one.
    expect(
      stage(el, "checks").querySelector('[data-testid="stage-time"]')
        ?.textContent,
    ).toBe("20m");
    expect(
      stage(el, "checks").querySelector('[data-testid="stage-now"]')
        ?.textContent,
    ).toBe("now · 8m");
    expect(
      [
        ...el.querySelectorAll<HTMLElement>(
          '[data-testid="stage-label"][data-emphasis]',
        ),
      ].map((one) => one.dataset.stage),
    ).toEqual(["checks"]);
  });

  it("counts the loops the work went round", () => {
    const { el } = mount(REPORTED);
    expect(arrow(el, "stage-arrow-build-review").dataset.rounds).toBe("6");
    expect(arrow(el, "stage-arrow-build-review").textContent).toContain("×6");
    const checks = arrow(el, "stage-arrow-build-checks");
    expect([checks.dataset.forward, checks.dataset.back]).toEqual(["2", "1"]);
    expect(checks.textContent).toBe("→×2←×1");
    // A loop nobody went back along has a plain arrow and no count.
    expect(arrow(el, "stage-arrow-plan-approve").textContent).toBe("→");
  });

  it("dashes a stage the mode does not have, and leaves one not reached faint", () => {
    const { el } = mount(TRIVIAL);
    expect(stage(el, "review").dataset.state).toBe("skipped");
    expect(stage(el, "review").querySelector(".border-dashed")).not.toBeNull();
    expect(stage(el, "merge").dataset.state).toBe("not-started");
    expect(stage(el, "merge").querySelector(".opacity-60")).not.toBeNull();
    // Neither has had time, so neither prints one.
    expect(
      stage(el, "review").querySelector('[data-testid="stage-time"]'),
    ).toBeNull();
  });

  it("says each stage in words: its time, whose it was, where it stands and how often", () => {
    const { el } = mount(REPORTED);
    expect(stage(el, "review").title).toBe(
      "Review 48m, the agents' time, done, 6 times",
    );
    expect(stage(el, "checks").title).toBe(
      "Checks 20m, CI's time, now, 2 times",
    );
    expect(stage(el, "approve").title).toBe("Approve 2m, your time, done");
    expect(stage(el, "merge").title).toBe("Merge, not started");
    expect(stage(el, "review").querySelector(".sr-only")?.textContent).toBe(
      stage(el, "review").title,
    );
  });

  it("makes a stage that happened the button into its events, and no other", () => {
    const { el, pressed } = mount(REPORTED);
    const cells = [
      ...el.querySelectorAll<HTMLElement>('[data-testid="stage-cell"]'),
    ].map(
      (one) => one.closest<HTMLElement>('[data-testid="stage"]')?.dataset.stage,
    );
    expect(cells).toEqual(["plan", "approve", "build", "review", "checks"]);
    stage(el, "review")
      .querySelector<HTMLButtonElement>('[data-testid="stage-cell"]')
      ?.click();
    expect(pressed).toEqual(["review"]);
    expect(
      stage(el, "review")
        .querySelector('[data-testid="stage-cell"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("says a saved work's build and review were not recorded, rather than that they did not happen", () => {
    const { el } = mount(SAVED);
    for (const name of ["build", "review"]) {
      expect(stage(el, name).dataset.state).toBe("unrecorded");
      expect(stage(el, name).title).toBe(
        `${name === "build" ? "Build" : "Review"}, not recorded, now`,
      );
      // Nothing of its own to show in the timeline: the trail's stretch is.
      expect(
        stage(el, name).querySelector('[data-testid="stage-cell"]'),
      ).toBeNull();
    }
  });

  it("draws nothing for a mode with no stages", () => {
    const { el } = mount({ kind: "none" });
    expect(el.querySelector('[data-testid="stage-map"]')).toBeNull();
  });
});
