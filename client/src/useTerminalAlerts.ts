/** Terminal alerts — reactively detect Claude state transitions and fire notifications.
 *  Watches TanStack metadata queries for Claude state changes. */

import { type Accessor, createEffect } from "solid-js";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import {
  fireActivityAlert,
  requestNotificationPermission,
} from "./useActivityAlerts";

export function useTerminalAlerts(deps: {
  activityAlerts: Accessor<boolean>;
  activeId: Accessor<TerminalId | null>;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  markAttention: (id: TerminalId) => void;
  terminalIds: Accessor<TerminalId[]>;
  terminalLabel: (id: TerminalId) => string;
}) {
  // Request browser notification permission eagerly when alerts are enabled
  if (deps.activityAlerts()) requestNotificationPermission();

  // Track previous Claude state per terminal for transition detection.
  const prevStates = new Map<TerminalId, string | undefined>();

  // Reactively watch Claude state for all terminals.
  createEffect(() => {
    const ids = deps.terminalIds();
    const activeIds = new Set(ids);
    for (const id of prevStates.keys()) {
      if (!activeIds.has(id)) prevStates.delete(id);
    }
    for (const id of ids) {
      const state = deps.getMetadata(id)?.claude?.state;
      const prev = prevStates.get(id);
      if (prev !== undefined) {
        checkClaudeFinished(id, prev, state);
      }
      prevStates.set(id, state);
    }
  });

  function checkClaudeFinished(
    id: TerminalId,
    prev: string | undefined,
    next: string | undefined,
  ) {
    if (!deps.activityAlerts() || next !== "waiting" || prev === "waiting")
      return;
    const isBackground = id !== deps.activeId();
    if (isBackground) deps.markAttention(id);
    if (isBackground || document.hidden)
      fireActivityAlert(deps.terminalLabel(id));
  }

  function simulateAlert() {
    if (!deps.activityAlerts()) return;
    const inactive = deps.terminalIds().filter((id) => id !== deps.activeId());
    if (inactive.length === 0) return;
    const id = inactive[Math.floor(Math.random() * inactive.length)]!;
    deps.markAttention(id);
    fireActivityAlert(deps.terminalLabel(id));
  }

  return { simulateAlert };
}
