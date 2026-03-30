/** Terminal session state — thin composition shell.
 *
 *  ARCHITECTURE: This file wires together focused modules:
 *    - useTerminalStore.ts  — store, signals, accessors (pure state)
 *    - useTerminalStreams.ts — exit event subscription
 *    - useTerminalLifecycle.ts — CRUD, restore-on-load, worktree ops
 *    - useTerminalAlerts.ts — Claude state detection (watches store reactively)
 *    - TerminalLiveData.tsx — per-terminal live queries (metadata + activity via TanStack)
 *  New features should go in the appropriate module (or a new one),
 *  not back into this composition root. See #221. */

import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common";
import type { useActivity } from "./useActivity";
import { useTerminalStore } from "./useTerminalStore";
import { useTerminalStreams } from "./useTerminalStreams";
import { useTerminalLifecycle } from "./useTerminalLifecycle";
import { useTerminalAlerts } from "./useTerminalAlerts";

export function useTerminals(deps: {
  randomTheme: Accessor<boolean>;
  activity: ReturnType<typeof useActivity>;
  activityAlerts: Accessor<boolean>;
}) {
  const { pushActivity, getActivityHistory, seedActivity, clearActivity } =
    deps.activity;

  const store = useTerminalStore({ getActivityHistory });

  // Alerts watch the store reactively — no callback wiring needed
  const alerts = useTerminalAlerts({
    activityAlerts: deps.activityAlerts,
    activeId: store.activeId,
    meta: store.meta,
    setMeta: store.setMeta,
    terminalIds: store.terminalIds,
    terminalLabel: store.terminalLabel,
  });

  const streams = useTerminalStreams({
    onExit: (id, code) => {
      const label = store.terminalLabel(id);
      toast(
        code === 0 ? `${label} exited` : `${label} exited with code ${code}`,
      );
      lifecycle.removeAndAutoSwitch(id);
    },
  });

  const lifecycle = useTerminalLifecycle({
    store,
    randomTheme: deps.randomTheme,
    subscribeExit: streams.subscribeExit,
    seedActivity,
    clearActivity,
  });

  return {
    terminalIds: store.terminalIds,
    activeId: store.activeId,
    setActiveId: store.setActiveId,
    getMeta: store.getMeta,
    getDisplayInfo: store.getDisplayInfo,
    getActivityHistory,
    setThemeName: lifecycle.setThemeName,
    activeMeta: store.activeMeta,
    isLoading: lifecycle.isLoading,
    handleCreate: lifecycle.handleCreate,
    handleCreateSubTerminal: lifecycle.handleCreateSubTerminal,
    handleKill: lifecycle.handleKill,
    getSubTerminalIds: store.getSubTerminalIds,
    reorderTerminals: (ids: TerminalId[]) => {
      store.setIdOrder(ids);
      lifecycle.reorderTerminals(ids);
    },
    mruOrder: store.mruOrder,
    handleCopyTerminalText: lifecycle.handleCopyTerminalText,
    handleCloseAll: lifecycle.handleCloseAll,
    handleCreateWorktree: lifecycle.handleCreateWorktree,
    handleKillWorktree: lifecycle.handleKillWorktree,
    savedSession: lifecycle.savedSession,
    handleRestoreSession: lifecycle.handleRestoreSession,
    simulateAlert: alerts.simulateAlert,
    // Exposed for TerminalLiveData (per-terminal live queries)
    setMeta: store.setMeta,
    pushActivity,
  };
}
