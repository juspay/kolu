/** Terminal lifecycle — CRUD orchestration, restore-on-load, worktree operations. */

import { type Accessor, createResource, createSignal, createEffect } from "solid-js";
import { produce, reconcile } from "solid-js/store";
import { toast } from "solid-sonner";
import { availableThemes } from "./theme";
import { client } from "./rpc";
import { useSubPanel } from "./useSubPanel";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";
import type {
  TerminalId,
  TerminalInfo,
  ActivitySample,
  SavedSession,
} from "kolu-common";
import type { TerminalMetaStore, TerminalStore } from "./useTerminalStore";

export function useTerminalLifecycle(deps: {
  store: TerminalStore;
  randomTheme: Accessor<boolean>;
  subscribeAll: (id: TerminalId) => void;
  seedActivity: (id: TerminalId, history: ActivitySample[]) => void;
  clearActivity: (id: TerminalId) => void;
}) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const { showTipOnce } = useTips();

  /** Set a terminal's theme name locally and on the server. */
  function setThemeName(id: TerminalId, name: string) {
    store.setMeta(id, "themeName", name);
    void client.terminal.setTheme({ id, themeName: name });
  }

  /** Remove a terminal from the store and auto-switch if it was active. */
  function removeAndAutoSwitch(id: TerminalId) {
    const parentId = store.meta[id]?.parentId;

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
      store.setMeta(produce((s: TerminalMetaStore) => delete s[id]));
      return;
    }

    // Top-level terminal — promote any sub-terminals to top-level (orphans)
    const orphanIds = store.getSubTerminalIds(id);
    for (const subId of orphanIds) {
      store.setMeta(subId, "parentId", undefined);
      void client.terminal.setParent({ id: subId, parentId: null });
    }

    const ids = store.idOrder();
    const idx = ids.indexOf(id);
    if (idx === -1) return;
    const remaining = ids.filter((x) => x !== id);
    // Insert orphans at the position of the killed parent
    remaining.splice(idx, 0, ...orphanIds);
    store.setIdOrder(remaining);
    store.setMeta(produce((s: TerminalMetaStore) => delete s[id]));
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

  // Saved session — populated when no running terminals exist, shown in EmptyState.
  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );

  // Restore existing terminals on page load (e.g. after browser refresh).
  const [existingTerminals] = createResource<TerminalInfo[]>(async () => {
    const existing = await client.terminal.list();
    if (existing.length > 0) {
      // Build initial metadata store from server state (preserving server order)
      const initial: TerminalMetaStore = {};
      for (const t of existing) initial[t.id] = store.infoToState(t);
      store.setMeta(reconcile(initial));

      // Partition into top-level and sub-terminals
      const topLevel: TerminalId[] = [];
      const subs: Record<TerminalId, TerminalId[]> = {};
      for (const t of existing) {
        if (t.parentId) {
          (subs[t.parentId] ??= []).push(t.id);
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

      // Subscribe to live updates for all terminals
      for (const t of existing) deps.subscribeAll(t.id);
    }
    return existing;
  });

  // Single reactive rule: fetch saved session whenever terminal count hits zero.
  // Covers both initial load (no terminals on server) and mid-session (user killed all).
  // TODO: Replace with reactive server stream (https://github.com/juspay/kolu/issues/229)
  createEffect(() => {
    if (store.terminalIds().length === 0 && existingTerminals.state === "ready") {
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
      const ids = store.idOrder();
      oldToNew.set(t.id, ids[ids.length - 1]!);
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

    const info = await client.terminal.create({ cwd });
    const themeName = deps.randomTheme()
      ? availableThemes[Math.floor(Math.random() * availableThemes.length)]!
          .name
      : undefined;
    store.setMeta(info.id, {
      ...store.infoToState(info),
      ...(themeName && { themeName }),
    });
    store.setIdOrder((prev) => [...prev, info.id]);
    store.setActiveId(info.id);
    deps.subscribeAll(info.id);
    if (themeName) setThemeName(info.id, themeName);
  }

  /** Create a sub-terminal under a parent. */
  async function handleCreateSubTerminal(parentId: TerminalId, cwd?: string) {
    const info = await client.terminal.create({ cwd, parentId });
    store.setMeta(info.id, store.infoToState(info));
    store.setSubOrder((prev) => ({
      ...prev,
      [parentId]: [...(prev[parentId] ?? []), info.id],
    }));
    subPanel.setActiveSubTab(parentId, info.id);
    subPanel.expandPanel(parentId);
    deps.subscribeAll(info.id);
  }

  /** Kill a terminal on the server, then remove + auto-switch locally. */
  async function handleKill(id: TerminalId) {
    try {
      await client.terminal.kill({ id });
    } catch {
      // Terminal may already be gone
    }
    removeAndAutoSwitch(id);
  }

  /** Create a git worktree and open a terminal in it. */
  async function handleCreateWorktree(repoPath: string) {
    const result = await client.git.worktreeCreate({ repoPath });
    toast(`Created worktree at ${result.path}`);
    await handleCreate(result.path);
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
      await client.git.worktreeRemove({ worktreePath });
      toast(`Removed worktree at ${worktreePath}`);
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

  /** Kill all terminals (debug command). */
  async function handleCloseAll() {
    const ids = [...store.idOrder()];
    for (const id of ids) {
      const subs = store.getSubTerminalIds(id);
      for (const subId of subs) await handleKill(subId);
      await handleKill(id);
    }
  }

  return {
    existingTerminals,
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
  };
}
