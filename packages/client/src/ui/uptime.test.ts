import { describe, expect, it } from "vitest";
import { formatUptime } from "./uptime";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatUptime", () => {
  const now = 1_700_000_000_000;

  it("returns null when the start time is unknown", () => {
    expect(formatUptime(undefined, now)).toBeNull();
    // 0 is treated as unknown (no daemon read / pre-uptime build), not "up 0s".
    expect(formatUptime(0, now)).toBeNull();
  });

  it("renders seconds under a minute", () => {
    expect(formatUptime(now - 12 * SEC, now)).toBe("up 12s");
    expect(formatUptime(now - 59 * SEC, now)).toBe("up 59s");
  });

  it("renders whole minutes under an hour", () => {
    expect(formatUptime(now - 60 * SEC, now)).toBe("up 1m");
    expect(formatUptime(now - 45 * MIN, now)).toBe("up 45m");
  });

  it("renders whole hours under a day", () => {
    expect(formatUptime(now - HOUR, now)).toBe("up 1h");
    expect(formatUptime(now - 3 * HOUR, now)).toBe("up 3h");
    expect(formatUptime(now - 23 * HOUR, now)).toBe("up 23h");
  });

  it("renders whole days past 24h", () => {
    expect(formatUptime(now - DAY, now)).toBe("up 1d");
    expect(formatUptime(now - 9 * DAY, now)).toBe("up 9d");
  });

  it("clamps a future start time to up 0s rather than going negative", () => {
    expect(formatUptime(now + 5 * SEC, now)).toBe("up 0s");
  });

  it("the Phase B signal: a surviving daemon reads older than the server", () => {
    // pty booted 3h ago and survived; srv restarted 2m ago.
    expect(formatUptime(now - 3 * HOUR, now)).toBe("up 3h");
    expect(formatUptime(now - 2 * MIN, now)).toBe("up 2m");
  });
});
