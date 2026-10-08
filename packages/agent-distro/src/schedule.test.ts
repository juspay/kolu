/**
 * The due rule and the next boundary, pinned to upstream's own numbers:
 * `lib/schedule.nix` runs four times a day at 02/08/14/20 UTC — a period of
 * 21600 s phased onto 02:00 (7200 s) — and `src/update/due.ts`'s
 * `updateDue(now, stamp, period, offset)` is the rule mirrored here. Upstream
 * hard-codes the same golden values in `test/check-update-due.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  attemptStarted,
  lastSuccessFile,
  SCHEDULED_ATTEMPTS,
  SCHEDULED_RETRY_SECONDS,
  type ScheduledAttempts,
  scheduledAskNow,
  nextBoundary,
  parseLastSuccess,
  updateDue,
  updaterScheduleOf,
} from "./schedule.ts";

/** Upstream's schedule, as `lib.mkUpdater` writes it into the config. */
const UPSTREAM = { periodSeconds: 21600, offsetSeconds: 7200 };
const at = (iso: string) => Date.parse(iso) / 1000;

describe("updaterScheduleOf", () => {
  it("reads the schedule an updater config carries", () => {
    expect(
      updaterScheduleOf(
        JSON.stringify({ profile: "vanilla", state: "/s", ...UPSTREAM }),
      ),
    ).toEqual(UPSTREAM);
  });
  it("throws on a config with no schedule", () => {
    expect(() => updaterScheduleOf('{"profile":"vanilla"}')).toThrow();
  });
});

describe("nextBoundary — 02/08/14/20 UTC", () => {
  it("lands on upstream's four hours", () => {
    expect(nextBoundary(at("2026-10-08T00:30:00Z"), UPSTREAM)).toBe(
      at("2026-10-08T02:00:00Z"),
    );
    expect(nextBoundary(at("2026-10-08T02:00:00Z"), UPSTREAM)).toBe(
      at("2026-10-08T08:00:00Z"),
    );
    expect(nextBoundary(at("2026-10-08T13:59:59Z"), UPSTREAM)).toBe(
      at("2026-10-08T14:00:00Z"),
    );
    expect(nextBoundary(at("2026-10-08T21:00:00Z"), UPSTREAM)).toBe(
      at("2026-10-09T02:00:00Z"),
    );
  });
});

describe("updateDue — upstream's rule", () => {
  it("a fresh machine (no stamp) is due", () => {
    expect(updateDue(at("2026-10-08T09:00:00Z"), null, UPSTREAM)).toBe(true);
  });
  it("a run since the latest boundary is not due; one before it is", () => {
    const now = at("2026-10-08T09:00:00Z");
    expect(updateDue(now, at("2026-10-08T08:00:00Z"), UPSTREAM)).toBe(false);
    expect(updateDue(now, at("2026-10-08T08:30:00Z"), UPSTREAM)).toBe(false);
    expect(updateDue(now, at("2026-10-08T07:59:59Z"), UPSTREAM)).toBe(true);
  });
  it("a late timer (past the boundary it waited for) is due once, then not", () => {
    const stamp = at("2026-10-08T02:05:00Z");
    // The timer for 08:00 fires at 08:07.
    const late = at("2026-10-08T08:07:00Z");
    expect(updateDue(late, stamp, UPSTREAM)).toBe(true);
    // The run it starts stamps 08:07; a second fire is not due.
    expect(updateDue(late + 60, late, UPSTREAM)).toBe(false);
  });
  it("after a sleep across several boundaries, one run makes it current", () => {
    const stamp = at("2026-10-07T20:10:00Z");
    const wake = at("2026-10-08T15:00:00Z");
    expect(updateDue(wake, stamp, UPSTREAM)).toBe(true);
    expect(updateDue(wake + 5, wake + 1, UPSTREAM)).toBe(false);
  });
});

describe("last-success", () => {
  it("sits under the state directory", () => {
    expect(lastSuccessFile("/s/abc")).toBe("/s/abc/last-success");
  });
  it("reads epoch seconds; anything else is no stamp", () => {
    expect(parseLastSuccess("1791368153\n")).toBe(1791368153);
    expect(parseLastSuccess(undefined)).toBeNull();
    expect(parseLastSuccess("")).toBeNull();
    expect(parseLastSuccess("yesterday")).toBeNull();
  });
});

describe("scheduledAskNow — a boundary, a missed ask, and upstream's retries", () => {
  // A fake clock walked in the timer's 5-minute steps from the 08:00 boundary.
  const t0 = at("2026-10-08T08:00:00Z");
  const ask = (
    now: number,
    attempts: ScheduledAttempts | undefined,
    extra: { boundaryPassed?: boolean; askAgain?: boolean } = {},
  ) =>
    scheduledAskNow({
      now,
      schedule: UPSTREAM,
      boundaryPassed: extra.boundaryPassed ?? false,
      askAgain: extra.askAgain ?? false,
      attempts,
    });

  it("mirrors upstream's numbers: 3 attempts, 5 minutes apart", () => {
    expect(SCHEDULED_ATTEMPTS).toBe(3);
    expect(SCHEDULED_RETRY_SECONDS).toBe(300);
  });

  it("a failed run (offline at the boundary) is retried twice, five minutes apart, then waits for the next boundary", () => {
    expect(ask(t0, undefined, { boundaryPassed: true })).toBe(true);
    let a = { ...attemptStarted(undefined, t0, UPSTREAM), lastFailed: true };
    expect(ask(t0 + 60, a)).toBe(false); // too soon
    expect(ask(t0 + 300, a)).toBe(true);
    a = { ...attemptStarted(a, t0 + 300, UPSTREAM), lastFailed: true };
    expect(a.count).toBe(2);
    expect(ask(t0 + 600, a)).toBe(true);
    a = { ...attemptStarted(a, t0 + 600, UPSTREAM), lastFailed: true };
    expect(a.count).toBe(3);
    expect(ask(t0 + 900, a)).toBe(false); // out of attempts
    expect(ask(t0 + 3 * 3600, a)).toBe(false);
    // The next boundary starts over.
    const next = t0 + 6 * 3600;
    expect(ask(next, a, { boundaryPassed: true })).toBe(true);
    expect(attemptStarted(a, next, UPSTREAM).count).toBe(1);
  });

  it("a skipped run is not retried: it waits for the next boundary", () => {
    const a = attemptStarted(undefined, t0, UPSTREAM); // lastFailed: false
    expect(ask(t0 + 300, a)).toBe(false);
    expect(ask(t0 + 3600, a)).toBe(false);
  });

  it("an ask that met a run in flight asks again on the next tick", () => {
    expect(ask(t0 + 300, undefined, { askAgain: true })).toBe(true);
    expect(ask(t0 + 300, undefined)).toBe(false);
  });
});
