/** Terminal alerts — reactively detect Claude state transitions and fire notifications.
 *  Watches TanStack metadata queries for Claude state changes. */

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
  markAttention: (id: TerminalId) => void;
  workspaceIds: Accessor<TerminalId[]>;
  workspaceLabel: (id: TerminalId) => string;
}) {
  // Request browser notification permission eagerly when alerts are enabled
  if (deps.activityAlerts()) requestNotificationPermission();

  // Reactively watch Claude state for all terminals.
  // SolidJS's on() tracks previous values natively — no manual Map needed.
  createEffect(
    on(
      () =>
        deps.workspaceIds().map((id) => deps.getMetadata(id)?.claude?.state),
      (states, prevStates) => {
        const ids = deps.workspaceIds();
        for (let i = 0; i < ids.length; i++) {
          if (prevStates && prevStates[i] !== undefined) {
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
    if (isBackground) deps.markAttention(id);
    if (isBackground || document.hidden)
      fireActivityAlert(deps.workspaceLabel(id));
  }

  function simulateAlert() {
    if (!deps.activityAlerts()) return;
    const inactive = deps.workspaceIds().filter((id) => id !== deps.activeId());
    if (inactive.length === 0) return;
    const id = inactive[Math.floor(Math.random() * inactive.length)]!;
    deps.markAttention(id);
    fireActivityAlert(deps.workspaceLabel(id));
  }

  return { simulateAlert };
}
