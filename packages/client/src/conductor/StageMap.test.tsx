// @vitest-environment happy-dom
/**
 * The stage map: six stages in fixed places, the loops a work went round
 * counted on its arrows (exactly, or from below across a doubt), a ring on
 * where it is, a doubt between two stages as its own mark, and every stage
 * saying in words what its box says by its look — and, on a card, a stage
 * that has happened, or a doubt's mark, is the button into its part of the
 * timeline.
 */

import { Option } from "effect";
import type { Doubt, Filed, StageName, Stages, Visit } from "kolu-work";
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

/** A trail of `[stage, minutes]` visits, the last one open unless `ended`. */
const trailOf = (
  visits: ReadonlyArray<readonly [Filed, number]>,
  ended = false,
): ReadonlyArray<Visit> =>
  visits.map(([stage, minutes], index) => ({
    stage,
    from: new Date(index * MIN).toISOString(),
    until:
      index === visits.length - 1 && !ended
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
    {
      name: "checks",
      state: { kind: "now", ms: 20 * MIN, here: 8 * MIN, who: "ci" },
    },
    { name: "merge", state: { kind: "not-started" } },
  ],
  events: [],
  where: { kind: "in", place: "checks" },
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

/** A trivial work in its first build: no Plan, Approve or Review. */
const TRIVIAL: Stages = {
  kind: "staged",
  stages: [
    { name: "plan", state: { kind: "skipped" } },
    { name: "approve", state: { kind: "skipped" } },
    {
      name: "build",
      state: { kind: "now", ms: 5 * MIN, here: 5 * MIN, who: "agent" },
    },
    { name: "review", state: { kind: "skipped" } },
    { name: "checks", state: { kind: "not-started" } },
    { name: "merge", state: { kind: "not-started" } },
  ],
  events: [],
  where: { kind: "in", place: "build" },
  trail: trailOf([["build", 5]]),
};

/** A WORK SAVED BEFORE KOLU KEPT HAND-OFFS, in a doubt: its build and
 *  review were one or the other, and nobody can say which. Its CI ran
 *  twice. */
const SAVED: Stages = {
  kind: "staged",
  stages: [
    { name: "plan", state: { kind: "done", ms: 20 * MIN, who: "agent" } },
    { name: "approve", state: { kind: "done", ms: 5 * MIN, who: "you" } },
    { name: "build", state: { kind: "unrecorded" } },
    { name: "review", state: { kind: "unrecorded" } },
    { name: "checks", state: { kind: "done", ms: 10 * MIN, who: "ci" } },
    { name: "merge", state: { kind: "not-started" } },
  ],
  events: [],
  where: { kind: "in", place: "build-or-review" },
  trail: trailOf([
    ["plan", 20],
    ["approve", 5],
    ["build-or-review", 60],
    ["checks", 10],
    ["build-or-review", 5],
  ]),
};

/** ... and after the first hand-offs since: the implementor, then two
 *  recorded rounds. Build has time of its own; Review still has none. */
const HANDED: Stages = {
  kind: "staged",
  stages: [
    { name: "plan", state: { kind: "done", ms: 20 * MIN, who: "agent" } },
    { name: "approve", state: { kind: "done", ms: 5 * MIN, who: "you" } },
    {
      name: "build",
      state: { kind: "now", ms: 15 * MIN, here: 5 * MIN, who: "agent" },
    },
    { name: "review", state: { kind: "unrecorded" } },
    { name: "checks", state: { kind: "not-started" } },
    { name: "merge", state: { kind: "not-started" } },
  ],
  events: [],
  where: { kind: "in", place: "build" },
  trail: trailOf([
    ["plan", 20],
    ["approve", 5],
    ["build-or-review", 35],
    ["build", 5],
    ["build", 5],
    ["build", 5],
  ]),
};

/** A merged work: it ended in Merge. */
const MERGED: Stages = {
  kind: "staged",
  stages: [
    { name: "plan", state: { kind: "skipped" } },
    { name: "approve", state: { kind: "skipped" } },
    { name: "build", state: { kind: "done", ms: 40 * MIN, who: "agent" } },
    { name: "review", state: { kind: "skipped" } },
    { name: "checks", state: { kind: "done", ms: 30 * MIN, who: "ci" } },
    { name: "merge", state: { kind: "done", ms: 10 * MIN, who: "you" } },
  ],
  events: [],
  where: { kind: "ended-in", place: "merge" },
  trail: trailOf(
    [
      ["build", 40],
      ["checks", 30],
      ["merge", 10],
    ],
    true,
  ),
};

function mount(stages: Stages) {
  const [shown, setShown] = createSignal<StageName | Doubt | undefined>();
  const pressed: Array<StageName | Doubt> = [];
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

/** The box a stage is drawn in: its button, or its plain box. */
const box = (el: HTMLElement, name: string): HTMLElement => {
  const found = stage(el, name).firstElementChild;
  if (!(found instanceof HTMLElement)) throw new Error(`no box ${name}`);
  return found;
};

/** Which stages are ringed. */
const ringed = (el: HTMLElement): ReadonlyArray<string> =>
  ["plan", "approve", "build", "review", "checks", "merge"].filter((name) =>
    box(el, name).classList.contains("ring-2"),
  );

describe("the stage map", () => {
  it("rings the stage the work is in, and says this visit's time inside it when it is not the whole", () => {
    const { el } = mount(REPORTED);
    expect(ringed(el)).toEqual(["checks"]);
    // Twenty minutes over two runs; eight in this one.
    expect(
      stage(el, "checks").querySelector('[data-testid="stage-time"]')
        ?.textContent,
    ).toBe("20m");
    const now = stage(el, "checks").querySelector('[data-testid="stage-now"]');
    expect(now?.textContent).toBe("now 8m");
    // Inside the ringed box, so the ring never covers it.
    expect(box(el, "checks").contains(now ?? null)).toBe(true);
    expect(
      [
        ...el.querySelectorAll<HTMLElement>(
          '[data-testid="stage-label"][data-emphasis]',
        ),
      ].map((one) => one.dataset.stage),
    ).toEqual(["checks"]);
  });

  it("draws no third line when this visit is the stage's whole time", () => {
    const { el } = mount(TRIVIAL);
    expect(ringed(el)).toEqual(["build"]);
    expect(el.querySelector('[data-testid="stage-now"]')).toBeNull();
  });

  it("counts the loops the work went round, exactly", () => {
    const { el } = mount(REPORTED);
    expect(arrow(el, "stage-arrow-build-review").dataset.rounds).toBe("6");
    expect(arrow(el, "stage-arrow-build-review").textContent).toContain("×6");
    const checks = arrow(el, "stage-arrow-build-checks");
    expect([checks.dataset.forward, checks.dataset.back]).toEqual(["2", "1"]);
    expect(checks.textContent).toBe("→×2←×1");
    // A loop nobody went back along has a plain arrow and no count.
    expect(arrow(el, "stage-arrow-plan-approve").textContent).toBe("→");
  });

  it("counts across a doubt only from below: unknown, or at least", () => {
    const saved = mount(SAVED).el;
    const loop = arrow(saved, "stage-arrow-build-review");
    expect(loop.dataset.rounds).toBe("?");
    expect(loop.textContent).toContain("↑↓×?");
    const checks = arrow(saved, "stage-arrow-build-checks");
    expect([checks.dataset.forward, checks.dataset.back]).toEqual(["?", "?"]);
    expect(checks.textContent).toBe("→×?←×?");
    expect(stage(saved, "review").title).toBe(
      "Review, not recorded, an unknown number of times",
    );
    dispose?.();
    root?.remove();
    const handed = mount(HANDED).el;
    expect(stage(handed, "build").title).toBe(
      "Build 15m, the agents' time, now, 5m this time, at least 3 times",
    );
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
      "Checks 20m, CI's time, now, 8m this time, 2 times",
    );
    expect(stage(el, "approve").title).toBe("Approve 2m, your time, done");
    expect(stage(el, "merge").title).toBe("Merge, not started");
    expect(stage(el, "review").querySelector(".sr-only")?.textContent).toBe(
      stage(el, "review").title,
    );
  });

  it("makes a stage that happened the button into its events, and fills it while shown, with no outline", () => {
    const { el, pressed } = mount(REPORTED);
    const cells = [
      ...el.querySelectorAll<HTMLElement>('[data-testid="stage-cell"]'),
    ].map(
      (one) => one.closest<HTMLElement>('[data-testid="stage"]')?.dataset.stage,
    );
    expect(cells).toEqual(["plan", "approve", "build", "review", "checks"]);
    const review = stage(el, "review").querySelector<HTMLButtonElement>(
      '[data-testid="stage-cell"]',
    );
    review?.click();
    expect(pressed).toEqual(["review"]);
    expect(review?.getAttribute("aria-pressed")).toBe("true");
    expect(review?.classList.contains("bg-stage-review/20")).toBe(true);
    expect(review?.className).not.toContain("outline");
    // The ring stays where the work is.
    expect(ringed(el)).toEqual(["checks"]);
  });

  it("draws a doubt as its own mark between its two boxes: the time, the words, a button", () => {
    const { el, pressed } = mount(SAVED);
    const mark = arrow(
      el,
      "stage-arrow-build-review",
    ).querySelector<HTMLElement>('[data-testid="stage-doubt"]');
    expect(mark?.dataset.doubt).toBe("build-or-review");
    expect(mark?.tagName).toBe("BUTTON");
    expect(
      mark?.querySelector('[data-testid="stage-doubt-time"]')?.textContent,
    ).toBe("1h");
    expect(mark?.getAttribute("aria-label")).toBe(
      "Build or Review, 1h 5m. kolu did not record which.",
    );
    mark?.click();
    expect(pressed).toEqual(["build-or-review"]);
    expect(mark?.getAttribute("aria-pressed")).toBe("true");
    // No doubt between Plan and Approve: no mark there.
    expect(
      arrow(el, "stage-arrow-plan-approve").querySelector(
        '[data-testid="stage-doubt"]',
      ),
    ).toBeNull();
  });

  it("rings both boxes of the doubt the work is in, hatched, each name on a plate", () => {
    const { el } = mount(SAVED);
    expect(ringed(el)).toEqual(["build", "review"]);
    for (const name of ["build", "review"]) {
      expect(stage(el, name).dataset.state).toBe("unrecorded");
      expect(box(el, name).className).toContain("repeating-linear-gradient");
      const label = stage(el, name).querySelector<HTMLElement>(
        '[data-testid="stage-label"]',
      );
      expect(label?.classList.contains("bg-surface-0")).toBe(true);
      // Nothing of its own to show in the timeline: the doubt's mark has.
      expect(
        stage(el, name).querySelector('[data-testid="stage-cell"]'),
      ).toBeNull();
    }
  });

  it("draws one box of a pair plain once it has time of its own, and the other still hatched", () => {
    const { el } = mount(HANDED);
    expect(stage(el, "build").dataset.state).toBe("now");
    expect(box(el, "build").className).not.toContain(
      "repeating-linear-gradient",
    );
    expect(stage(el, "review").dataset.state).toBe("unrecorded");
    expect(box(el, "review").className).toContain("repeating-linear-gradient");
    expect(ringed(el)).toEqual(["build"]);
  });

  it("marks a finished work's last stage by its bold name and its words, never a ring or a thicker border", () => {
    const { el } = mount(MERGED);
    expect(ringed(el)).toEqual([]);
    expect(box(el, "merge").className).not.toContain("border-2");
    const label = stage(el, "merge").querySelector<HTMLElement>(
      '[data-testid="stage-label"]',
    );
    expect(label?.dataset.emphasis).toBe("");
    expect(label?.classList.contains("font-semibold")).toBe(true);
    expect(stage(el, "merge").title).toBe(
      "Merge 10m, your time, done, the work ended here",
    );
  });

  it("draws nothing for a mode with no stages", () => {
    const { el } = mount({ kind: "none" });
    expect(el.querySelector('[data-testid="stage-map"]')).toBeNull();
  });
});
