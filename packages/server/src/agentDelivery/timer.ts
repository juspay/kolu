import type { UpdaterSchedule } from "@kolu/agent-distro/bake";
import { log } from "../log.ts";

export function boundaryAtOrBefore(
  now: number,
  schedule: UpdaterSchedule,
): number {
  const { periodSeconds: period, offsetSeconds: offset } = schedule;
  return Math.floor((now - offset) / period) * period + offset;
}

export function nextBoundary(now: number, schedule: UpdaterSchedule): number {
  return boundaryAtOrBefore(now, schedule) + schedule.periodSeconds;
}

export const SUSPEND_SAFE_LOOK_MS = 5 * 60_000;

export interface UpdateTimerDeps {
  readonly schedule: () => UpdaterSchedule | undefined;
  readonly onTick: (boundaryPassed: boolean) => void;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => () => void;
}

function nodeTimer(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

export function startUpdateTimer(deps: UpdateTimerDeps): {
  readonly poke: () => void;
} {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? nodeTimer;
  let cancel: (() => void) | undefined;
  let boundaryAt: number | undefined;

  const arm = (): void => {
    cancel?.();
    cancel = undefined;
    const schedule = deps.schedule();
    if (schedule === undefined) return;
    const t = now();
    const boundaryMs = nextBoundary(Math.floor(t / 1000), schedule) * 1000;
    cancel = setTimer(
      fire,
      Math.max(0, Math.min(boundaryMs - t, SUSPEND_SAFE_LOOK_MS)),
    );
  };

  const tick = (boundaryPassed: boolean): void => {
    if (boundaryPassed) boundaryAt = now();
    try {
      deps.onTick(boundaryPassed);
    } catch (err) {
      log.error({ err }, "agent-distro delivery timer: the due check threw");
    }
  };

  function fire(): void {
    cancel = undefined;
    const schedule = deps.schedule();
    if (schedule === undefined) return;
    const t = now();
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
