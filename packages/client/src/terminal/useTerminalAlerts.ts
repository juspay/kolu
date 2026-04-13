/** Terminal alerts — reactively detect agent state transitions and fire notifications.
 *  Watches metadata subscriptions for agent state changes (any AI coding agent). */

import { type Accessor, createEffect, on } from "solid-js";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import { useServerState } from "../settings/useServerState";
import {
  fireActivityAlert,
  requestNotificationPermission,
} from "./useActivityAlerts";

export function useTerminalAlerts(deps: {
  activeId: Accessor<TerminalId | null>;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  isUnread: (id: TerminalId) => boolean;
  markUnread: (id: TerminalId) => void;
  terminalIds: Accessor<TerminalId[]>;
  terminalLabel: (id: TerminalId) => string;
}) {
  const { preferences } = useServerState();
  const activityAlerts = () => preferences().activityAlerts;

  // Request browser notification permission eagerly when alerts are enabled
  if (activityAlerts()) requestNotificationPermission();

  // Badge the PWA dock icon with the unread agent count (Badging API).
  // Clears automatically when the user visits all unread terminals.
  createEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    const count = deps.terminalIds().filter((id) => deps.isUnread(id)).length;
    if (count > 0) {
      void navigator.setAppBadge(count);
    } else {
      void navigator.clearAppBadge();
    }
  });

  // Reactively watch agent state for all terminals.
  // SolidJS's on() tracks previous values natively — no manual Map needed.
  createEffect(
    on(
      () => deps.terminalIds().map((id) => deps.getMetadata(id)?.agent?.state),
      (states, prevStates) => {
        const ids = deps.terminalIds();
        for (let i = 0; i < ids.length; i++) {
          if (prevStates && prevStates[i] !== undefined) {
            checkAgentFinished(ids[i]!, prevStates[i], states[i]);
          }
        }
      },
    ),
  );

  function checkAgentFinished(
    id: TerminalId,
    prev: string | undefined,
    next: string | undefined,
  ) {
    if (!activityAlerts() || next !== "waiting" || prev === "waiting") return;
    const isBackground = id !== deps.activeId();
    if (isBackground) deps.markUnread(id);
    if (isBackground || document.hidden)
      fireActivityAlert(deps.terminalLabel(id));
  }

  function simulateAlert() {
    if (!activityAlerts()) return;
    const inactive = deps.terminalIds().filter((id) => id !== deps.activeId());
    if (inactive.length === 0) return;
    const id = inactive[Math.floor(Math.random() * inactive.length)]!;
    deps.markUnread(id);
    fireActivityAlert(deps.terminalLabel(id));
  }

  return { simulateAlert };
}
