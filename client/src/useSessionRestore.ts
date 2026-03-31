/** Session restore — queries, hydration from server state, session restore handler. */

import { createSignal, createEffect } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { client } from "./rpc";
import { orpc } from "./orpc";
import { useSubPanel } from "./useSubPanel";
import type { TerminalId, TerminalInfo, SavedSession } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useSessionRestore(deps: {
  store: TerminalStore;
  subscribeExit: (id: TerminalId) => void;
  handleCreate: (cwd?: string) => Promise<void>;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => Promise<void>;
}) {
  const { store } = deps;
  const subPanel = useSubPanel();

  const terminalsQuery = createQuery(() => orpc.terminal.list.queryOptions());
  const sessionQuery = createQuery(() => orpc.session.get.queryOptions());

  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(null);

  // Hydrate from server state on initial load.
  let hydrated = false;
  createEffect(() => {
    const existing = terminalsQuery.data;
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
    store.setKnownIds(existing.map((t) => t.id));

    // Initialize sub-panel active tabs for parents with sub-terminals
    const subs: Record<TerminalId, TerminalId[]> = {};
    for (const t of existing) {
      if (t.meta.parentId) {
        (subs[t.meta.parentId] ??= []).push(t.id);
      }
    }
    for (const [parentId, subIds] of Object.entries(subs)) {
      const panel = subPanel.getSubPanel(parentId);
      if (!panel.activeSubTab || !subIds.includes(panel.activeSubTab)) {
        subPanel.setActiveSubTab(parentId, subIds[0] ?? null);
      }
    }

    // Keep persisted active terminal if it still exists; otherwise pick first
    const persisted = store.activeId();
    const topLevel = existing.filter((t) => !t.meta.parentId).sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
    const topIds = topLevel.map((t) => t.id);
    if (persisted === null || !topIds.includes(persisted)) {
      store.setActiveId(topIds[0] ?? null);
    }

    // Seed MRU with all top-level terminals (active first, rest in sidebar order).
    const active = store.activeId();
    store.setMruOrder(
      active ? [active, ...topIds.filter((x) => x !== active)] : topIds,
    );

    for (const t of existing) deps.subscribeExit(t.id);
  }

  // Re-fetch saved session when all terminals are killed mid-session.
  createEffect(() => {
    if (store.terminalIds().length === 0 && hydrated) {
      client.session.get().then(setSavedSession);
    }
  });

  async function handleRestoreSession() {
    const session = savedSession();
    if (!session) return;
    setSavedSession(null);
    const oldToNew = new Map<string, TerminalId>();
    const topLevel = session.terminals.filter((t) => !t.parentId);
    const subTerminals = session.terminals.filter((t) => t.parentId);
    for (const t of topLevel) {
      await deps.handleCreate(t.cwd);
      const ids = store.knownIds();
      oldToNew.set(t.id, ids[ids.length - 1]!);
    }
    for (const t of subTerminals) {
      const newParentId = oldToNew.get(t.parentId!);
      if (newParentId) await deps.handleCreateSubTerminal(newParentId, t.cwd);
    }
  }

  return {
    isLoading: () => terminalsQuery.isLoading,
    savedSession,
    handleRestoreSession,
  };
}
