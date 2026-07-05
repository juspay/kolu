/**
 * The honest-degradation predicate for the bound host's daemon list — the guard that
 * keeps a not-live OR not-yet-arrived reading from rendering as a definite "Running
 * daemons" scan (a stale/empty list masquerading as a live answer, #1034).
 *
 * Two independent windows it must exclude, both pinned below:
 *   1. the bind isn't live (an ssh link that dropped leaves the re-served cell STALE —
 *      held populated with the serving padi's active row — so payload content alone can't
 *      tell it from a fresh reading; the `bindLive` fact excludes it); and
 *   2. the bind is live but no frame has arrived yet (the seeded empty default — caught by
 *      "the serving padi always reports itself", so an active-less list is not real data).
 */

import type { RunningPadi } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { hostInventoryLive } from "./hostInventoryLive.ts";

const padi = (over: Partial<RunningPadi> = {}): RunningPadi => ({
  socket: "/run/user/1000/padi-abc/padi.sock",
  stateRoot: "/home/u/.local/state/padi",
  gatePid: 111,
  active: true,
  ...over,
});

describe("hostInventoryLive", () => {
  it("live bind + the serving padi's active row → a real live scan", () => {
    expect(hostInventoryLive({ bindLive: true, padis: [padi()] })).toBe(true);
  });

  it("live bind but the seeded EMPTY default (no frame yet) → NOT live", () => {
    // A just-connected bind before its first sample; the serving padi always reports
    // itself, so an active-less list means no real frame has landed.
    expect(hostInventoryLive({ bindLive: true, padis: [] })).toBe(false);
  });

  it("a STALE populated reading held across a dropped bind → NOT live (the masquerade)", () => {
    // The bind dropped (ssh partition / drain window). reServeSurface holds the last
    // populated value — with the serving padi's active row still in it — so payload
    // content still looks "live". The bind-liveness fact is what excludes it: a dead
    // padi's daemon list must read "unavailable", never a current live scan (#1034).
    expect(hostInventoryLive({ bindLive: false, padis: [padi()] })).toBe(false);
  });

  it("dead bind + empty (never connected / version-skew-refused) → NOT live", () => {
    expect(hostInventoryLive({ bindLive: false, padis: [] })).toBe(false);
  });

  it("live bind but padis present with NONE active → NOT live (only the seeded default has zero active)", () => {
    expect(
      hostInventoryLive({
        bindLive: true,
        padis: [padi({ active: false })],
      }),
    ).toBe(false);
  });
});
