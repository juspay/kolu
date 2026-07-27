/** The one compact-duration ladder, and the two policies that hang off it:
 *  what an untrustworthy delta renders as, and which second unit a live
 *  elapsed readout pairs with its dominant one. */

import { describe, expect, it } from "vitest";
import { compactDelta, formatElapsedShort } from "./duration";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("compactDelta", () => {
  it("walks the ladder to the dominant unit", () => {
    expect(compactDelta(0)).toEqual({ kind: "delta", value: 0, unit: "s" });
    expect(compactDelta(59 * SEC)).toEqual({
      kind: "delta",
      value: 59,
      unit: "s",
    });
    expect(compactDelta(MIN)).toEqual({ kind: "delta", value: 1, unit: "m" });
    expect(compactDelta(59 * MIN)).toEqual({
      kind: "delta",
      value: 59,
      unit: "m",
    });
  });

  it("carries the next-finer unit for the hour and day tiers", () => {
    // A caller can then render one unit or two without re-walking the ladder.
    expect(compactDelta(2 * HOUR + 20 * MIN)).toEqual({
      kind: "delta",
      value: 2,
      unit: "h",
      sub: { value: 20, unit: "m" },
    });
    expect(compactDelta(3 * DAY + 5 * HOUR)).toEqual({
      kind: "delta",
      value: 3,
      unit: "d",
      sub: { value: 5, unit: "h" },
    });
  });

  it("refuses a delta from the future rather than clamping it to zero", () => {
    // These deltas subtract a REMOTE host's clock from the browser's, so a
    // host running slightly ahead puts its events in this clock's future. The
    // reading is provably wrong; a clamp turned a twenty-hour wait into "0s"
    // on exactly the remote hosts the readout exists for.
    expect(compactDelta(-1)).toEqual({ kind: "unknown" });
    expect(compactDelta(-5 * SEC)).toEqual({ kind: "unknown" });
  });
});

describe("formatElapsedShort", () => {
  it("shows seconds ticking under a minute, and beside the minute", () => {
    // This is a LIVE connect timer — the seconds are the point.
    expect(formatElapsedShort(45 * SEC)).toBe("45s");
    expect(formatElapsedShort(2 * MIN + 3 * SEC)).toBe("2m 3s");
  });

  it("pairs hours with minutes, not with seconds-within-the-minute", () => {
    // It used to append `sec % 60` under every tier above seconds, so a
    // two-hour reconnect read "2h 47s" — a number that cycles 0-59 every
    // second beside an hours figure, answering no question anyone has. A
    // connection outage is exactly the timer that crosses an hour.
    expect(formatElapsedShort(2 * HOUR)).toBe("2h 0m");
    expect(formatElapsedShort(2 * HOUR + 47 * SEC)).toBe("2h 0m");
    expect(formatElapsedShort(2 * HOUR + 5 * MIN)).toBe("2h 5m");
  });

  it("pairs days with hours", () => {
    expect(formatElapsedShort(3 * DAY + 5 * HOUR)).toBe("3d 5h");
  });

  it("renders the dash for a delta it cannot trust", () => {
    expect(formatElapsedShort(-5 * SEC)).toBe("—");
  });
});
