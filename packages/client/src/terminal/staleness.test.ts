import { describe, expect, it } from "vitest";
import { formatDuration, isStale } from "./staleness";

const HOUR = 60 * 60 * 1000;

describe("isStale", () => {
  const now = 10_000_000;

  it.each([
    {
      lastActivityAt: null,
      thresholdMs: HOUR,
      expected: false,
      why: "lastActivityAt=null → never observed, never stale",
    },
    {
      // 0 is no longer an in-band "never observed" sentinel — it is a real
      // (if absurd) epoch, and the honest form ages it like any other.
      lastActivityAt: 0,
      thresholdMs: HOUR,
      expected: true,
      why: "lastActivityAt=0 is a REAL epoch now (honest form) — old enough to be stale, not exempted",
    },
    {
      lastActivityAt: now - 30 * 60 * 1000,
      thresholdMs: HOUR,
      expected: false,
      why: "younger than threshold",
    },
    {
      lastActivityAt: now - HOUR,
      thresholdMs: HOUR,
      expected: false,
      why: "exactly at threshold (strict greater-than)",
    },
    {
      lastActivityAt: now - 24 * HOUR,
      thresholdMs: HOUR,
      expected: true,
      why: "older than threshold",
    },
    {
      lastActivityAt: now - 24 * HOUR,
      thresholdMs: null,
      expected: false,
      why: "feature off (threshold=null)",
    },
  ])("$why", ({ lastActivityAt, thresholdMs, expected }) => {
    expect(isStale(lastActivityAt, now, thresholdMs)).toBe(expected);
  });
});

describe("formatDuration", () => {
  const SEC = 1000;
  const MIN = 60 * SEC;

  it.each([
    { ms: 0, expected: "0s" },
    { ms: 12 * SEC, expected: "12s" },
    { ms: 59 * SEC, expected: "59s" },
    { ms: MIN, expected: "1m" },
    {
      ms: 5 * MIN + 30 * SEC,
      expected: "5m",
      why: "single-unit, drops seconds",
    },
    { ms: 59 * MIN, expected: "59m" },
    {
      ms: 2 * HOUR + 14 * MIN,
      expected: "2h",
      why: "single-unit, drops minutes",
    },
    { ms: 23 * HOUR, expected: "23h" },
    { ms: 3 * 24 * HOUR, expected: "3d" },
    {
      ms: -5 * SEC,
      expected: "—",
      why: "an event cannot be in the future — say so, do not read 0s",
    },
  ])("$ms ms → $expected", ({ ms, expected }) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it("does not report a long wait as brand new when the host clock runs ahead", () => {
    // These timestamps are stamped by the host the terminal runs on and
    // subtracted from the browser clock. A remote host a minute ahead put a
    // twenty-hour-old event in this clock's future — and the dock chip that
    // exists to make a twenty-hour wait legible would have read "0s" on
    // exactly the remote hosts it was built for.
    const twentyHoursAgoByAHostRunningAhead = -(60 * SEC);
    expect(formatDuration(twentyHoursAgoByAHostRunningAhead)).toBe("—");
  });
});
