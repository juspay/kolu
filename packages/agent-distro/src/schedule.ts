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
