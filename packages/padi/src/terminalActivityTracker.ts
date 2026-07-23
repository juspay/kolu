/**
 * The padi-side "which terminals are moving bytes RIGHT NOW" tracker — a live SET
 * of terminal ids that carry a per-terminal quiet-period timer: an id joins on
 * `noteOutput` and leaves once `idleAfterMs` pass with no further output, each
 * chunk re-arming the timer.
 *
 * Extracted from `liveActivity.ts` (its first home) so a second consumer — the
 * effective-finish quiet window (EF2, `finishQuiet.ts`) — reuses the SAME timer
 * machinery rather than hand-rolling a near-identical copy. The two differ only
 * in their WINDOW (`liveActivity` the sub-second live-dot cadence; finish the
 * multi-second effective-finish debounce) and in how they READ the set
 * (`liveActivity` streams the sorted `snapshot()`; finish reads `isLive(id)` to
 * tell a still-noisy `waiting` terminal from a settled one) — both parameterized
 * here, so the fold itself is one source of truth. This is the padi twin of the
 * client's `useTerminalActivity` (a different runtime — browser store, no timer
 * `unref`).
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";

export interface ActivityTracker {
  /** Record a chunk of output for `id`: light its live flag (publishing a change
   *  if it was static) and arm/refresh the quiet-period timer. */
  noteOutput(id: TerminalId): void;
  /** Drop a departed (or newly-tapped-then-gone) terminal — clears its timer and
   *  removes it from the live set at once. */
  forget(id: TerminalId): void;
  /** Whether `id` is in the live set right now — output landed within the last
   *  `idleAfterMs`. The finish-quiet consumer reads this to hold a still-noisy
   *  `waiting` terminal out of `finishedIds`. */
  isLive(id: TerminalId): boolean;
  /** The current live set as a SORTED array — a stable wire frame (so an unordered
   *  Set mutation can't churn a consumer with reordered-but-equal frames). */
  snapshot(): TerminalId[];
  /** Subscribe to live-set changes; returns an unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Stop every timer and drop all state. */
  dispose(): void;
}

/** Build an {@link ActivityTracker} whose entries expire `idleAfterMs` after their
 *  last `noteOutput`. */
export function createActivityTracker(idleAfterMs: number): ActivityTracker {
  const live = new Set<TerminalId>();
  const timers = new Map<TerminalId, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of listeners) l();
  };
  return {
    noteOutput(id) {
      if (!live.has(id)) {
        live.add(id);
        notify();
      }
      const pending = timers.get(id);
      if (pending) clearTimeout(pending);
      const timer = setTimeout(() => {
        timers.delete(id);
        if (live.delete(id)) notify();
      }, idleAfterMs);
      // Don't let a pending idle-timer keep the process alive — the serve link does.
      timer.unref?.();
      timers.set(id, timer);
    },
    forget(id) {
      const pending = timers.get(id);
      if (pending) clearTimeout(pending);
      timers.delete(id);
      if (live.delete(id)) notify();
    },
    isLive(id) {
      return live.has(id);
    },
    snapshot() {
      return [...live].sort();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      live.clear();
      listeners.clear();
    },
  };
}

/** Frame equality for a live-set stream — both come from `snapshot()` so they are
 *  sorted; compare length then element-wise. Lets a poll suppress a redundant yield
 *  when a timer re-arm didn't actually change the live set. */
export function sameActivitySet(
  a: readonly TerminalId[],
  b: readonly TerminalId[],
): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
