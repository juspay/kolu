/** Activity history — time-series tracking for sparkline rendering. */

import { createStore, produce } from "solid-js/store";
import type { TerminalId, ActivitySample } from "kolu-common";
import { ACTIVITY_WINDOW_MS } from "kolu-common/config";

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

function getActivityHistory(id: TerminalId): ActivitySample[] {
  return activityHistory[id] ?? [];
}

function seedActivity(id: TerminalId, history: ActivitySample[]) {
  setActivityHistory(id, history);
}

function clearActivity(id: TerminalId) {
  setActivityHistory(produce((s) => delete s[id]));
}

export function useActivity() {
  return {
    pushActivity,
    getActivityHistory,
    seedActivity,
    clearActivity,
  } as const;
}
