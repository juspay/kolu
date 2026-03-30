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

  /** Optimistic reorder — write sortOrder values to TanStack cache, then mutate. */
  function reorderTerminals(ids: TerminalId[]) {
    const SORT_GAP = 1000;
    for (let i = 0; i < ids.length; i++) {
      const key = orpc.terminal.onMetadataChange.key({ input: { id: ids[i]! } });
      qc.setQueryData(key, (old: TerminalMetadata | undefined) =>
        old ? { ...old, sortOrder: (i + 1) * SORT_GAP } : old,
      );
    }
    reorderMut.mutate({ ids });
  }

  /** Remove a terminal and auto-switch if it was active. */
  function removeAndAutoSwitch(id: TerminalId) {
    const parentId = store.getMetadata(id)?.parentId;

    if (parentId) {
      // This is a sub-terminal — remove from parent's sub-order
      const subs = store.getSubTerminalIds(parentId).filter((x) => x !== id);
      if (subs.length === 0) {
        subPanel.collapsePanel(parentId);
      } else {
        // If this was the active sub-tab, switch to neighbor
        const panel = subPanel.getSubPanel(parentId);
        if (panel.activeSubTab === id) {
          subPanel.setActiveSubTab(parentId, subs[0] ?? null);
        }
      }
      store.removeKnownId(id);
      return;
    }

    // Top-level terminal — promote any sub-terminals to top-level (orphans)
    const orphanIds = store.getSubTerminalIds(id);
    for (const subId of orphanIds) {
      setParentMut.mutate({ id: subId, parentId: null });
    }

    // Insert orphans at the position of the killed parent (server handles sortOrder via setParent)
    const ids = store.terminalIds();
    const idx = ids.indexOf(id);
    store.removeKnownId(id);
    subPanel.removePanel(id);
    deps.clearActivity(id);
    store.setMruOrder((prev) => prev.filter((x) => x !== id));
    if (store.activeId() === id) {
      const remaining = ids.filter((x) => x !== id);
      store.setActiveId(remaining[Math.min(idx, remaining.length - 1)] ?? null);
    }
  }

  // --- Queries ---

  const terminalsQuery = createQuery(() => orpc.terminal.list.queryOptions());
  const sessionQuery = createQuery(() => orpc.session.get.queryOptions());

  // Saved session — populated when no running terminals exist, shown in EmptyState.
  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(null);

  // Hydrate from server state on initial load.
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
    // Set known IDs — order is derived from metadata sortOrder by useTerminalMetadata
    store.setKnownIds(existing.map((t) => t.id));

    // Initialize sub-panel active tabs for parents that have sub-terminals
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
      const ids = store.knownIds();
      oldToNew.set(t.id, ids[ids.length - 1]!);
    }
    for (const t of subs) {
      const newParentId = oldToNew.get(t.parentId!);
      if (newParentId) await handleCreateSubTerminal(newParentId, t.cwd);
    }
  }

  /** Create a new terminal on the server, add to known IDs, and make it active. */
  async function handleCreate(cwd?: string) {
    // Show worktree tip when creating a terminal while in a git repo
    if (store.activeMeta()?.git) showTipOnce(CONTEXTUAL_TIPS.worktree);

    const info = await createMut.mutateAsync({ cwd });
    const themeName = deps.randomTheme()
      ? availableThemes[Math.floor(Math.random() * availableThemes.length)]!.name
      : undefined;
    store.addKnownId(info.id);
    store.setActiveId(info.id);
    deps.subscribeExit(info.id);
    if (themeName) setThemeName(info.id, themeName);
  }

  async function handleCreateSubTerminal(parentId: TerminalId, cwd?: string) {
    const info = await createMut.mutateAsync({ cwd, parentId });
    store.addKnownId(info.id);
    subPanel.setActiveSubTab(parentId, info.id);
    subPanel.expandPanel(parentId);
    deps.subscribeExit(info.id);
  }

  async function handleKill(id: TerminalId) {
    try {
      await killMut.mutateAsync({ id });
    } catch {
      // Terminal may already be gone
    }
    removeAndAutoSwitch(id);
  }

  async function handleCreateWorktree(repoPath: string) {
    const result = await worktreeCreateMut.mutateAsync({ repoPath });
    toast(`Created worktree at ${result.path}`);
    await handleCreate(result.path);
    void qc.invalidateQueries({ queryKey: orpc.git.recentRepos.key() });
  }

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

  async function handleCloseAll() {
    await killAllMut.mutateAsync(undefined);
    store.reset();
  }

  return {
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
    reorderTerminals,
  };
}
