/**
 * When agent-distro's updater is due — upstream's schedule, read off the updater
 * config kolu already makes concrete for a host (`periodSeconds`,
 * `offsetSeconds`, which `lib.mkUpdater` writes from `lib/schedule.nix`: four
 * runs a day, at 02/08/14/20 UTC), and upstream's "due" rule, applied by padi's
 * own timer instead of launchd's.
 *
 * Kolu never decides the schedule: the numbers are upstream's, and the rule is
 * a line-for-line mirror of upstream's `updateDue` (`src/update/due.ts`), pinned
 * by a golden test against upstream's own numbers. Pure: no clock, no files.
 */

import { Schema } from "effect";

/** The schedule fields of `lib.mkUpdater`'s config (agent-distro's
 *  `src/update/update.ts` `Config`), in seconds. */
const UpdaterScheduleSchema = Schema.Struct({
  periodSeconds: Schema.Number.check(Schema.isGreaterThan(0)),
  offsetSeconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type UpdaterSchedule = typeof UpdaterScheduleSchema.Type;

const decodeSchedule = Schema.decodeUnknownSync(UpdaterScheduleSchema);

/** The schedule an updater config carries. Throws on a config without one — a
 *  config not built by `lib.mkUpdater`, which no host should run. */
export function updaterScheduleOf(configText: string): UpdaterSchedule {
  return decodeSchedule(JSON.parse(configText));
}

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

/** How many scheduled runs one boundary gets, and how far apart, when a run
 *  FAILS — upstream's own `--scheduled` numbers (`src/update/update.ts`
 *  `scheduled()`: "up to 3 attempts five minutes apart"), mirrored so padi's
 *  timer gives a machine that was offline at the boundary the same chances
 *  launchd's would. A `skipped` run is not retried: it waits for the next
 *  boundary, as upstream's does. */
export const SCHEDULED_ATTEMPTS = 3;
export const SCHEDULED_RETRY_SECONDS = 300;

/** The scheduled runs one boundary has had so far, as padi counts them. */
export interface ScheduledAttempts {
  /** The boundary (epoch seconds) these attempts belong to. */
  readonly boundary: number;
  readonly count: number;
  /** When the last one started, epoch seconds. */
  readonly lastAt: number;
  /** The last one ended `failed`. */
  readonly lastFailed: boolean;
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
    lastAt: now,
    lastFailed: false,
  };
}

/** Should the timer ask "is an update due" now (epoch seconds)? Yes when a
 *  boundary has passed since it last asked, when its last ask met a run in
 *  flight (`askAgain`: that ask did not count), or when the boundary's last
 *  scheduled run FAILED and it has attempts left, five minutes on. Whether a
 *  run then starts is still {@link updateDue}'s call. */
export function scheduledAskNow(input: {
  readonly now: number;
  readonly schedule: UpdaterSchedule;
  readonly boundaryPassed: boolean;
  readonly askAgain: boolean;
  readonly attempts: ScheduledAttempts | undefined;
}): boolean {
  if (input.boundaryPassed || input.askAgain) return true;
  const a = input.attempts;
  if (a === undefined) return false;
  return (
    a.lastFailed &&
    a.boundary === boundaryAtOrBefore(input.now, input.schedule) &&
    a.count < SCHEDULED_ATTEMPTS &&
    input.now - a.lastAt >= SCHEDULED_RETRY_SECONDS
  );
}

/** The file under a state directory where the updater stamps its last
 *  successful run (`updated` or `unchanged`), in epoch seconds. */
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
