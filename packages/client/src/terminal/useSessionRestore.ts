/** Session restore — hydration from server state, session restore handler. */

import { createSignal, createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { useSubPanel } from "./useSubPanel";
import { useCanvasLayouts } from "./useCanvasLayouts";
import { useServerState } from "../settings/useServerState";
import { lifecycle } from "../rpc/rpc";
import type { TerminalId, TerminalInfo, SavedSession } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useSessionRestore(deps: {
  store: TerminalStore;
  subscribeExit: (id: TerminalId) => void;
  handleCreate: (cwd?: string, themeName?: string) => Promise<TerminalId>;
  handleCreateSubTerminal: (
    parentId: TerminalId,
    cwd?: string,
  ) => Promise<void>;
}) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const { setLayouts, reportLayout } = useCanvasLayouts();
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
    // Seed canvas layouts and sub-panel state from server metadata
    for (const t of existing) {
      if (t.meta.canvasLayout) {
        setLayouts(t.id, t.meta.canvasLayout);
      }
      if (t.meta.subPanel) {
        subPanel.seedPanel(t.id, t.meta.subPanel);
      }
    }

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

  // Re-fetch saved session when all terminals are killed mid-session,
  // OR when the server pushes a fresh saved-session value while we're
  // already showing the empty state.
  //
  // IMPORTANT: read `serverState.savedSession()` UNCONDITIONALLY so the
  // reactive tracker subscribes to it on the effect's first run. Reading
  // it inside the `if` body would skip tracking when the gate fails on
  // the first run (initial mount before `hydrated` flips), and subsequent
  // server pushes of a new saved-session would never re-fire this effect.
  // That was the source of the chronic session-restore flake (#320, #440):
  // when initial hydration raced with the snapshot, savedSession was set
  // to null on the first effect and the reactive recovery here was dead.
  //
  // Gated on lifecycle: on a genuine server restart, the dim overlay is
  // the authoritative rescue UI and the restore button shouldn't compete.
  createEffect(() => {
    if (lifecycle().kind === "restarted") return;
    const fromServer = serverState.savedSession();
    if (store.terminalIds().length === 0 && hydrated) {
      setSavedSession(fromServer);
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
      const bySortOrder = (
        a: { sortOrder?: number },
        b: { sortOrder?: number },
      ) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      const topLevel = session.terminals
        .filter((t) => !t.parentId)
        .sort(bySortOrder);
      const subTerminals = session.terminals
        .filter((t) => t.parentId)
        .sort(bySortOrder);
      for (const t of topLevel) {
        const newId = await deps.handleCreate(t.cwd, t.themeName);
        oldToNew.set(t.id, newId);
      }
      for (const t of subTerminals) {
        const newParentId = oldToNew.get(t.parentId!);
        if (newParentId) await deps.handleCreateSubTerminal(newParentId, t.cwd);
      }
      // Restore canvas layouts and sub-panel state under the new terminal IDs
      for (const t of session.terminals) {
        const newId = oldToNew.get(t.id);
        if (!newId) continue;
        if (t.canvasLayout) {
          setLayouts(newId, t.canvasLayout);
          reportLayout(newId);
        }
        if (t.subPanel) {
          subPanel.seedPanel(newId, t.subPanel);
        }
      }
      // Restore active terminal
      if (session.activeTerminalId) {
        const newActiveId = oldToNew.get(session.activeTerminalId);
        if (newActiveId) store.setActiveId(newActiveId);
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
