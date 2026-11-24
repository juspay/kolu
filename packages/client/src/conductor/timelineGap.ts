/** HOW TALL THE GAP BETWEEN TWO TIMELINE EVENTS IS — one scale, for the eye.
 *
 *  A timeline whose rows sit evenly spaced says nothing about a work that
 *  waited three hours for CI. The line between two dots is therefore long
 *  when the time between them was long — but not linearly: three hours must
 *  not become three screens of nothing. Minutes and hours are compressed
 *  with a logarithm, and the scale is clamped at {@link
 *  TIMELINE_GAP_MAX_PX}, about four rows of text.
 *
 *  The numbers are the contract: `MIN` is the gap for two events in the same
 *  minute (still visibly apart, so the line reads as one), and `MAX` is where
 *  a day or more stops being worth more room. A gap at or near the maximum
 *  also prints its elapsed time, because a long stretch of line should say
 *  how long it was rather than make the reader measure it
 *  (`gapWordsFor`). */

import { compactPhrase } from "@kolu/terminal-vocab/duration";

/** Same minute — and, being the floor, every shorter wait. */
export const TIMELINE_GAP_MIN_PX = 4;

/** About four rows of timeline text; an hour or more is the same as an hour. */
export const TIMELINE_GAP_MAX_PX = 72;

/** The wait the scale is calibrated against: an hour. Beyond it the line is
 *  already as long as it needs to be — a day and a month look the same, which
 *  is the point of compressing. */
const FULL_SCALE_MS = 60 * 60 * 1000;

/** A gap this close to the maximum prints its elapsed time on the line. */
const GAP_LABEL_AT_PX = TIMELINE_GAP_MAX_PX - 10;

/** Elapsed milliseconds between two events, in gap pixels. Never below
 *  {@link TIMELINE_GAP_MIN_PX}, never above {@link TIMELINE_GAP_MAX_PX}, and
 *  never smaller as the wait grows. */
export function timelineGap(ms: number): number {
  // SAME MINUTE IS ONE GAP: two events a few seconds apart are one moment in
  // the record, and giving each second its own pixel would only make the line
  // jitter. The floor is also the answer for a clock that went backwards.
  if (ms < 60_000) return TIMELINE_GAP_MIN_PX;
  const minutes = ms / 60_000;
  const share = Math.min(
    1,
    Math.log1p(minutes) / Math.log1p(FULL_SCALE_MS / 60_000),
  );
  return Math.round(
    TIMELINE_GAP_MIN_PX + (TIMELINE_GAP_MAX_PX - TIMELINE_GAP_MIN_PX) * share,
  );
}

/** The words a long gap prints on its line (`42m`, `3h`, `2d`), or none for a
 *  gap short enough that its length is the whole message. One ladder, the
 *  same `compactPhrase` the stage map prints its times with. */
export function gapWordsFor(ms: number): string | undefined {
  if (timelineGap(ms) < GAP_LABEL_AT_PX) return undefined;
  return compactPhrase(ms);
}
