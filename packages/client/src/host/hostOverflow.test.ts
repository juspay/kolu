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
