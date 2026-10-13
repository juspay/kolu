/**
 * When kolu-server delivers agents — upstream's schedule (`periodSeconds`,
 * `offsetSeconds`, baked from agent-distro's `lib.schedule`: four runs a day,
 * at 02/08/14/20 UTC, `./bake.ts`), and upstream's "due" rule, applied by
 * kolu-server's own timer instead of launchd's.
 *
 * Kolu never decides the schedule: the numbers are upstream's, and the rule is
 * a line-for-line mirror of upstream's `updateDue` (`src/update/due.ts`), pinned
 * by a golden test against upstream's own numbers. Pure: no clock, no files.
 */

import { Schema } from "effect";

/** Upstream's schedule, in seconds (agent-distro's `lib.schedule`:
 *  `updatePeriodSeconds`, `updateOffsetSeconds`). */
export const UpdaterScheduleSchema = Schema.Struct({
  periodSeconds: Schema.Number.check(Schema.isGreaterThan(0)),
  offsetSeconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type UpdaterSchedule = typeof UpdaterScheduleSchema.Type;

/** The latest boundary (`offset + k*period`, epoch seconds) not after `now`. */
function boundaryAtOrBefore(now: number, schedule: UpdaterSchedule): number {
  const { periodSeconds: period, offsetSeconds: offset } = schedule;
  return Math.floor((now - offset) / period) * period + offset;
}

/** Whether an update is due at `now` (epoch seconds): no successful update
 *  (`stamp`, the updater's `last-success`, epoch seconds) since the latest
 *  boundary not after `now`. Mirrors upstream's `updateDue(now, stamp, period,
 *  offset)` in `src/update/due.ts` exactly — keep them the same rule. */
export function updateDue(
  now: number,
  stamp: number | null,
  schedule: UpdaterSchedule,
): boolean {
  return stamp === null || stamp < boundaryAtOrBefore(now, schedule);
}

/** The next boundary strictly after `now` (epoch seconds) — when an update
 *  next becomes due. */
export function nextBoundary(now: number, schedule: UpdaterSchedule): number {
  return boundaryAtOrBefore(now, schedule) + schedule.periodSeconds;
}

/** How many scheduled runs one boundary gets, and how long to wait after one
 *  FAILS before the next — upstream's own `--scheduled` numbers
 *  (`src/update/update.ts` `scheduled()`: up to 3 attempts, sleeping five
 *  minutes after a failed one), mirrored so kolu-server's timer gives a run
 *  that failed at the boundary the same chances launchd's would. The wait is
 *  counted from the failed run's END, as upstream's sleep is. A `skipped` run
 *  is not retried: it waits for the next boundary, as upstream's does. */
export const SCHEDULED_ATTEMPTS = 3;
export const SCHEDULED_RETRY_SECONDS = 300;

/** The scheduled runs one boundary has had so far, as kolu-server counts them. */
export interface ScheduledAttempts {
  /** The boundary (epoch seconds) these attempts belong to. */
  readonly boundary: number;
  readonly count: number;
  /** How the last one ended — when (epoch seconds) and whether it FAILED —
   *  or `undefined` while it runs. */
  readonly lastEnd?: { readonly at: number; readonly failed: boolean };
}

/** Record a scheduled run starting at `now`: the next attempt of the current
 *  boundary, or the first of a new one. */
export function attemptStarted(
  prev: ScheduledAttempts | undefined,
  now: number,
  schedule: UpdaterSchedule,
): ScheduledAttempts {
  const boundary = boundaryAtOrBefore(now, schedule);
  return {
    boundary,
    count: prev?.boundary === boundary ? prev.count + 1 : 1,
  };
}

/** Record the running scheduled attempt ending at `now`, failed or not. */
export function attemptEnded(
  attempts: ScheduledAttempts,
  now: number,
  failed: boolean,
): ScheduledAttempts {
  return { ...attempts, lastEnd: { at: now, failed } };
}

/** Should the timer ask "is an update due" now (epoch seconds)? Yes when a
 *  boundary has passed since it last asked, when its last ask met a run in
 *  flight (`askAgain`: that ask did not count), or when the boundary's last
 *  scheduled run FAILED and it has attempts left, five minutes after that run
 *  ended. Whether a run then starts is still {@link updateDue}'s call. */
export function scheduledAskNow(input: {
  readonly now: number;
  readonly schedule: UpdaterSchedule;
  readonly boundaryPassed: boolean;
  readonly askAgain: boolean;
  readonly attempts: ScheduledAttempts | undefined;
}): boolean {
  if (input.boundaryPassed || input.askAgain) return true;
  const a = input.attempts;
  if (a?.lastEnd === undefined) return false;
  return (
    a.lastEnd.failed &&
    a.boundary === boundaryAtOrBefore(input.now, input.schedule) &&
    a.count < SCHEDULED_ATTEMPTS &&
    input.now - a.lastEnd.at >= SCHEDULED_RETRY_SECONDS
  );
}

/** The file under a state directory where a host's last successful landing
 *  (`updated` or `unchanged`) is stamped, in epoch seconds — upstream's file,
 *  which padi writes for each delivery. */
export function lastSuccessFile(stateDir: string): string {
  return `${stateDir}/last-success`;
}

/** Read `last-success`'s text the way upstream's `--scheduled` mode does: an
 *  unreadable stamp counts as no successful update (`null`), so it is replaced. */
export function parseLastSuccess(text: string | undefined): number | null {
  const trimmed = text?.trim();
  return trimmed !== undefined && /^[0-9]+$/.test(trimmed)
    ? Number(trimmed)
    : null;
}
