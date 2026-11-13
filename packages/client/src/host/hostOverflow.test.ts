/**
 * hostOverflow — pins the "active chip + as-many-as-fit" decision, in
 * particular the W4 iteration-2 invariant: a HOST SWITCH never changes the
 * strip's layout, only a WINDOW RESIZE does. Component-level rendering isn't
 * exercised here (this repo has no DOM-testing-library harness — see
 * `hostOverflow.ts`'s file header); these are pure data-in/data-out checks
 * against the same function `HostSelectorStrip.tsx` calls with real measured
 * widths.
 */

import { describe, expect, it } from "vitest";
import { computeVisibleHosts, type HostFit } from "./hostOverflow";

const chips = (widths: Record<string, number>): HostFit[] =>
  Object.entries(widths).map(([key, width]) => ({ key, width }));

describe("computeVisibleHosts — everything fits", () => {
  it("shows every chip, in pool order, when the total width is within budget", () => {
    const order = chips({ local: 80, a: 90, b: 100 });
    const result = computeVisibleHosts(order, "local", 400, 40);
    expect(result).toEqual({ visible: ["local", "a", "b"], overflowed: [] });
  });

  it("PIN: switching the active host changes NOTHING when every chip already fits — the strip's visible set and order are identical before and after `setActiveHost` (the iteration-2 regression this file exists to prevent: iteration 1's active chip inflated with its daemon sub-chips, so a switch reflowed every chip after it — a chip's width no longer depends on `activeKey` at all, so this must hold for ANY pair of hosts)", () => {
    const order = chips({ local: 80, alpha: 95, beta: 110, gamma: 70 });
    const containerWidth = 500;
    const trailingReserve = 40;

    const before = computeVisibleHosts(
      order,
      "local",
      containerWidth,
      trailingReserve,
    );
    const after = computeVisibleHosts(
      order,
      "beta",
      containerWidth,
      trailingReserve,
    );

    expect(after).toEqual(before);
    expect(before.visible).toEqual(["local", "alpha", "beta", "gamma"]);
  });
});

describe("computeVisibleHosts — overflow", () => {
  it("keeps a contiguous prefix visible and overflows the rest, reserving room for the trigger", () => {
    // local(50) + a(50) + b(50) + c(50) = 200, container 140, reserve 40 ⇒
    // budget 100 ⇒ local + a fit (100), b/c overflow.
    const order = chips({ local: 50, a: 50, b: 50, c: 50 });
    const result = computeVisibleHosts(order, "local", 140, 40);
    expect(result).toEqual({
      visible: ["local", "a"],
      overflowed: ["b", "c"],
    });
  });

  it("PIN: switching between two hosts BOTH already inside the visible prefix still changes nothing", () => {
    const order = chips({ local: 50, a: 50, b: 50, c: 50 });
    const before = computeVisibleHosts(order, "local", 140, 40);
    const after = computeVisibleHosts(order, "a", 140, 40);
    expect(after).toEqual(before);
  });

  it("force-includes an overflowed active host by dropping the nearest trailing prefix member, never reordering the survivors", () => {
    // local(50) + a(50) + b(50) + c(50) = 200, budget 100 ⇒ natural prefix
    // is [local, a]; switching active to c (currently overflowed) must pull
    // it in — drop `a` (nearest the cut) to make room, keep `local` first.
    const order = chips({ local: 50, a: 50, b: 50, c: 50 });
    const result = computeVisibleHosts(order, "c", 140, 40);
    expect(result.visible).toEqual(["local", "c"]);
    expect(result.overflowed).toEqual(["a", "b"]);
  });

  it("always keeps the active host visible even when it alone exceeds the reduced budget", () => {
    const order = chips({ local: 30, huge: 300 });
    const result = computeVisibleHosts(order, "huge", 140, 40);
    expect(result.visible).toContain("huge");
  });
});

/** FIVE HOSTS IN A REAL CHROME BAR, with the widths the browser actually
 *  reports — re-measured off the live bar on a host tab at 1920, 1280 and
 *  1024px windows: a host tab is 124px, the identity rail 28px, the
 *  `◆ Conductor alpha` tab at the head of the row 144.5px (tag included — it
 *  is one measured box), the control cluster 397px, and the bar's own padding
 *  (24) plus its three flex gaps (36) 60px.
 *
 *  This is where the five-host fold is proved, because the e2e worker holds
 *  one padi and its strip never folds; that lane pins the INPUT (the strip's
 *  measured width really is the row's leftover, Conductor tab and all), and
 *  this pins what the arithmetic does with it. */
describe("computeVisibleHosts — five hosts in the real chrome bar", () => {
  const CHIP = 124;
  const ADD_BUTTON_RESERVE = 38;
  const OVERFLOW_TRIGGER_RESERVE = 44;
  /** The measured `◆ Conductor alpha` tab, whole. */
  const CONDUCTOR = 144.5;
  /** The strip's measured width at a given window, from the row's geometry:
   *  identity (28) + the Conductor's tab (144.5) + control cluster (397) + the
   *  bar's padding and gaps (60) are taken before the strip sees anything.
   *  Measured 1290.5 / 650.5 / 394.5 at 1920 / 1280 / 1024. */
  const stripAt = (window: number): number =>
    window - 28 - CONDUCTOR - 397 - 60;
  const five = chips({ local: CHIP, a: CHIP, b: CHIP, c: CHIP, d: CHIP });
  const seating = (window: number) =>
    computeVisibleHosts(
      five,
      "local",
      stripAt(window) - ADD_BUTTON_RESERVE,
      OVERFLOW_TRIGGER_RESERVE,
    );

  it("seats every tab in a wide window", () => {
    // 1920 ⇒ strip 1290.5 ⇒ budget 1252.5 against 620px of tabs.
    expect(seating(1920).overflowed).toEqual([]);
  });

  it("folds into `⋯ +N` before the tabs reach the control cluster", () => {
    // 1024 ⇒ strip 394.5 ⇒ budget 356.5, trigger reserved ⇒ 312.5 ⇒ two seated.
    expect(seating(1024)).toEqual({
      visible: ["local", "a"],
      overflowed: ["b", "c", "d"],
    });
    // The seated tabs plus the trigger fit the strip itself — the fold is only
    // worth anything if what it leaves behind cannot overflow the row.
    expect(
      2 * CHIP + OVERFLOW_TRIGGER_RESERVE + ADD_BUTTON_RESERVE,
    ).toBeLessThanOrEqual(stripAt(1024));
  });

  it("keeps folding as the window narrows, down to the active tab alone", () => {
    expect(seating(900).visible).toEqual(["local"]);
    expect(seating(820).visible).toEqual(["local"]);
  });

  it("seats one tab fewer at a window just short of all five", () => {
    // 1270 ⇒ strip 640.5 ⇒ budget 602.5 against 620px of tabs, trigger
    // reserved ⇒ 558.5 ⇒ four seated.
    expect(seating(1270).visible).toEqual(["local", "a", "b", "c"]);
    expect(seating(1270).overflowed).toEqual(["d"]);
  });
});
