import { describe, expect, it } from "vitest";
import { isStale, STALE_THRESHOLD_MS } from "./staleness";

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
      lastActivityAt: now - HOUR - 1,
      thresholdMs: HOUR,
      expected: true,
      why: "older than threshold",
    },
    {
      lastActivityAt: now - 24 * HOUR,
      thresholdMs: HOUR,
      expected: true,
      why: "much older than threshold",
    },
    {
      lastActivityAt: now - 24 * HOUR,
      thresholdMs: null,
      expected: false,
      why: "feature off (threshold=null)",
    },
    {
      lastActivityAt: 0,
      thresholdMs: null,
      expected: false,
      why: "off + never observed",
    },
  ])("$why", ({ lastActivityAt, thresholdMs, expected }) => {
    expect(isStale(lastActivityAt, now, thresholdMs)).toBe(expected);
  });
});

describe("STALE_THRESHOLD_MS", () => {
  it("is 4 hours", () => {
    expect(STALE_THRESHOLD_MS).toBe(4 * HOUR);
  });
});
