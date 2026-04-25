/** Terminal alerts — reactively detect agent state transitions and fire notifications.
 *  Watches metadata subscriptions for agent state changes (any AI coding agent). */

import { makeEventListener } from "@solid-primitives/event-listener";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import { type Accessor, createEffect, on } from "solid-js";
import { usePreferences } from "../settings/usePreferences";
import {
  fireActivityAlert,
  requestNotificationPermission,
} from "./useActivityAlerts";

export function useTerminalAlerts(deps: {
  activeId: Accessor<TerminalId | null>;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  hasBadgeAttention: (id: TerminalId) => boolean;
  clearBadgeAttention: () => void;
  markUnread: (id: TerminalId) => void;
  markBadgeAttention: (id: TerminalId) => void;
  terminalIds: Accessor<TerminalId[]>;
  terminalLabel: (id: TerminalId) => string;
}) {
  const { preferences } = usePreferences();
  const activityAlerts = () => preferences().activityAlerts;

  // Request browser notification permission eagerly when alerts are enabled
  if (activityAlerts()) requestNotificationPermission();

  // Badge the PWA dock icon with terminals that need attention.
  createEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    const count = deps.terminalIds().filter(deps.hasBadgeAttention).length;
    if (count > 0) {
      void navigator.setAppBadge(count);
    } else {
      void navigator.clearAppBadge();
    }
  });

  makeEventListener(document, "visibilitychange", () => {
    if (!document.hidden) deps.clearBadgeAttention();
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
    alertForTerminal(id);
  }

  function alertForTerminal(id: TerminalId) {
    const isBackground = id !== deps.activeId();
    if (isBackground) {
      deps.markUnread(id);
    } else if (document.hidden) {
      deps.markBadgeAttention(id);
    }
    if (isBackground || document.hidden)
      fireActivityAlert(deps.terminalLabel(id));
  }

  function simulateAlert(options?: { target?: "active" | "inactive" }) {
    if (!activityAlerts()) return;
    const ids =
      options?.target === "active"
        ? deps.terminalIds().filter((id) => id === deps.activeId())
        : deps.terminalIds().filter((id) => id !== deps.activeId());
    if (ids.length === 0) return;
    alertForTerminal(ids[Math.floor(Math.random() * ids.length)]!);
  }

  return { simulateAlert };
}
