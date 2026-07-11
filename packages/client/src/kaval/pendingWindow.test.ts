/** Pins the "kaval didn't start" ceiling (`isPendingTimedOut`), the pure twin of
 *  `useDaemonStatus.ts`'s `daemonStatusPendingTimedOut`. The anchor it measures from
 *  is stamped ONCE per host in the RETAINED per-host scope (`createHostWire`'s
 *  `daemonPendingAnchorMs`) and held across switch-away — so a wedged host keeps its
 *  ORIGINAL deadline (the ceiling still fires) and a re-added host earns a fresh one.
 *  The switch-back-keeps-its-deadline behaviour rides on the retained-scope test
 *  (`perHostWire.test.ts`); here we pin only the pure ceiling arithmetic. */

import { describe, expect, it } from "vitest";
import { isPendingTimedOut } from "./pendingWindow";

describe("isPendingTimedOut", () => {
  it("is false whenever not pending, however old the anchor is", () => {
    expect(isPendingTimedOut(false, 0, 999_999, 30_000)).toBe(false);
  });

  it("is false within the warm window", () => {
    expect(isPendingTimedOut(true, 90_000, 91_000, 30_000)).toBe(false);
  });

  it("is true once the wait has outlasted the ceiling", () => {
    expect(isPendingTimedOut(true, 90_000, 121_001, 30_000)).toBe(true);
  });

  it("the retained anchor keeps firing: a host anchored at boot (t=0) that is still pending long past the ceiling reads timed out", () => {
    // The wedge case: a host's daemon never yields. Its anchor was stamped once at
    // scope birth and — because the sub is RETAINED, not re-subscribed on switch —
    // is never reset by a switch-back. So the ceiling is measured from the ORIGINAL
    // wait and honestly fires, rather than being dodged by repeated revisits.
    expect(isPendingTimedOut(true, 0, 30_001, 30_000)).toBe(true);
  });
});
