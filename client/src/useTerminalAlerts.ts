/** Terminal alerts — reactively detect Claude state transitions and fire notifications.
 *  Watches metadata subscriptions for Claude state changes. */

import { type Accessor, createEffect, on } from "solid-js";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import {
  fireActivityAlert,
  requestNotificationPermission,
} from "./useActivityAlerts";

export function useTerminalAlerts(deps: {
  activityAlerts: Accessor<boolean>;
  activeId: Accessor<TerminalId | null>;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  markUnread: (id: TerminalId) => void;
  clearAcknowledged: (id: TerminalId) => void;
  terminalIds: Accessor<TerminalId[]>;
  terminalLabel: (id: TerminalId) => string;
}) {
  // Request browser notification permission eagerly when alerts are enabled
  if (deps.activityAlerts()) requestNotificationPermission();

  // Reactively watch Claude state for all terminals.
  // SolidJS's on() tracks previous values natively — no manual Map needed.
  createEffect(
    on(
      () => deps.terminalIds().map((id) => deps.getMetadata(id)?.claude?.state),
      (states, prevStates) => {
        const ids = deps.terminalIds();
        for (let i = 0; i < ids.length; i++) {
          if (prevStates && prevStates[i] !== undefined) {
            if (prevStates[i] !== states[i]) deps.clearAcknowledged(ids[i]!);
            checkClaudeFinished(ids[i]!, prevStates[i], states[i]);
          }
        }
      },
    ),
  );

  function checkClaudeFinished(
    id: TerminalId,
    prev: string | undefined,
    next: string | undefined,
  ) {
    if (!deps.activityAlerts() || next !== "waiting" || prev === "waiting")
      return;
    const isBackground = id !== deps.activeId();
    if (isBackground) deps.markUnread(id);
    if (isBackground || document.hidden)
      fireActivityAlert(deps.terminalLabel(id));
  }

  function simulateAlert() {
    if (!deps.activityAlerts()) return;
    const inactive = deps.terminalIds().filter((id) => id !== deps.activeId());
    if (inactive.length === 0) return;
    const id = inactive[Math.floor(Math.random() * inactive.length)]!;
    deps.markUnread(id);
    fireActivityAlert(deps.terminalLabel(id));
  }

  return { simulateAlert };
}
