// @vitest-environment happy-dom
/**
 * The trail under a picked work: one segment per visit, as wide as it was
 * long, the open one ringed, a run of review rounds labelled once, the
 * stretch nobody recorded set apart — and each segment the button into that
 * visit's events.
 */

import { Option } from "effect";
import type { Filed, Visit } from "kolu-work";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import StageTrail from "./StageTrail";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

const MIN = 60_000;

/** A trail of `[stage, minutes]` visits; the last is open when `open`. */
const trailOf = (
  visits: ReadonlyArray<readonly [Filed, number]>,
  open = true,
): ReadonlyArray<Visit> =>
  visits.map(([stage, minutes], index) => ({
    stage,
    from: new Date(index * MIN).toISOString(),
    until:
      open && index === visits.length - 1
        ? Option.none()
        : Option.some(new Date((index + 1) * MIN).toISOString()),
    time: { agent: minutes * MIN, you: 0, ci: 0 },
    events: { from: index, until: index + 1 },
  }));

const REPORTED = trailOf([
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
]);

function mount(trail: ReadonlyArray<Visit>) {
  const [shown, setShown] = createSignal<number | undefined>();
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => <StageTrail trail={trail} index={{ shown, show: setShown }} />,
    root,
  );
  return { el: root, shown };
}

const visits = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>('[data-testid="trail-visit"]'),
];

describe("the trail", () => {
  it("draws one segment per visit, in order, as wide as each was long", () => {
    const { el } = mount(REPORTED);
    expect(visits(el).map((one) => one.dataset.stage)).toEqual(
      REPORTED.map((one) => one.stage),
    );
    // Grown by its time: an hour's Plan is thirty Approves of two minutes.
    expect(visits(el)[0]?.style.flexGrow).toBe(String(60 * MIN));
    expect(visits(el)[1]?.style.flexGrow).toBe(String(2 * MIN));
  });

  it("rings the visit the work is in, and only that one", () => {
    const { el } = mount(REPORTED);
    expect(
      visits(el)
        .filter((one) => one.dataset.now !== undefined)
        .map((one) => one.dataset.visit),
    ).toEqual([String(REPORTED.length - 1)]);
    expect(visits(el).at(-1)?.title).toBe("18. Checks 8m, now");
  });

  it("labels six review rounds once", () => {
    const { el } = mount(REPORTED);
    expect(
      [...el.querySelectorAll<HTMLElement>('[data-testid="trail-label"]')].map(
        (one) => one.textContent,
      ),
    ).toEqual([
      "Plan 1h",
      "Approve 2m",
      "Build 1h",
      "6 review rounds · 1h",
      "Checks 12m",
      "Build 15m",
      "Checks 8m · now",
    ]);
  });

  it("sets apart a stretch nobody recorded, and says so", () => {
    const { el } = mount(
      trailOf(
        [
          ["plan", 20],
          ["unrecorded", 90],
          ["checks", 10],
        ],
        false,
      ),
    );
    const unrecorded = visits(el)[1];
    expect(unrecorded?.dataset.stage).toBe("unrecorded");
    expect(unrecorded?.className).toContain("mx-1");
    expect(unrecorded?.title).toBe(
      "2. Not recorded 1h 30m, the build and the review were not recorded for this stretch",
    );
    expect(
      el.querySelectorAll('[data-testid="trail-label"]')[1]?.textContent,
    ).toBe("Not recorded 1h");
  });

  it("shows a visit's events when it is pressed", () => {
    const { el, shown } = mount(REPORTED);
    visits(el)[3]
      ?.querySelector<HTMLButtonElement>('[data-testid="trail-visit-cell"]')
      ?.click();
    expect(shown()).toBe(3);
    expect(
      visits(el)[3]
        ?.querySelector('[data-testid="trail-visit-cell"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
