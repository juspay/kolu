/** Terminal alerts — reactively detect agent state transitions and fire notifications.
 *  Watches metadata subscriptions for agent state changes (any AI coding agent). */

import { makeEventListener } from "@solid-primitives/event-listener";
import { SW_MESSAGE_TYPE } from "@kolu/surface-app";
import {
  activeArm,
  type TerminalId,
  type TerminalMetadata,
} from "kolu-common/surface";
import "kolu-common/test-hooks";
import { type Accessor, createEffect, on } from "solid-js";
import { preferences } from "../wire";
import { isAttentionState } from "./agentState";
import { useStaleCheck } from "./staleness";
import type { TerminalSubject } from "./terminalSubject";
import {
  fireActivityAlert,
  requestNotificationPermission,
} from "./useActivityAlerts";

export function useTerminalAlerts(deps: {
  activeId: Accessor<TerminalId | null>;
  activate: (id: TerminalId) => void;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  getSubject: (id: TerminalId) => TerminalSubject;
  hasBadgeAttention: (id: TerminalId) => boolean;
  clearBadgeAttention: () => void;
  markUnread: (id: TerminalId) => void;
  markBadgeAttention: (id: TerminalId) => void;
  terminalIds: Accessor<TerminalId[]>;
}) {
  const activityAlerts = () => preferences().activityAlerts;
  const isStale = useStaleCheck();

  // Request browser notification permission eagerly when alerts are enabled
  if (activityAlerts()) requestNotificationPermission();

  // Stale terminals are excluded — but the attention mark itself
  // stays, so a fresh agent transition (which bumps `lastActivityAt`
  // and unparks) wakes the badge back up. `isStale` is purely
  // temporal: a `waiting` agent past the activity window suppresses
  // the badge along with every other stale terminal — by design, so a
  // user who's been away long enough doesn't get a phantom badge from
  // yesterday's queue. The dock still surfaces those terminals via
  // their parked-row AgentIndicator; the OS badge is for "act now".
  const isAttentionLive = (id: TerminalId) => {
    if (!deps.hasBadgeAttention(id)) return false;
    const meta = deps.getMetadata(id);
    if (!meta) return false;
    return !isStale(meta.lastActivityAt);
  };

  // Badge the PWA dock icon with terminals that need attention. The
  // effect re-runs on every staleness tick (~60s), so guard against
  // re-issuing the same count to the OS shell.
  let lastBadgeCount = -1;
  createEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    const count = deps.terminalIds().filter(isAttentionLive).length;
    if (count === lastBadgeCount) return;
    lastBadgeCount = count;
    if (count > 0) {
      void navigator.setAppBadge(count);
    } else {
      void navigator.clearAppBadge();
    }
  });

  makeEventListener(document, "visibilitychange", () => {
    if (!document.hidden) deps.clearBadgeAttention();
  });

  // Route a click on an OS notification back to the terminal that finished. The
  // notification worker (`NOTIFICATION_SW_SOURCE`) handles `notificationclick`
  // in the worker — it can't reach into the page — so it focuses the window and
  // posts the alert's `data` here, where we have `activate`. (An installed-PWA
  // notification has no page-level `Notification.onclick`.)
  if ("serviceWorker" in navigator) {
    makeEventListener(navigator.serviceWorker, "message", (event) => {
      const msg = event.data;
      if (msg?.type !== SW_MESSAGE_TYPE) return;
      const id = msg.data?.terminalId as TerminalId | undefined;
      if (id !== undefined) deps.activate(id);
    });
  }

  // Reactively watch agent state for all terminals.
  // SolidJS's on() tracks previous values natively — no manual Map needed.
  createEffect(
    on(
      () =>
        deps.terminalIds().map((id) => {
          return activeArm(deps.getMetadata(id))?.agent?.state;
        }),
      (states, prevStates) => {
        const ids = deps.terminalIds();
        if (!prevStates) return;
        for (const [i, id] of ids.entries()) {
          const prev = prevStates[i];
          if (prev !== undefined) checkAgentFinished(id, prev, states[i]);
        }
      },
    ),
  );

  function checkAgentFinished(
    id: TerminalId,
    prev: string | undefined,
    next: string | undefined,
  ) {
    if (!activityAlerts()) return;
    // Fire on entry into the "needs-attention" class (waiting or
    // awaiting_user). Treating the two as one class means we don't
    // double-alert when the agent flips between them in one session.
    if (!isAttentionState(next) || isAttentionState(prev)) return;
    alertForTerminal(id);
  }

  function alertForTerminal(id: TerminalId) {
    const isBackground = id !== deps.activeId();
    if (isBackground) {
      deps.markUnread(id);
    } else if (document.hidden) {
      deps.markBadgeAttention(id);
    }
    // Alert unless the user is *actively watching this very terminal* — i.e.
    // it's the active terminal AND kolu has focus. `document.hasFocus()` is the
    // right signal, not `document.hidden`: hidden is only true when kolu is fully
    // off-screen, which on macOS is almost never the case (switching to another
    // app while Chrome stays visible keeps it false via occlusion) — so the old
    // `isBackground || document.hidden` gate meant a banner essentially never
    // fired. `hasFocus()` is false whenever the doc is hidden too, so it
    // subsumes the old check and also covers "switched apps, kolu still visible".
    if (isBackground || !document.hasFocus())
      void fireActivityAlert(deps.getSubject(id), { terminalId: id });
  }

  function simulateAlert(options?: { target?: "active" | "inactive" }) {
    if (!activityAlerts()) return;
    const ids =
      options?.target === "active"
        ? deps.terminalIds().filter((id) => id === deps.activeId())
        : deps.terminalIds().filter((id) => id !== deps.activeId());
    const pick = ids[Math.floor(Math.random() * ids.length)];
    if (pick === undefined) return;
    alertForTerminal(pick);
  }

  // Expose for e2e test access (type from "kolu-common/test-hooks"). Installed
  // by the producer — App.tsx neither produces nor consumes this bridge.
  // useTerminalAlerts is constructed unconditionally on the App-startup path
  // (via useTerminals), so the hook is present before any scenario runs, and
  // the singleton lives for the app's lifetime — same timing as before.
  window.__koluSimulateAlert = simulateAlert;

  return { simulateAlert };
}
