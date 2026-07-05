/**
 * The honest-degradation predicate for the bound host's daemon list — the guard that
 * keeps a not-yet-connected / degraded / version-skewed bind from rendering the
 * re-serve's seeded EMPTY default as "No running daemons discovered" (a silent zero
 * masquerading as a definite answer, #1034).
 *
 * The mixed-version window this protects (coordinator condition, PR #1686): a new
 * kolu-server (padiSurface 1.2) binding a still-running 1.1 padi that does not serve
 * `hostInventory`. The bind is contract-refused/drained, never mirrored live, so the
 * re-served cell keeps its seeded `{ kavals: [], padis: [] }` default — present-but-empty,
 * `pending()===false` — which the dialog must read as "unavailable", not "none".
 */

import type { RunningPadi } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { hostInventoryReadingLive } from "./hostInventoryLive.ts";

const padi = (over: Partial<RunningPadi> = {}): RunningPadi => ({
  socket: "/run/user/1000/padi-abc/padi.sock",
  stateRoot: "/home/u/.local/state/padi",
  gatePid: 111,
  surfaceVersion: "1.2",
  buildCommit: "padi9f8",
  active: true,
  ...over,
});

describe("hostInventoryReadingLive", () => {
  it("the re-serve's seeded EMPTY default is NOT live (degraded / skew / pre-first-frame)", () => {
    // This is exactly what a 1.2 binder over a 1.1 padi (or any not-yet-connected bind)
    // leaves in the re-served cell — the dialog must render "unavailable", not "no daemons".
    expect(hostInventoryReadingLive([])).toBe(false);
  });

  it("a reading with an ACTIVE padi row is a real live scan (the serving padi reported itself)", () => {
    // A connected padi ALWAYS discovers + marks itself active — the intrinsic tell that
    // this is real data, not the seeded default.
    expect(hostInventoryReadingLive([padi({ active: true })])).toBe(true);
  });

  it("padis present but NONE active is still NOT live — only the seeded default has zero active", () => {
    // Defensive: a serving padi is always the active row, so an active-less list can only
    // be a non-live artifact; treat it as unavailable rather than trust its emptiness.
    expect(
      hostInventoryReadingLive([
        padi({ active: false }),
        padi({ active: false, socket: "/run/user/1000/padi-def/padi.sock" }),
      ]),
    ).toBe(false);
  });

  it("live even when only the active padi is present (a lone healthy host)", () => {
    expect(hostInventoryReadingLive([padi()])).toBe(true);
  });
});
