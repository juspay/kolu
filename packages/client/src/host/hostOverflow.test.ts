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

describe("computeVisibleHosts — five hosts in the real chrome bar", () => {
  const CHIP = 124;
  const ADD_BUTTON_RESERVE = 38;
  const OVERFLOW_TRIGGER_RESERVE = 44;
  const CONDUCTOR = 144.5;
  const IDENTITY_W = 28;
  const CONTROL_CLUSTER_W = 397;
  const BAR_PADDING_AND_GAPS_W = 60;
  const stripAt = (window: number): number =>
    window -
    IDENTITY_W -
    CONDUCTOR -
    CONTROL_CLUSTER_W -
    BAR_PADDING_AND_GAPS_W;
  const five = chips({ local: CHIP, a: CHIP, b: CHIP, c: CHIP, d: CHIP });
  const seating = (window: number) =>
    computeVisibleHosts(
      five,
      "local",
      stripAt(window) - ADD_BUTTON_RESERVE,
      OVERFLOW_TRIGGER_RESERVE,
    );

  it("seats every tab in a wide window", () => {
    expect(seating(1920).overflowed).toEqual([]);
  });

  it("folds into `⋯ +N` before the tabs reach the control cluster", () => {
    expect(seating(1024)).toEqual({
      visible: ["local", "a"],
      overflowed: ["b", "c", "d"],
    });
    expect(
      2 * CHIP + OVERFLOW_TRIGGER_RESERVE + ADD_BUTTON_RESERVE,
    ).toBeLessThanOrEqual(stripAt(1024));
  });

  it("keeps folding as the window narrows, down to the active tab alone", () => {
    expect(seating(900).visible).toEqual(["local"]);
    expect(seating(820).visible).toEqual(["local"]);
  });

  it("seats one tab fewer at a window just short of all five", () => {
    expect(seating(1270).visible).toEqual(["local", "a", "b", "c"]);
    expect(seating(1270).overflowed).toEqual(["d"]);
  });
});
