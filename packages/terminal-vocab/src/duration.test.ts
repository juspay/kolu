/** The compact-duration ladder and the two phrases kolu says with it.
 *
 *  These assertion STRINGS are the pixel contract — they moved here verbatim
 *  with the code, from `kolu-client`'s `time/duration.test.ts` and
 *  `terminal/staleness.test.ts`, so the Dock renders the same words after the
 *  move as before it. A rewritten table would have proved only that the new code
 *  agrees with itself. */
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

describe("compactPhrase — a live DURATION, no suffix", () => {
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
    expect(compactPhrase(ms)).toBe(expected);
  });

  it("does not report a long wait as brand new when the host clock runs ahead", () => {
    // These timestamps are stamped by the host the terminal runs on and
    // subtracted from the browser clock. A remote host a minute ahead put a
    // twenty-hour-old event in this clock's future — and the dock chip that
    // exists to make a twenty-hour wait legible would have read "0s" on
    // exactly the remote hosts it was built for.
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
    // `agoPhrase` renders "there has never been activity here" as nothing at
    // all. The wait chip cannot: a violet capsule with no glyph reads as a
    // rendering bug. That substitution is `recencyText`'s, per rendering, and
    // deliberately not this phrase's.
    expect(agoPhrase(null, now)).toBe("");
    expect(compactPhrase(-1)).toBe("—");
  });
});

describe("dualPhrase — the dominant tier and the next-finer one", () => {
  // The rendering that was spelled identically in the connect overlay's timer
  // and the kaval daemon's uptime. These strings are that pixel contract.
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
    // The daemon uptime does disagree ("unknown", because a daemon presence has
    // a vocabulary for "we can't confirm this" and the rest of the product does
    // not) — and it substitutes at its own call site, exactly as `recencyText`
    // does for the wait chip's dash. A defaulted word parameter here would be a
    // knob: the second caller wanting a third word gets it free, and the
    // vocabulary stops being kolu's.
    expect(dualPhrase.length).toBe(1);
    expect(dualPhrase(3 * DAY + 5 * HOUR)).toBe("3d 5h");
  });
});
