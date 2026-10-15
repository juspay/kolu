/**
 * kolu-server's delivery timer — WHEN to ask "is a delivery due", never
 * whether one is (that is upstream's rule against the last successful run,
 * applied by the schedule policy in `./schedule.ts`). It ticks when it starts
 * (or is poked) and at every capped look, telling the policy whether a
 * schedule boundary (02/08/14/20 UTC, upstream's `lib.schedule` as baked) has
 * passed since the last boundary tick. The policy asks at a boundary, and
 * between boundaries only to retry a failed run (upstream's attempts,
 * `./schedule.ts`' `scheduledAskNow`) or an ask that met a run
 * in flight.
 *
 * ## Timer choice — a chained, capped `setTimeout`
 *
 * The `kavalSupervision` precedent: node timers, `unref`'d (a pending delivery
 * must never hold a stopping server open), chained `setTimeout`, never
 * `setInterval`. Each wait is capped at {@link MAX_WAIT_MS}, not the full time
 * to the next boundary, because a node timer counts on the monotonic clock,
 * which stands still while the machine sleeps: a six-hour timer armed before a
 * night asleep would fire hours after waking. With the cap, a machine that
 * slept through a boundary asks within minutes of waking — and the due rule
 * then runs the missed update once.
 */

import type { UpdaterSchedule } from "@kolu/agent-distro/bake";
import { log } from "../log.ts";

/** The latest boundary (`offset + k*period`, epoch seconds) not after `now`
 *  — the instant upstream's `updateDue` measures a stamp against. */
export function boundaryAtOrBefore(
  now: number,
  schedule: UpdaterSchedule,
): number {
  const { periodSeconds: period, offsetSeconds: offset } = schedule;
  return Math.floor((now - offset) / period) * period + offset;
}

/** The next boundary strictly after `now` (epoch seconds) — when an update
 *  next becomes due. */
export function nextBoundary(now: number, schedule: UpdaterSchedule): number {
  return boundaryAtOrBefore(now, schedule) + schedule.periodSeconds;
}

/** The longest the timer waits between looks at the wall clock. */
export const MAX_WAIT_MS = 5 * 60_000;

export interface UpdateTimerDeps {
  /** The schedule — `undefined` while there is nothing to keep current
   *  (agents off): the timer is then idle. */
  readonly schedule: () => UpdaterSchedule | undefined;
  /** A look at the clock: `boundaryPassed` when a schedule boundary has
   *  passed since the last such tick (or the timer was just started/poked). */
  readonly onTick: (boundaryPassed: boolean) => void;
  /** Wall clock, epoch ms. */
  readonly now?: () => number;
  /** A one-shot timer; returns its cancel. Defaults to an `unref`'d
   *  `setTimeout`. */
  readonly setTimer?: (fn: () => void, ms: number) => () => void;
}

function nodeTimer(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/** Start the timer, for the server's life. `poke()` asks now and re-arms. */
export function startUpdateTimer(deps: UpdateTimerDeps): {
  readonly poke: () => void;
} {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? nodeTimer;
  let cancel: (() => void) | undefined;
  /** When the timer last ticked with a boundary passed, epoch ms. */
  let boundaryAt: number | undefined;

  const arm = (): void => {
    cancel?.();
    cancel = undefined;
    const schedule = deps.schedule();
    if (schedule === undefined) return;
    const t = now();
    const boundaryMs = nextBoundary(Math.floor(t / 1000), schedule) * 1000;
    cancel = setTimer(fire, Math.max(0, Math.min(boundaryMs - t, MAX_WAIT_MS)));
  };

  const tick = (boundaryPassed: boolean): void => {
    if (boundaryPassed) boundaryAt = now();
    try {
      deps.onTick(boundaryPassed);
    } catch (err) {
      // The policy logs its own failures; a throw here is a bug in it. Keep
      // the cadence: a timer that stops because it threw once is silence.
      log.error({ err }, "agent-distro delivery timer: the due check threw");
    }
  };

  function fire(): void {
    cancel = undefined;
    const schedule = deps.schedule();
    if (schedule === undefined) return;
    const t = now();
    // A boundary passed since the last boundary tick — on time, late, or
    // across a sleep.
    tick(
      boundaryAt === undefined ||
        nextBoundary(Math.floor(boundaryAt / 1000), schedule) * 1000 <= t,
    );
    arm();
  }

  const poke = (): void => {
    if (deps.schedule() !== undefined) tick(true);
    arm();
  };

  poke();
  return { poke };
}
