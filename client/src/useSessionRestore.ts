/** Session restore — hydration from server state, session restore handler. */

import { createSignal, createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { useSubPanel } from "./useSubPanel";
import { useServerState } from "./useServerState";
import type { TerminalId, TerminalInfo, SavedSession } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useSessionRestore(deps: {
  store: TerminalStore;
  subscribeExit: (id: TerminalId) => void;
  handleCreate: (cwd?: string) => Promise<TerminalId>;
  handleCreateSubTerminal: (
    parentId: TerminalId,
    cwd?: string,
  ) => Promise<void>;
}) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const serverState = useServerState();

  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );

  // Hydrate from server state on initial load.
  let hydrated = false;
  createEffect(() => {
    const existing = store.listSub();
    const state = serverState.state();
    if (existing === undefined || state === undefined) return;
    if (hydrated) return;
    hydrated = true;
    if (existing.length === 0) {
      setSavedSession(state.session);
      return;
    }
    hydrateFromTerminals(existing);
  });

  function hydrateFromTerminals(existing: TerminalInfo[]) {
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
    const topLevel = existing
      .filter((t) => !t.meta.parentId)
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
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
  // The subscription keeps state fresh — just read from it.
  createEffect(() => {
    if (store.terminalIds().length === 0 && hydrated) {
      setSavedSession(serverState.savedSession());
    }
  });

  async function handleRestoreSession() {
    const session = savedSession();
    if (!session) return;
    setSavedSession(null);
    const id = toast.loading(
      `Restoring ${session.terminals.length} terminals…`,
    );
    try {
      const oldToNew = new Map<string, TerminalId>();
      const topLevel = session.terminals.filter((t) => !t.parentId);
      const subTerminals = session.terminals.filter((t) => t.parentId);
      for (const t of topLevel) {
        const newId = await deps.handleCreate(t.cwd);
        oldToNew.set(t.id, newId);
      }
      for (const t of subTerminals) {
        const newParentId = oldToNew.get(t.parentId!);
        if (newParentId) await deps.handleCreateSubTerminal(newParentId, t.cwd);
      }
      toast.success("Session restored", { id });
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`, { id });
      throw err;
    }
  }

  return {
    isLoading: () => store.listSub.pending(),
    savedSession,
    handleRestoreSession,
  };
}
