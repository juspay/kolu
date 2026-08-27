/** The one compact-duration ladder, and the two policies that hang off it:
 *  what an untrustworthy delta renders as, and which second unit a live
 *  elapsed readout pairs with its dominant one. */

import { describe, expect, it } from "vitest";
import { formatElapsedShort } from "./duration";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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
