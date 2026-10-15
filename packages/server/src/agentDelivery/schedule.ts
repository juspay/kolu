/**
 * WHEN kolu-server delivers on its own: upstream's schedule (02/08/14/20 UTC,
 * `lib.schedule`) and upstream's numbers for a run that FAILS — up to three
 * runs a boundary, five minutes after the failed one ended
 * (`@juspay/agent-distro/update/due`). A run is due when none has succeeded
 * since the latest boundary (upstream's `updateDue`), so a check the user asked for
 * just before a boundary is not repeated at it.
 *
 * A run FAILS when any host's delivery failed (a network drop, a cache that
 * did not answer), or when it reached no host at all — so a boundary is never
 * spent on a run that asked nobody.
 *
 * The other triggers live with their facts: a host whose padi just bound or
 * whose setting just changed is delivered to by `./install.ts`; the user's
 * "check for newer agents" runs at once (a fresh index read), counting toward no
 * boundary's attempts.
 */

import {
  SCHEDULED_ATTEMPTS,
  SCHEDULED_RETRY_SECONDS,
  updateDue,
} from "@juspay/agent-distro/update/due";
import type { UpdaterSchedule } from "@kolu/agent-distro/bake";
import type { Logger } from "@kolu/log";
import type { AgentDelivery, HostOutcome } from "./delivery.ts";
import {
  boundaryAtOrBefore,
  startUpdateTimer,
  type UpdateTimerDeps,
} from "./timer.ts";

/** Upstream's due rule (`@juspay/agent-distro/update/due`), over the baked
 *  schedule. */
function due(
  now: number,
  stamp: number | null,
  schedule: UpdaterSchedule,
): boolean {
  return updateDue(now, stamp, schedule.periodSeconds, schedule.offsetSeconds);
}

/** The scheduled runs one boundary has had so far, as kolu-server counts them
 *  — upstream's `--scheduled` numbers (`SCHEDULED_ATTEMPTS` runs a boundary,
 *  `SCHEDULED_RETRY_SECONDS` after a failed one ENDED), kept by a timer here
 *  instead of upstream's sleep. A `skipped` run is not retried. */
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
 *  scheduled run FAILED and it has attempts left, `SCHEDULED_RETRY_SECONDS`
 *  after that run ended. Whether a run then starts is still the due rule's
 *  call. */
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

/** Did a run fail — a host's delivery failed, or it landed on no host at all
 *  (every padi still dialling at boot, offline, or already being delivered
 *  to)? */
export function runFailed(outcomes: readonly HostOutcome[]): boolean {
  return outcomes.includes("failed") || !outcomes.includes("landed");
}

export function startDeliverySchedule(deps: {
  readonly delivery: AgentDelivery;
  readonly schedule: UpdaterSchedule;
  /** Agents are on: the timer idles while they are off. */
  readonly enabled: () => boolean;
  readonly log: Logger;
  readonly now?: () => number;
  readonly setTimer?: UpdateTimerDeps["setTimer"];
}): { readonly poke: () => void } {
  const now = deps.now ?? Date.now;
  const { schedule, delivery, log } = deps;
  /** The last run that reached a host and failed nowhere, epoch seconds —
   *  process-local on purpose: a restarted kolu-server delivers to every host
   *  as it binds it anyway (the connect trigger), so a persisted stamp would
   *  save no ask. */
  let lastSuccess: number | null = null;
  let attempts: ScheduledAttempts | undefined;
  let askAgain = false;

  // The timer ticks only while agents are on (its schedule is `undefined`
  // otherwise), so a tick never has to ask.
  const onTick = (boundaryPassed: boolean): void => {
    const t = Math.floor(now() / 1000);
    if (
      !scheduledAskNow({ now: t, schedule, boundaryPassed, askAgain, attempts })
    )
      return;
    askAgain = false;
    if (!due(t, lastSuccess, schedule)) return;
    if (delivery.running()) {
      // Ask again at the next look: this ask did not count.
      askAgain = true;
      return;
    }
    attempts = attemptStarted(attempts, t, schedule);
    log.info({ attempt: attempts.count }, "agent-distro delivery due");
    void delivery.run({ trigger: "schedule" }).then((outcomes) => {
      const end = Math.floor(now() / 1000);
      const failed = runFailed(outcomes);
      if (attempts !== undefined)
        attempts = attemptEnded(attempts, end, failed);
      if (!failed) lastSuccess = end;
    });
  };

  return startUpdateTimer({
    schedule: () => (deps.enabled() ? schedule : undefined),
    onTick,
    now,
    ...(deps.setTimer === undefined ? {} : { setTimer: deps.setTimer }),
  });
}
