import { describe, expect, it } from "vitest";
import { formatDuration, isStale } from "./staleness";

const HOUR = 60 * 60 * 1000;

describe("isStale", () => {
  const now = 10_000_000;

  it.each([
    {
      lastActivityAt: 0,
      thresholdMs: HOUR,
      expected: false,
      why: "lastActivityAt=0 → never observed, never stale",
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
      expected: "0s",
      why: "clock skew clamps to 0, never negative",
    },
  ])("$ms ms → $expected", ({ ms, expected }) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
