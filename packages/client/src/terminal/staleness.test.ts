import { describe, expect, it } from "vitest";
import { isStale } from "./staleness";

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
