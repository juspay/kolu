// @vitest-environment happy-dom
/**
 * THE GAP SCALE ON A WORK'S TIMELINE.
 *
 * Equal spacing hides a three-hour wait. The scale is a compressing one —
 * minutes and hours are flattened by a logarithm and the whole thing is
 * clamped — so the line can say "this took a while" without turning a wait
 * into screens of blank paper.
 */

import { compactPhrase } from "@kolu/terminal-vocab/duration";
import { describe, expect, it } from "vitest";
import {
  gapWordsFor,
  TIMELINE_GAP_MAX_PX,
  TIMELINE_GAP_MIN_PX,
  timelineGap,
} from "./timelineGap";

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("the gap between two timeline events", () => {
  it("is the minimum for events in the same minute", () => {
    expect(timelineGap(0)).toBe(TIMELINE_GAP_MIN_PX);
    expect(timelineGap(30 * SEC)).toBe(TIMELINE_GAP_MIN_PX);
    expect(timelineGap(59 * SEC)).toBe(TIMELINE_GAP_MIN_PX);
  });

  it("grows with the wait, one step at a time", () => {
    const gaps = [1, 10, 60, 6 * 60, 24 * 60].map((m) => timelineGap(m * MIN));
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1] ?? 0);
    }
    expect(timelineGap(MIN)).toBeLessThan(timelineGap(10 * MIN));
    expect(timelineGap(10 * MIN)).toBeLessThan(timelineGap(HOUR));
  });

  it("is visibly apart at a minute, and not yet full at ten", () => {
    expect(timelineGap(MIN)).toBeGreaterThan(TIMELINE_GAP_MIN_PX);
    expect(timelineGap(10 * MIN)).toBeLessThan(TIMELINE_GAP_MAX_PX);
  });

  it("stops at four rows' height, an hour and beyond alike", () => {
    expect(timelineGap(HOUR)).toBe(TIMELINE_GAP_MAX_PX);
    expect(timelineGap(DAY)).toBe(TIMELINE_GAP_MAX_PX);
    expect(timelineGap(3 * DAY)).toBe(TIMELINE_GAP_MAX_PX);
    expect(timelineGap(365 * DAY)).toBe(TIMELINE_GAP_MAX_PX);
  });

  it("never shrinks as the wait grows", () => {
    let was = timelineGap(0);
    for (let ms = 0; ms <= 3 * DAY; ms += 37 * SEC) {
      const now = timelineGap(ms);
      expect(now).toBeGreaterThanOrEqual(was);
      expect(now).toBeGreaterThanOrEqual(TIMELINE_GAP_MIN_PX);
      expect(now).toBeLessThanOrEqual(TIMELINE_GAP_MAX_PX);
      was = now;
    }
  });

  it("treats a clock that went backwards as no wait at all", () => {
    expect(timelineGap(-HOUR)).toBe(TIMELINE_GAP_MIN_PX);
  });
});

describe("the time a long gap prints", () => {
  it("says nothing for a short gap", () => {
    expect(gapWordsFor(MIN)).toBeUndefined();
    expect(gapWordsFor(10 * MIN)).toBeUndefined();
  });

  it("prints the repo's own short duration for a long gap", () => {
    // Not a second spelling of hours and minutes: the same one unit the
    // stage strip prints.
    expect(gapWordsFor(3 * HOUR)).toBe(compactPhrase(3 * HOUR));
    expect(gapWordsFor(DAY)).toBe(compactPhrase(DAY));
  });
});
