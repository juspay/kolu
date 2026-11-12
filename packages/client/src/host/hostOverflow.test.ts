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
    const result = computeVisibleHosts(order, "local", 400, 40, 0);
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
      0,
    );
    const after = computeVisibleHosts(
      order,
      "beta",
      containerWidth,
      trailingReserve,
      0,
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
    const result = computeVisibleHosts(order, "local", 140, 40, 0);
    expect(result).toEqual({
      visible: ["local", "a"],
      overflowed: ["b", "c"],
    });
  });

  it("PIN: switching between two hosts BOTH already inside the visible prefix still changes nothing", () => {
    const order = chips({ local: 50, a: 50, b: 50, c: 50 });
    const before = computeVisibleHosts(order, "local", 140, 40, 0);
    const after = computeVisibleHosts(order, "a", 140, 40, 0);
    expect(after).toEqual(before);
  });

  it("force-includes an overflowed active host by dropping the nearest trailing prefix member, never reordering the survivors", () => {
    // local(50) + a(50) + b(50) + c(50) = 200, budget 100 ⇒ natural prefix
    // is [local, a]; switching active to c (currently overflowed) must pull
    // it in — drop `a` (nearest the cut) to make room, keep `local` first.
    const order = chips({ local: 50, a: 50, b: 50, c: 50 });
    const result = computeVisibleHosts(order, "c", 140, 40, 0);
    expect(result.visible).toEqual(["local", "c"]);
    expect(result.overflowed).toEqual(["a", "b"]);
  });

  it("always keeps the active host visible even when it alone exceeds the reduced budget", () => {
    const order = chips({ local: 30, huge: 300 });
    const result = computeVisibleHosts(order, "huge", 140, 40, 0);
    expect(result.visible).toContain("huge");
  });
});

/** FIVE HOSTS IN A REAL CHROME BAR, with the widths the browser actually
 *  reports. Measured in the e2e lane (`features/conductor.feature`, the
 *  "minified 5 KB payload" scenario logs the row's geometry at four window
 *  widths): a host tab is 124px, the identity rail 28px, the `◆ Conductor
 *  alpha` pill 145px (tag included — it is one measured box), the control
 *  cluster 397px, and the bar's own padding plus flex gaps 60px.
 *
 *  This is where the five-host fold is proved, because the e2e worker holds
 *  one padi and its strip never folds; that lane pins the INPUT (the strip's
 *  measured width really is the row's leftover), and this pins what the
 *  arithmetic does with it — including what the Conductor entry's reserve
 *  does to the fold when the row has NOT already kept its room clear. */
describe("computeVisibleHosts — five hosts in the real chrome bar", () => {
  const CHIP = 124;
  const ADD_BUTTON_RESERVE = 38;
  const OVERFLOW_TRIGGER_RESERVE = 44;
  /** The measured `◆ Conductor alpha` pill, whole. */
  const CONDUCTOR = 145;
  /** The strip's measured width at a given window, from the row's geometry:
   *  identity (28) + conductor pill (145) + control cluster (397) + the bar's
   *  padding and gaps (60) are taken before the strip sees anything. */
  const stripAt = (window: number): number =>
    window - 28 - CONDUCTOR - 397 - 60;
  const five = chips({ local: CHIP, a: CHIP, b: CHIP, c: CHIP, d: CHIP });
  const seating = (window: number, pinned = 0) =>
    computeVisibleHosts(
      five,
      "local",
      stripAt(window) - ADD_BUTTON_RESERVE,
      OVERFLOW_TRIGGER_RESERVE,
      pinned,
    );

  it("seats every tab in a wide window", () => {
    // 1920 ⇒ strip 1290 ⇒ budget 1252 against 620px of tabs.
    expect(seating(1920).overflowed).toEqual([]);
  });

  it("folds into `⋯ +N` well before the tabs reach the conductor entry", () => {
    // 1024 ⇒ strip 394 ⇒ budget 356, trigger reserved ⇒ 312 ⇒ two tabs seated.
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

  it("takes the Conductor entry's measured width off the budget, so a tab that would reach the pill folds instead", () => {
    // A row that has NOT kept the pill's room clear — the strip's box runs
    // under the entry — reports the overlap as the pinned reserve. 1920 seats
    // all five with 1252px of budget; take the pill's measured 145 off a strip
    // that is only just wide enough and the last tab must go into `⋯ +N`
    // rather than sit where the pill is drawn.
    const window = 1270; // strip 640 ⇒ budget 602 against 620px of tabs… just short
    expect(seating(window).visible).toEqual(["local", "a", "b", "c"]);
    expect(seating(window, CONDUCTOR).visible).toEqual(["local", "a", "b"]);
    expect(seating(window, CONDUCTOR).overflowed).toEqual(["c", "d"]);
  });

  it("reserves nothing when there is no such entry in the row", () => {
    expect(seating(1920, 0)).toEqual(seating(1920));
  });
});
