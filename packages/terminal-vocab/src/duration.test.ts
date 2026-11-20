import { describe, expect, it } from "vitest";
import {
  agoPhrase,
  compactDelta,
  compactPhrase,
  dualPhrase,
} from "./duration.ts";

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
    expect(compactDelta(-1)).toEqual({ kind: "unknown" });
    expect(compactDelta(-5 * SEC)).toEqual({ kind: "unknown" });
  });
});

describe("compactPhrase — a live DURATION, no suffix", () => {
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
    expect(compactPhrase(ms)).toBe(expected);
  });

  it("does not report a long wait as brand new when the host clock runs ahead", () => {
    const twentyHoursAgoByAHostRunningAhead = -(60 * SEC);
    expect(compactPhrase(twentyHoursAgoByAHostRunningAhead)).toBe("—");
  });
});

describe("agoPhrase — an AGE, with the suffix", () => {
  const now = 10_000_000;

  it.each([
    {
      at: null,
      expected: "",
      why: "never observed is a row with nothing to say, NOT an unknown reading",
    },
    { at: now, expected: "just now" },
    {
      at: now - 30 * SEC,
      expected: "just now",
      why: "the seconds tier has no number",
    },
    { at: now - 5 * MIN, expected: "5m ago" },
    { at: now - 2 * HOUR, expected: "2h ago" },
    { at: now - 3 * 24 * HOUR, expected: "3d ago" },
    {
      at: now + 60 * SEC,
      expected: "—",
      why: "a host running ahead put the event in this clock's future",
    },
  ])("$at → $expected", ({ at, expected }) => {
    expect(agoPhrase(at, now)).toBe(expected);
  });

  it("says the empty string where the chip says the dash — the two are not one rule", () => {
    expect(agoPhrase(null, now)).toBe("");
    expect(compactPhrase(-1)).toBe("—");
  });
});

describe("dualPhrase — the dominant tier and the next-finer one", () => {
  it.each([
    { ms: 45 * SEC, expected: "45s", why: "the seconds tier has no sub" },
    { ms: 2 * MIN, expected: "2m", why: "nor does the minute tier" },
    { ms: 2 * HOUR, expected: "2h 0m" },
    { ms: 2 * HOUR + 47 * SEC, expected: "2h 0m" },
    { ms: 2 * HOUR + 5 * MIN, expected: "2h 5m" },
    { ms: 3 * DAY + 5 * HOUR, expected: "3d 5h" },
  ])("$ms → $expected", ({ ms, expected }) => {
    expect(dualPhrase(ms)).toBe(expected);
  });

  it("says the ladder's own dash for a delta it cannot trust", () => {
    expect(dualPhrase(-5 * SEC)).toBe("—");
  });

  it("takes NO word parameter — a caller that disagrees says so at its own call site", () => {
    expect(dualPhrase(3 * DAY + 5 * HOUR)).toBe("3d 5h");
  });
});
