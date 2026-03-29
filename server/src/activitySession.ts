/**
 * Activity session tracker — coalesces bursts of terminal activity into
 * sessions and emits a "session ended" event with total duration.
 *
 * Two-timer pattern (inspired by tmux monitor-silence):
 * - The *idle timer* (external, in terminals.ts) handles the visual active/sleeping
 *   indicator with a short threshold (5s).
 * - The *session timer* (here) uses a longer grace period to coalesce gaps within
 *   a single logical session (e.g., an AI agent pausing between tool calls).
 *
 * A session starts on the first activity after silence and ends when the grace
 * period expires without new activity. The emitted duration covers the entire
 * session from first activity to last activity (excluding the trailing grace period).
 */

export interface SessionEndEvent {
  /** Total session duration in seconds (first activity → last activity). */
  durationS: number;
  /** Timestamp (epoch ms) of the last activity in the session. */
  lastActivityAt: number;
}

export interface ActivitySessionTracker {
  /** Call on every PTY output event. */
  touch(): void;
  /** Call when the terminal is being destroyed. Cancels pending timers. */
  dispose(): void;
}

export interface ActivitySessionOpts {
  /** Grace period in ms — how long to wait after last activity before
   *  declaring the session over. Default: 30_000 (30s). */
  gracePeriodMs?: number;
  /** Called when a coalesced session ends. */
  onSessionEnd: (event: SessionEndEvent) => void;
  /** Clock function for testability. Default: Date.now. */
  now?: () => number;
}

// 10s filters out cursor blinks (~1-2s) and prompt refreshes (starship, etc.)
// while keeping alerts responsive (~15s total: 5s idle threshold + 10s grace).
const DEFAULT_GRACE_MS = 10_000;

export function createActivitySession(
  opts: ActivitySessionOpts,
): ActivitySessionTracker {
  const gracePeriodMs = opts.gracePeriodMs ?? DEFAULT_GRACE_MS;
  const now = opts.now ?? Date.now;

  let sessionStart: number | null = null;
  let lastActivity: number | null = null;
  let sessionTimer: ReturnType<typeof setTimeout> | null = null;

  function touch(): void {
    const t = now();
    lastActivity = t;

    // Start a new session if none is active
    if (sessionStart === null) {
      sessionStart = t;
    }

    // Reset the grace timer
    if (sessionTimer !== null) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => {
      // Grace period expired — session is over
      const duration = lastActivity! - sessionStart!;
      const lastAt = lastActivity!;
      sessionStart = null;
      lastActivity = null;
      sessionTimer = null;
      opts.onSessionEnd({ durationS: duration / 1000, lastActivityAt: lastAt });
    }, gracePeriodMs);
  }

  function dispose(): void {
    if (sessionTimer !== null) {
      clearTimeout(sessionTimer);
      sessionTimer = null;
    }
    sessionStart = null;
    lastActivity = null;
  }

  return { touch, dispose };
}
