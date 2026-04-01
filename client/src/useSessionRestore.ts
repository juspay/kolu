/** Session restore — hydration from server state, session restore handler. */

import { createSignal, createEffect } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { client } from "./rpc";
import { orpc } from "./orpc";
import { useTerminalPanel } from "./useTerminalPanel";
import type { TerminalId, TerminalInfo, SavedSession } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useSessionRestore(deps: {
  store: TerminalStore;
  subscribeExit: (id: TerminalId) => void;
  handleCreate: (cwd?: string) => Promise<TerminalId>;
  handleCreateTerminal: (
    workspaceId: TerminalId,
    cwd?: string,
  ) => Promise<void>;
}) {
  const { store } = deps;
  const terminalPanel = useTerminalPanel();

  const sessionQuery = createQuery(() => orpc.session.get.queryOptions());

  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );

  // Hydrate from server state on initial load.
  let hydrated = false;
  createEffect(() => {
    const existing = store.listQuery.data;
    const session = sessionQuery.data;
    if (existing === undefined || session === undefined) return;
    if (hydrated) return;
    hydrated = true;
    if (existing.length === 0) {
      setSavedSession(session);
      return;
    }
    hydrateFromTerminals(existing);
  });

  function hydrateFromTerminals(existing: TerminalInfo[]) {
    // Initialize terminal panel active tabs for workspaces with terminals
    const terminals: Record<TerminalId, TerminalId[]> = {};
    for (const t of existing) {
      if (t.meta.parentId) {
        (terminals[t.meta.parentId] ??= []).push(t.id);
      }
    }
    for (const [workspaceId, termIds] of Object.entries(terminals)) {
      const panel = terminalPanel.getSubPanel(workspaceId);
      if (!panel.activeSubTab || !termIds.includes(panel.activeSubTab)) {
        terminalPanel.setActiveSubTab(workspaceId, termIds[0] ?? null);
      }
    }

    // Keep persisted active workspace if it still exists; otherwise pick first
    const persisted = store.activeId();
    const topLevel = existing
      .filter((t) => !t.meta.parentId)
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
    const topIds = topLevel.map((t) => t.id);
    if (persisted === null || !topIds.includes(persisted)) {
      store.setActiveId(topIds[0] ?? null);
    }

    // Seed MRU with all top-level workspaces (active first, rest in sidebar order).
    const active = store.activeId();
    store.setMruOrder(
      active ? [active, ...topIds.filter((x) => x !== active)] : topIds,
    );

    for (const t of existing) deps.subscribeExit(t.id);
  }

  // Re-fetch saved session when all workspaces are closed mid-session.
  createEffect(() => {
    if (store.workspaceIds().length === 0 && hydrated) {
      client.session.get().then(setSavedSession);
    }
  });

  async function handleRestoreSession() {
    const session = savedSession();
    if (!session) return;
    setSavedSession(null);
    const oldToNew = new Map<string, TerminalId>();
    const workspaces = session.terminals.filter((t) => !t.parentId);
    const terminals = session.terminals.filter((t) => t.parentId);
    for (const t of workspaces) {
      const newId = await deps.handleCreate(t.cwd);
      oldToNew.set(t.id, newId);
    }
    for (const t of terminals) {
      const newWorkspaceId = oldToNew.get(t.parentId!);
      if (newWorkspaceId)
        await deps.handleCreateTerminal(newWorkspaceId, t.cwd);
    }
  }

  return {
    isLoading: () => store.listQuery.isLoading,
    savedSession,
    handleRestoreSession,
  };
}
