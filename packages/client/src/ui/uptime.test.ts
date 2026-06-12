import { describe, expect, it } from "vitest";
import { formatUptime } from "./uptime.ts";

const sec = 1_000;
const min = 60 * sec;
const hour = 60 * min;
const day = 24 * hour;

describe("formatUptime", () => {
  it("renders compact units across the boundaries", () => {
    const t0 = 1_000_000;
    expect(formatUptime(t0, t0)).toBe("0s");
    expect(formatUptime(t0, t0 + 45 * sec)).toBe("45s");
    expect(formatUptime(t0, t0 + 59 * sec)).toBe("59s");
    expect(formatUptime(t0, t0 + 1 * min)).toBe("1m");
    expect(formatUptime(t0, t0 + 12 * min)).toBe("12m");
    expect(formatUptime(t0, t0 + 1 * hour)).toBe("1h");
    expect(formatUptime(t0, t0 + 3 * hour)).toBe("3h");
    expect(formatUptime(t0, t0 + 2 * day)).toBe("2d");
  });

  it("clamps a skewed (future) startedAt to 0s rather than going negative", () => {
    expect(formatUptime(1_000_000, 990_000)).toBe("0s");
  });
});
