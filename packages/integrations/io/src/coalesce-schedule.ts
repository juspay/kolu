/** Default quiet-window used by agent / git / WAL watchers (150 ms). */
export const COALESCE_DEBOUNCE_MS = 150;

/** Hard cap on how long continuous edges may postpone a fire. */
export const COALESCE_MAX_WAIT_MS = 500;

export interface CoalesceSchedule {
  /** Arm or re-arm the trailing window (capped by maxWait from first pending). */
  schedule(): void;
  /** Drop a pending fire without destroying the handle. */
  cancel(): void;
  /** Cancel and refuse further `schedule()` calls. */
  destroy(): void;
}

export interface CoalesceScheduleOpts {
  /** Quiet-window in ms. Production passes `COALESCE_DEBOUNCE_MS`; tests
   *  inject a short synthetic interval. */
  debounceMs: number;
  /** Hard cap in ms from the first pending edge. Production watchers pass
   *  `COALESCE_MAX_WAIT_MS`. */
  maxWaitMs: number;
  /** Invoked once the quiet window or the maxWait cap elapses. */
  onFire: () => void;
}

/**
 * Create a coalescing schedule handle. `onFire` is not wrapped — a throwing
 * fire escapes to the host timer; a caller that needs isolation catches
 * inside `onFire`.
 */
export function createCoalesceSchedule(
  opts: CoalesceScheduleOpts,
): CoalesceSchedule {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingSince: number | null = null;
  let destroyed = false;

  function cancel(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingSince = null;
  }

  return {
    schedule() {
      if (destroyed) return;
      const t = Date.now();
      if (pendingSince === null) pendingSince = t;
      if (timer) clearTimeout(timer);
      const delay = Math.min(
        opts.debounceMs,
        Math.max(0, opts.maxWaitMs - (t - pendingSince)),
      );
      timer = setTimeout(() => {
        timer = null;
        pendingSince = null;
        opts.onFire();
      }, delay);
    },
    cancel,
    destroy() {
      destroyed = true;
      cancel();
    },
  };
}
