/** Terminal alerts — reactively detect Claude state transitions and fire notifications.
 *  Watches the terminal store for Claude state changes instead of being called via callback. */

import { type Accessor, createEffect } from "solid-js";
import type { TerminalId } from "kolu-common";
import {
  fireActivityAlert,
  requestNotificationPermission,
} from "./useActivityAlerts";
import type { TerminalMetaStore, SetTerminalMeta } from "./useTerminalStore";


export function useTerminalAlerts(deps: {
  activityAlerts: Accessor<boolean>;
  activeId: Accessor<TerminalId | null>;
  meta: TerminalMetaStore;
  setMeta: SetTerminalMeta;
  terminalIds: Accessor<TerminalId[]>;
  terminalLabel: (id: TerminalId) => string;
}) {
  // Request browser notification permission eagerly when alerts are enabled
  if (deps.activityAlerts()) requestNotificationPermission();

  // Track previous Claude state per terminal for transition detection.
  const prevStates = new Map<TerminalId, string | undefined>();

  // Reactively watch Claude state for all terminals.
  // Re-runs when terminalIds change or any terminal's Claude state changes.
  createEffect(() => {
    const ids = deps.terminalIds();
    const activeIds = new Set(ids);
    // Prune entries for removed terminals
    for (const id of prevStates.keys()) {
      if (!activeIds.has(id)) prevStates.delete(id);
    }
    for (const id of ids) {
      const state = deps.meta[id]?.meta?.claude?.state;
      const prev = prevStates.get(id);
      // Skip initial observation (prev not yet tracked) — only fire on transitions
      if (prev !== undefined) {
        checkClaudeFinished(id, prev, state);
      }
      prevStates.set(id, state);
    }
  });

  /** Alert when Claude transitions to "waiting" on a terminal. */
  function checkClaudeFinished(
    id: TerminalId,
    prev: string | undefined,
    next: string | undefined,
  ) {
    if (!deps.activityAlerts() || next !== "waiting" || prev === "waiting")
      return;
    const isBackground = id !== deps.activeId();
    if (isBackground) deps.setMeta(id, "notified", true);
    if (isBackground || document.hidden)
      fireActivityAlert(deps.terminalLabel(id));
  }

  /** Simulate an activity alert on a random background terminal (debug).
   *  Respects the activityAlerts preference, mirroring real behavior. */
  function simulateAlert() {
    if (!deps.activityAlerts()) return;
    const inactive = deps.terminalIds().filter((id) => id !== deps.activeId());
    if (inactive.length === 0) return;
    const id = inactive[Math.floor(Math.random() * inactive.length)]!;
    deps.setMeta(id, "notified", true);
    fireActivityAlert(deps.terminalLabel(id));
  }

  return { simulateAlert };
}
