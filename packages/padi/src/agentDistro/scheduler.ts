/**
 * padi's update timer — WHEN to ask "is an update due", never whether one is
 * (that is upstream's rule against its `last-success` stamp, applied by the
 * policy in `./agentDistro.ts`). It asks when it starts (or is poked, say by a
 * setting change), and again once a schedule boundary (02/08/14/20 UTC, read
 * off the updater config) has passed since it last asked.
 *
 * ## Timer choice — a chained, capped `setTimeout`
 *
 * The `kavalSupervision` precedent: node timers, `unref`'d (a pending update
 * must never hold a draining padi open), chained `setTimeout`, never
 * `setInterval`. Each wait is capped at {@link MAX_WAIT_MS}, not the full time
 * to the next boundary, because a node timer counts on the monotonic clock,
 * which stands still while the machine sleeps: a six-hour timer armed before a
 * night asleep would fire hours after waking. With the cap, a machine that
 * slept through a boundary asks within minutes of waking — and the due rule
 * then runs the missed update once.
 */

import {
  nextBoundary,
  type UpdaterSchedule,
} from "@kolu/agent-distro/schedule";
import { log } from "../log.ts";

/** The longest the timer waits between looks at the wall clock. */
export const MAX_WAIT_MS = 5 * 60_000;

export interface UpdateTimerDeps {
  /** The selected profile's schedule — `undefined` while there is nothing to
   *  keep current (agents off, no bake): the timer is then idle. */
  readonly schedule: () => UpdaterSchedule | undefined;
  /** Ask the policy "is an update due" — it runs one if so. */
  readonly onDue: () => void;
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

/** Start the timer. `poke()` asks now and re-arms (the setting changed);
 *  `stop()` ends it. */
export function startUpdateTimer(deps: UpdateTimerDeps): {
  readonly poke: () => void;
  readonly stop: () => void;
} {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? nodeTimer;
  let cancel: (() => void) | undefined;
  let stopped = false;
  /** When the timer last asked, epoch ms. */
  let askedAt: number | undefined;

  const arm = (): void => {
    cancel?.();
    cancel = undefined;
    if (stopped) return;
    const schedule = deps.schedule();
    if (schedule === undefined) return;
    const t = now();
    const boundaryMs = nextBoundary(Math.floor(t / 1000), schedule) * 1000;
    cancel = setTimer(fire, Math.max(0, Math.min(boundaryMs - t, MAX_WAIT_MS)));
  };

  const ask = (): void => {
    askedAt = now();
    try {
      deps.onDue();
    } catch (err) {
      // The policy logs its own failures; a throw here is a bug in it. Keep
      // the cadence: a timer that stops because it threw once is silence.
      log.error({ err }, "agent-distro update timer: the due check threw");
    }
  };

  function fire(): void {
    cancel = undefined;
    const schedule = deps.schedule();
    if (schedule === undefined) return;
    const t = now();
    // A boundary passed since the last ask — on time, late, or across a sleep.
    if (
      askedAt === undefined ||
      nextBoundary(Math.floor(askedAt / 1000), schedule) * 1000 <= t
    )
      ask();
    arm();
  }

  const poke = (): void => {
    if (stopped) return;
    if (deps.schedule() !== undefined) ask();
    arm();
  };

  poke();
  return {
    poke,
    stop: () => {
      stopped = true;
      cancel?.();
      cancel = undefined;
    },
  };
}
