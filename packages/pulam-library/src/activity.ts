/**
 * Live-output activity tracker — the host-side source of the workspace's
 * `activity` stream (the green dot for terminals on the fleet board).
 *
 * This is the host-side twin of kolu's client-side `useTerminalActivity`
 * (`packages/client/src/terminal/useTerminalActivity.ts`): both answer "is this
 * terminal moving bytes *right now*", both key off raw PTY output (here: kaval's
 * `terminalAttach` delta tap, wired by `watchTerminalAwareness`), and both flip a terminal
 * back to static after a ~1s quiet window with an explicit boolean rather than a
 * `now - lastOutputAt` clock, so no global ticking is needed. It is deliberately
 * NOT `AwarenessValue.lastActivityAt` — that's the slow agent-staleness clock and
 * would never light for a plain `npm run build` or `tail -f`.
 *
 * It carries no bytes: `noteOutput` is called once per output chunk and forgets
 * the chunk immediately. The only state is the live *set* of terminal ids, which
 * the `activity` stream publishes whole (snapshot-then-deltas) on every change.
 */

import type { TerminalId } from "./schema.ts";

/** Output quiet-period before a terminal reads as static again — matches kolu's
 *  `useTerminalActivity` IDLE_AFTER_MS, so the local dot and the remote dot
 *  breathe at the same cadence. */
const IDLE_AFTER_MS = 1000;

export interface ActivityTracker {
  /** Record a chunk of output for `id`: light its live flag (publishing a change
   *  if it was static) and arm/refresh the quiet-period timer. */
  noteOutput(id: TerminalId): void;
  /** Drop a departed terminal — clears its timer and removes it from the live set
   *  immediately (rather than waiting out the quiet period after it's gone). */
  forget(id: TerminalId): void;
  /** The current live set as a sorted array — a stable wire frame (so an
   *  unordered Set mutation can't churn the stream with reordered-but-equal
   *  frames). */
  snapshot(): TerminalId[];
  /** Subscribe to live-set changes; returns an unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Stop every timer and drop all state (teardown). */
  dispose(): void;
}

export function createActivityTracker(opts?: {
  idleAfterMs?: number;
}): ActivityTracker {
  const idleAfterMs = opts?.idleAfterMs ?? IDLE_AFTER_MS;
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

/** Frame equality for the `activity` stream — both come from `snapshot()` so they
 *  are sorted; compare length then element-wise. Lets `pollOnEvent` suppress a
 *  redundant yield when a timer re-arm didn't actually change the live set. */
export function sameActivitySet(
  a: readonly TerminalId[],
  b: readonly TerminalId[],
): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
