/** Terminal session state — thin composition shell.
 *
 *  ARCHITECTURE: This file wires together four focused modules via deps objects.
 *  Do NOT add behavior here — each concern has its own module:
 *    - useTerminalStore.ts  — store, signals, accessors (pure state)
 *    - useTerminalStreams.ts — server event subscriptions
 *    - useTerminalLifecycle.ts — CRUD, restore-on-load, worktree ops
 *    - useTerminalAlerts.ts — Claude state detection + notifications
 *  New features should go in the appropriate module (or a new one),
 *  not back into this composition root. See #221. */

import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import { createMutation } from "@tanstack/solid-query";
import { orpc } from "./queryClient";
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
  const reorderMut = createMutation(() =>
    orpc.terminal.reorder.mutationOptions(),
  );

  const alerts = useTerminalAlerts({
    activityAlerts: deps.activityAlerts,
    activeId: store.activeId,
    setMeta: store.setMeta,
    terminalIds: store.terminalIds,
    terminalLabel: store.terminalLabel,
  });

  const streams = useTerminalStreams({
    meta: store.meta,
    setMeta: store.setMeta,
    pushActivity,
    onExit: (id, code) => {
      const label = store.terminalLabel(id);
      toast(
        code === 0 ? `${label} exited` : `${label} exited with code ${code}`,
      );
      lifecycle.removeAndAutoSwitch(id);
    },
    onClaudeStateChange: alerts.checkClaudeFinished,
  });

  const lifecycle = useTerminalLifecycle({
    store,
    randomTheme: deps.randomTheme,
    subscribeAll: streams.subscribeAll,
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
    existingTerminals: lifecycle.existingTerminals,
    handleCreate: lifecycle.handleCreate,
    handleCreateSubTerminal: lifecycle.handleCreateSubTerminal,
    handleKill: lifecycle.handleKill,
    getSubTerminalIds: store.getSubTerminalIds,
    reorderTerminals: (ids: TerminalId[]) => {
      store.setIdOrder(ids);
      reorderMut.mutate({ ids });
    },
    mruOrder: store.mruOrder,
    handleCopyTerminalText: lifecycle.handleCopyTerminalText,
    handleCreateWorktree: lifecycle.handleCreateWorktree,
    handleKillWorktree: lifecycle.handleKillWorktree,
    simulateAlert: alerts.simulateAlert,
  };
}
