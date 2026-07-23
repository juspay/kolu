/**
 * Trailing-edge coalescing scheduler with a hard maxWait cap.
 *
 * ## Why (juspay/kolu#1952)
 *
 * A pure trailing debounce (reset the quiet timer on every edge) starves under
 * a hot source: Grok's `phase_changed` firehose, dense `fs.watch` bursts, WAL
 * write storms. While edges keep arriving faster than the quiet window, the
 * callback never fires — and any append-poll floor that feeds the *same*
 * `schedule()` is defeated the same way (#1754 + #1952).
 *
 * `maxWaitMs` caps how long a pending fire can be postponed from the first
 * edge in a burst. Quiet sources still settle in `debounceMs`; hot sources
 * publish at least every `maxWaitMs`.
 *
 * Production watch sites bake `COALESCE_MAX_WAIT_MS` as a module constant
 * (no per-call opt-out — conventions.md). Tests pass short real intervals
 * the same way `subscribeFileAppends` requires `intervalMs`.
 */

/** Default quiet-window used by agent / git / WAL watchers (150 ms). */
export const COALESCE_DEBOUNCE_MS = 150;

/**
 * Hard cap on how long continuous edges may postpone a fire. Must stay
 * ≤ `DEFAULT_APPEND_POLL_MS` (1s) so a hot stream still publishes within
 * one append-poll floor tick of the first change in a burst. Module
 * constant — not a consumer-disableable knob.
 */
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
  /** Quiet-window in ms. Required (no default — same fail-fast shape as
   *  `subscribeFileAppends.intervalMs`). Production passes
   *  `COALESCE_DEBOUNCE_MS`; tests inject a short real interval. */
  debounceMs: number;
  /** Hard cap in ms from the first pending edge. Required. Production
   *  watchers pass `COALESCE_MAX_WAIT_MS`; never omit to "disable". */
  maxWaitMs: number;
  /** Invoked once the quiet window or the maxWait cap elapses. */
  onFire: () => void;
}

/**
 * Create a coalescing schedule handle. `onFire` is not wrapped — a throwing
 * fire escapes to the host timer (callers that need isolation catch inside
 * `onFire`, matching the prior hand-rolled debounce sites). Wall clock is
 * `Date.now` by construction — no optional clock inject (dead-knob ban).
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
