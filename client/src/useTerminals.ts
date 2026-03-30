/** Terminal session state — thin composition shell.
 *
 *  ARCHITECTURE: This file wires together focused modules:
 *    - useTerminalStore.ts  — TanStack live queries + client view state
 *    - useTerminalLifecycle.ts — CRUD, restore-on-load, worktree ops
 *    - useTerminalAlerts.ts — Claude state detection (watches TanStack metadata)
 *  New features should go in the appropriate module (or a new one),
 *  not back into this composition root. See #221. */

import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common";
import { client } from "./rpc";
import { useTerminalStore } from "./useTerminalStore";
import { useTerminalLifecycle } from "./useTerminalLifecycle";
import { useTerminalAlerts } from "./useTerminalAlerts";

export function useTerminals(deps: {
  randomTheme: Accessor<boolean>;
  activityAlerts: Accessor<boolean>;
}) {
  const store = useTerminalStore();

  const alerts = useTerminalAlerts({
    activityAlerts: deps.activityAlerts,
    activeId: store.activeId,
    getMetadata: store.getMetadata,
    markAttention: store.markAttention,
    terminalIds: store.terminalIds,
    terminalLabel: store.terminalLabel,
  });

  /** Subscribe to exit events for a terminal (one-shot action, not queryable state). */
  function subscribeExit(id: TerminalId) {
    (async () => {
      try {
        const stream = await client.terminal.onExit({ id });
        for await (const code of stream) {
          const label = store.terminalLabel(id);
          toast(
            code === 0
              ? `${label} exited`
              : `${label} exited with code ${code}`,
          );
          lifecycle.removeAndAutoSwitch(id);
        }
      } catch {
        // Stream aborted or terminal gone — expected on cleanup
      }
    })();
  }

  const lifecycle = useTerminalLifecycle({
    store,
    randomTheme: deps.randomTheme,
    subscribeExit,
  });

  return {
    terminalIds: store.terminalIds,
    activeId: store.activeId,
    setActiveId: store.setActiveId,
    getMetadata: store.getMetadata,
    needsAttention: store.needsAttention,
    getDisplayInfo: store.getDisplayInfo,
    getActivityHistory: store.getActivityHistory,
    setThemeName: lifecycle.setThemeName,
    activeMeta: store.activeMeta,
    isLoading: lifecycle.isLoading,
    handleCreate: lifecycle.handleCreate,
    handleCreateSubTerminal: lifecycle.handleCreateSubTerminal,
    handleKill: lifecycle.handleKill,
    getSubTerminalIds: store.getSubTerminalIds,
    reorderTerminals: lifecycle.reorderTerminals,
    mruOrder: store.mruOrder,
    handleCopyTerminalText: lifecycle.handleCopyTerminalText,
    handleCloseAll: lifecycle.handleCloseAll,
    handleCreateWorktree: lifecycle.handleCreateWorktree,
    handleKillWorktree: lifecycle.handleKillWorktree,
    savedSession: lifecycle.savedSession,
    handleRestoreSession: lifecycle.handleRestoreSession,
    simulateAlert: alerts.simulateAlert,
  };
}
