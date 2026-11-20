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

function due(
  now: number,
  stamp: number | null,
  schedule: UpdaterSchedule,
): boolean {
  return updateDue(now, stamp, schedule.periodSeconds, schedule.offsetSeconds);
}

export interface ScheduledAttempts {
  readonly boundary: number;
  readonly count: number;
  readonly lastEnd?: { readonly at: number; readonly failed: boolean };
}

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

export function attemptEnded(
  attempts: ScheduledAttempts,
  now: number,
  failed: boolean,
): ScheduledAttempts {
  return { ...attempts, lastEnd: { at: now, failed } };
}

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

export function runFailed(outcomes: readonly HostOutcome[]): boolean {
  return outcomes.includes("failed") || !outcomes.includes("landed");
}

export function startDeliverySchedule(deps: {
  readonly delivery: AgentDelivery;
  readonly schedule: UpdaterSchedule;
  readonly enabled: () => boolean;
  readonly log: Logger;
  readonly now?: () => number;
  readonly setTimer?: UpdateTimerDeps["setTimer"];
}): { readonly poke: () => void } {
  const now = deps.now ?? Date.now;
  const { schedule, delivery, log } = deps;
  let lastSuccess: number | null = null;
  let attempts: ScheduledAttempts | undefined;
  let askAgain = false;

  const onTick = (boundaryPassed: boolean): void => {
    const t = Math.floor(now() / 1000);
    if (
      !scheduledAskNow({ now: t, schedule, boundaryPassed, askAgain, attempts })
    )
      return;
    askAgain = false;
    if (!due(t, lastSuccess, schedule)) return;
    if (delivery.running()) {
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
