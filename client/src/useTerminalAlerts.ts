/** Terminal alerts — detect Claude state transitions and fire notifications. */

import type { Accessor } from "solid-js";
import type { TerminalId } from "kolu-common";
import {
  fireActivityAlert,
  requestNotificationPermission,
} from "./useActivityAlerts";
import type { SetTerminalMeta } from "./useTerminalStore";

export function useTerminalAlerts(deps: {
  activityAlerts: Accessor<boolean>;
  activeId: Accessor<TerminalId | null>;
  setMeta: SetTerminalMeta;
  terminalIds: Accessor<TerminalId[]>;
  terminalLabel: (id: TerminalId) => string;
}) {
  // Request browser notification permission eagerly when alerts are enabled
  if (deps.activityAlerts()) requestNotificationPermission();

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

  return { checkClaudeFinished, simulateAlert };
}
