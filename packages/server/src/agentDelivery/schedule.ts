/**
 * WHEN kolu-server delivers on its own: upstream's schedule (02/08/14/20 UTC,
 * `lib.schedule`) and upstream's numbers for a run that FAILS — up to three
 * runs a boundary, five minutes after the failed one ended
 * (`@kolu/agent-distro/schedule`). A run is due when none has succeeded since
 * the latest boundary (upstream's `updateDue`), so a check the user asked for
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
  attemptEnded,
  attemptStarted,
  type ScheduledAttempts,
  scheduledAskNow,
  type UpdaterSchedule,
  updateDue,
} from "@kolu/agent-distro/schedule";
import type { Logger } from "@kolu/log";
import type { AgentDelivery, HostOutcome } from "./delivery.ts";
import { startUpdateTimer, type UpdateTimerDeps } from "./timer.ts";

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
    if (!updateDue(t, lastSuccess, schedule)) return;
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
