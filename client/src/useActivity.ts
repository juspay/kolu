/** Activity history — time-series tracking for sparkline rendering. */

import { createStore, produce } from "solid-js/store";
import type { TerminalId, ActivitySample } from "kolu-common";
import { ACTIVITY_WINDOW_MS } from "kolu-common/config";

let cached: ReturnType<typeof createActivity> | undefined;

function createActivity() {
  const [activityHistory, setActivityHistory] = createStore<
    Record<TerminalId, ActivitySample[]>
  >({});

  /** Append an activity sample and trim old entries beyond the rolling window. */
  function pushActivity(id: TerminalId, active: boolean) {
    const now = Date.now();
    const cutoff = now - ACTIVITY_WINDOW_MS;
    setActivityHistory(id, (prev) => [
      ...(prev ?? []).filter(([t]) => t >= cutoff),
      [now, active],
    ]);
  }

  /** Get activity history for a terminal (for sparkline rendering). */
  function getActivityHistory(id: TerminalId): ActivitySample[] {
    return activityHistory[id] ?? [];
  }

  /** Seed activity history from server (late-joining clients get full sparkline). */
  function seedActivity(id: TerminalId, history: ActivitySample[]) {
    setActivityHistory(id, history);
  }

  /** Remove activity history for a terminal. */
  function clearActivity(id: TerminalId) {
    setActivityHistory(produce((s) => delete s[id]));
  }

  return { pushActivity, getActivityHistory, seedActivity, clearActivity };
}

export function useActivity() {
  if (!cached) cached = createActivity();
  return cached;
}
