import { describe, expect, it } from "vitest";
import { formatElapsedShort } from "./duration";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatElapsedShort", () => {
  it("shows seconds ticking under a minute, and beside the minute", () => {
    expect(formatElapsedShort(45 * SEC)).toBe("45s");
    expect(formatElapsedShort(2 * MIN + 3 * SEC)).toBe("2m 3s");
  });

  it("pairs hours with minutes, not with seconds-within-the-minute", () => {
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
