/** Terminal lifecycle — CRUD orchestration, restore-on-load, worktree operations. */

import { type Accessor, createSignal, createEffect } from "solid-js";
import { createQuery, createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { availableThemes } from "./theme";
import { client } from "./rpc";
import { orpc } from "./orpc";
import { useSubPanel } from "./useSubPanel";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";
import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
  ActivitySample,
  SavedSession,
} from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";


export function useTerminalLifecycle(deps: {
  store: TerminalStore;
  randomTheme: Accessor<boolean>;
  subscribeExit: (id: TerminalId) => void;
  seedActivity: (id: TerminalId, history: ActivitySample[]) => void;
  clearActivity: (id: TerminalId) => void;
}) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const { showTipOnce } = useTips();
  const qc = useQueryClient();

  // --- Mutations ---

  const setThemeMut = createMutation(() => ({
    ...orpc.terminal.setTheme.mutationOptions(),
    onError: () => toast.error("Failed to set theme"),
  }));

  const setParentMut = createMutation(() => ({
    ...orpc.terminal.setParent.mutationOptions(),
    onError: () => toast.error("Failed to set parent"),
  }));

  const createMut = createMutation(() => ({
    ...orpc.terminal.create.mutationOptions(),
    onError: (err: Error) => toast.error(`Failed to create terminal: ${err.message}`),
  }));

  const killMut = createMutation(() => ({
    ...orpc.terminal.kill.mutationOptions(),
  }));

  const killAllMut = createMutation(() => ({
    ...orpc.terminal.killAll.mutationOptions(),
    onError: () => toast.error("Failed to close all terminals"),
  }));

  const reorderMut = createMutation(() => ({
    ...orpc.terminal.reorder.mutationOptions(),
    onError: () => toast.error("Failed to reorder terminals"),
  }));

  const worktreeCreateMut = createMutation(() => ({
    ...orpc.git.worktreeCreate.mutationOptions(),
    onError: (err: Error) => toast.error(`Failed to create worktree: ${err.message}`),
  }));

  const worktreeRemoveMut = createMutation(() => ({
    ...orpc.git.worktreeRemove.mutationOptions(),
    onError: (err: Error) => toast.error(`Failed to remove worktree: ${err.message}`),
  }));

  /** Set a terminal's theme name locally (optimistic) and on the server.
   *  themeName lives in TerminalMetadata — server publishes it back via live query. */
  function setThemeName(id: TerminalId, name: string) {
    // Optimistic update in TanStack cache
    const key = orpc.terminal.onMetadataChange.key({ input: { id } });
    qc.setQueryData(key, (old: TerminalMetadata | undefined) =>
      old ? { ...old, themeName: name } : old,
    );
    setThemeMut.mutate({ id, themeName: name });
  }

  /** Remove a terminal from the store and auto-switch if it was active. */
  function removeAndAutoSwitch(id: TerminalId) {
    const parentId = store.getMetadata(id)?.parentId;

    if (parentId) {
      // This is a sub-terminal — remove from parent's sub-order
      store.setSubOrder((prev) => {
        const subs = (prev[parentId] ?? []).filter((x) => x !== id);
        const next = { ...prev };
        if (subs.length === 0) {
          delete next[parentId];
          subPanel.collapsePanel(parentId);
        } else {
          next[parentId] = subs;
          // If this was the active sub-tab, switch to neighbor
          const panel = subPanel.getSubPanel(parentId);
          if (panel.activeSubTab === id) {
            subPanel.setActiveSubTab(parentId, subs[0] ?? null);
          }
        }
        return next;
      });
      return;
    }

    // Top-level terminal — promote any sub-terminals to top-level (orphans)
    const orphanIds = store.getSubTerminalIds(id);
    for (const subId of orphanIds) {
      setParentMut.mutate({ id: subId, parentId: null });
    }

    const ids = store.idOrder();
    const idx = ids.indexOf(id);
    if (idx === -1) return;
    const remaining = ids.filter((x) => x !== id);
    // Insert orphans at the position of the killed parent
    remaining.splice(idx, 0, ...orphanIds);
    store.setIdOrder(remaining);
    subPanel.removePanel(id);
    store.setSubOrder((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    deps.clearActivity(id);
    store.setMruOrder((prev) => prev.filter((x) => x !== id));
    if (store.activeId() === id) {
      store.setActiveId(remaining[Math.min(idx, remaining.length - 1)] ?? null);
    }
  }

  // --- Queries ---

  const terminalsQuery = createQuery(() => orpc.terminal.list.queryOptions());
  const sessionQuery = createQuery(() => orpc.session.get.queryOptions());

  // Saved session — populated when no running terminals exist, shown in EmptyState.
  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );

  // Hydrate store from server state on initial load.
  // Both queries must resolve before we can decide what to show.
  let hydrated = false;
  createEffect(() => {
    const existing = terminalsQuery.data;
    const session = sessionQuery.data;
    // Wait for both queries to have fetched at least once
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
    // Partition into top-level and sub-terminals (parentId now in metadata)
    const topLevel: TerminalId[] = [];
    const subs: Record<TerminalId, TerminalId[]> = {};
    for (const t of existing) {
      if (t.meta?.parentId) {
        (subs[t.meta.parentId] ??= []).push(t.id);
      } else {
        topLevel.push(t.id);
      }
    }
    store.setIdOrder(topLevel);
    store.setSubOrder(subs);

    // Initialize sub-panel active tabs for parents that have sub-terminals
    for (const [parentId, subIds] of Object.entries(subs)) {
      const panel = subPanel.getSubPanel(parentId);
      if (!panel.activeSubTab || !subIds.includes(panel.activeSubTab)) {
        subPanel.setActiveSubTab(parentId, subIds[0] ?? null);
      }
    }

    // Keep persisted active terminal if it still exists; otherwise pick first
    const persisted = store.activeId();
    const ids = store.idOrder();
    if (persisted === null || !ids.includes(persisted)) {
      store.setActiveId(ids[0] ?? null);
    }

    // Seed MRU with all top-level terminals (active first, rest in sidebar order).
    const active = store.activeId();
    store.setMruOrder(
      active ? [active, ...ids.filter((x) => x !== active)] : ids,
    );

    // Seed activity history from server (late-joining clients get full sparkline)
    for (const t of existing) {
      if (t.activityHistory?.length) {
        deps.seedActivity(t.id, t.activityHistory);
      }
    }

    // Subscribe to exit events for all terminals
    for (const t of existing) deps.subscribeExit(t.id);
  }

  // Re-fetch saved session when all terminals are killed mid-session.
  createEffect(() => {
    if (store.terminalIds().length === 0 && hydrated) {
      client.session.get().then(setSavedSession);
    }
  });

  /** Restore a saved session — creates terminals with saved CWDs and parent relationships. */
  async function handleRestoreSession() {
    const session = savedSession();
    if (!session) return;
    setSavedSession(null);
    // Map saved terminal ID → new live terminal ID
    const oldToNew = new Map<string, TerminalId>();
    // Create top-level terminals first, then sub-terminals
    const topLevel = session.terminals.filter((t) => !t.parentId);
    const subs = session.terminals.filter((t) => t.parentId);
    for (const t of topLevel) {
      await handleCreate(t.cwd);
      const newId = store.idOrder()[store.idOrder().length - 1]!;
      oldToNew.set(t.id, newId);
    }
    for (const t of subs) {
      const newParentId = oldToNew.get(t.parentId!);
      if (newParentId) await handleCreateSubTerminal(newParentId, t.cwd);
    }
  }

  /** Create a new terminal on the server, add it to the list, and make it active. */
  async function handleCreate(cwd?: string) {
    // Show worktree tip when creating a terminal while in a git repo
    if (store.activeMeta()?.git) showTipOnce(CONTEXTUAL_TIPS.worktree);

    const info = await createMut.mutateAsync({ cwd });
    const themeName = deps.randomTheme()
      ? availableThemes[Math.floor(Math.random() * availableThemes.length)]!
          .name
      : undefined;
    store.setIdOrder((prev) => [...prev, info.id]);
    store.setActiveId(info.id);
    deps.subscribeExit(info.id);
    if (themeName) setThemeName(info.id, themeName);
  }

  /** Create a sub-terminal under a parent. */
  async function handleCreateSubTerminal(parentId: TerminalId, cwd?: string) {
    const info = await createMut.mutateAsync({ cwd, parentId });
    store.setSubOrder((prev) => ({
      ...prev,
      [parentId]: [...(prev[parentId] ?? []), info.id],
    }));
    subPanel.setActiveSubTab(parentId, info.id);
    subPanel.expandPanel(parentId);
    deps.subscribeExit(info.id);
  }

  /** Kill a terminal on the server, then remove + auto-switch locally. */
  async function handleKill(id: TerminalId) {
    try {
      await killMut.mutateAsync({ id });
    } catch {
      // Terminal may already be gone
    }
    removeAndAutoSwitch(id);
  }

  /** Create a git worktree and open a terminal in it. */
  async function handleCreateWorktree(repoPath: string) {
    const result = await worktreeCreateMut.mutateAsync({ repoPath });
    toast(`Created worktree at ${result.path}`);
    await handleCreate(result.path);
    void qc.invalidateQueries({ queryKey: orpc.git.recentRepos.key() });
  }

  /** Kill the active terminal (and sub-terminals) and remove its worktree. */
  async function handleKillWorktree() {
    const id = store.activeId();
    if (!id) return;
    const meta = store.activeMeta();
    const worktreePath = meta?.git?.isWorktree ? meta.git.worktreePath : null;
    const subs = store.getSubTerminalIds(id);
    for (const subId of subs) await handleKill(subId);
    await handleKill(id);
    if (worktreePath) {
      await worktreeRemoveMut.mutateAsync({ worktreePath });
      toast(`Removed worktree at ${worktreePath}`);
      void qc.invalidateQueries({ queryKey: orpc.git.recentRepos.key() });
    }
  }

  /** Copy the active terminal's buffer as plain text to the clipboard. */
  async function handleCopyTerminalText() {
    const id = store.activeId();
    if (id === null) return;
    try {
      const text = await client.terminal.screenText({ id });
      await navigator.clipboard.writeText(text);
      toast("Copied terminal text to clipboard");
    } catch (err) {
      console.error("Failed to copy terminal text:", err);
      toast.error("Failed to copy terminal text");
    }
  }

  /** Close all terminals without clearing the saved session (debug command). */
  async function handleCloseAll() {
    await killAllMut.mutateAsync(undefined);
    store.reset();
  }

  return {
    /** True while the initial terminal list is loading. */
    isLoading: () => terminalsQuery.isLoading,
    savedSession,
    handleRestoreSession,
    setThemeName,
    handleCreate,
    handleCreateSubTerminal,
    handleKill,
    handleCloseAll,
    handleCreateWorktree,
    handleKillWorktree,
    handleCopyTerminalText,
    removeAndAutoSwitch,
    reorderTerminals: (ids: TerminalId[]) => reorderMut.mutate({ ids }),
  };
}
