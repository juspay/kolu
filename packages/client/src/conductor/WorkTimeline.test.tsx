// @vitest-environment happy-dom
/**
 * THE TIMELINE IS A LINE, AND ITS LENGTHS ARE THE WAITS.
 *
 * Two events a minute apart sit close; a three-hour wait is a visibly longer
 * stretch of line, with the time printed on it. A long wait cannot push the
 * rows off the page: the scale is clamped in `timelineGap.test.ts`, and this
 * test holds that the row really does carry that gap.
 */

import {
  joinWork,
  openWork,
  takeOver,
  type Work,
  type WorkId,
} from "kolu-work";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineShown } from "./timelineView";
import WorkTimeline from "./WorkTimeline";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

const T0 = Date.parse("2026-11-16T01:00:00.000Z");
const at = (ms: number): string => new Date(T0 + ms).toISOString();

const MIN = 60_000;

/** A work whose timeline has a minute's wait and then a three-hour one. */
const staged = (): Work => {
  const opened = openWork({
    key: { kind: "branch", host: "local", repo: "/r", branch: "waits" },
    title: "A work that waited",
    at: at(0),
    request: { kind: "none" },
  });
  const joined = joinWork(opened, {
    terminal: "t",
    role: "planner",
    at: at(MIN),
  });
  return takeOver(joined, "t", at(MIN + 3 * 60 * MIN));
};

function mount(work: Work): HTMLElement {
  const shown: TimelineShown = {
    view: { kind: "whole" },
    folded: { kind: "stage", stage: "build" },
    rows: work.events.map((_, index) => ({ kind: "event", index })),
    total: work.events.length,
  };
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <WorkTimeline
        id={"branch:local/%2Fr/waits" as WorkId}
        work={work}
        shown={shown}
        onWhole={() => {}}
        now={T0 + 4 * 60 * MIN}
      />
    ),
    root,
  );
  return root;
}

const rows = (el: HTMLElement): ReadonlyArray<HTMLElement> => [
  ...el.querySelectorAll<HTMLElement>('[data-testid="work-event"]'),
];

/** The row at `index`, or a test failure that says why there is none. */
const row = (el: HTMLElement, index: number): HTMLElement => {
  const found = rows(el)[index];
  if (found === undefined) throw new Error(`the timeline has no row ${index}`);
  return found;
};

const gapOf = (one: HTMLElement): number =>
  Number.parseFloat(one.style.paddingBottom || "0");

describe("a work's timeline", () => {
  it("makes a three-hour wait longer than a minute's", () => {
    const el = mount(staged());
    // Rows: requested → joined (one minute) → taken over (three hours). Each
    // row's gap is the wait to the NEXT row, so the second carries the long
    // one and the last has none.
    expect(rows(el)).toHaveLength(3);
    expect(gapOf(row(el, 1))).toBeGreaterThan(gapOf(row(el, 0)));
    expect(gapOf(row(el, 1))).toBeGreaterThan(40);
    expect(gapOf(row(el, 2))).toBe(0);
  });

  it("prints the time on a long gap only", () => {
    const el = mount(staged());
    const words = [
      ...el.querySelectorAll<HTMLElement>('[data-testid="timeline-gap-words"]'),
    ].map((one) => one.textContent);
    expect(words).toHaveLength(1);
    expect(words[0]).toBe("3h");
  });
});
