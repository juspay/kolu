/** Terminal CRUD — create, kill, close-all, theme, reorder, copy text.
 *
 *  Mutations use optimistic cache writes on the live list query so the UI
 *  updates instantly. The server's live push arrives moments later and
 *  replaces with authoritative data. */

import type { Accessor } from "solid-js";
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { availableThemes } from "./theme";
import { client } from "./rpc";
import { orpc } from "./orpc";
import { useSubPanel } from "./useSubPanel";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";
import type { TerminalId, TerminalInfo, TerminalMetadata } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useTerminalCrud(deps: {
  store: TerminalStore;
  randomTheme: Accessor<boolean>;
  subscribeExit: (id: TerminalId) => void;
}) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const { showTipOnce } = useTips();
  const qc = useQueryClient();

  const listKey = orpc.terminal.list.key();

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
    onError: (err: Error) =>
      toast.error(`Failed to create terminal: ${err.message}`),
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

  // --- Optimistic list helpers ---

  function addToList(info: TerminalInfo) {
    qc.setQueryData(listKey, (old: TerminalInfo[] | undefined) => [
      ...(old ?? []),
      info,
    ]);
  }

  function removeFromList(id: TerminalId) {
    qc.setQueryData(listKey, (old: TerminalInfo[] | undefined) =>
      old ? old.filter((t) => t.id !== id) : old,
    );
  }

  // --- Handlers ---

  /** Set a terminal's theme name locally (optimistic) and on the server. */
  function setThemeName(id: TerminalId, name: string) {
    const key = orpc.terminal.onMetadataChange.key({ input: { id } });
    qc.setQueryData(key, (old: TerminalMetadata | undefined) =>
      old ? { ...old, themeName: name } : old,
    );
    setThemeMut.mutate({ id, themeName: name });
  }

  /** Optimistic reorder — write sortOrder values to TanStack cache, then mutate. */
  function reorderTerminals(ids: TerminalId[]) {
    const SORT_GAP = 1000;
    ids.forEach((id, i) => {
      const key = orpc.terminal.onMetadataChange.key({ input: { id } });
      qc.setQueryData(key, (old: TerminalMetadata | undefined) =>
        old ? { ...old, sortOrder: (i + 1) * SORT_GAP } : old,
      );
    });
    reorderMut.mutate({ ids });
  }

  /** Remove a terminal and auto-switch if it was active. */
  function removeAndAutoSwitch(id: TerminalId) {
    const parentId = store.getMetadata(id)?.parentId;

    if (parentId) {
      const subs = store.getSubTerminalIds(parentId).filter((x) => x !== id);
      if (subs.length === 0) {
        subPanel.collapsePanel(parentId);
      } else {
        const panel = subPanel.getSubPanel(parentId);
        if (panel.activeSubTab === id) {
          subPanel.setActiveSubTab(parentId, subs[0] ?? null);
        }
      }
      removeFromList(id);
      return;
    }

    // Top-level terminal — promote sub-terminals to top-level
    const orphanIds = store.getSubTerminalIds(id);
    for (const subId of orphanIds) {
      setParentMut.mutate({ id: subId, parentId: null });
    }

    const ids = store.terminalIds();
    const idx = ids.indexOf(id);
    removeFromList(id);
    subPanel.removePanel(id);
    store.setMruOrder((prev) => prev.filter((x) => x !== id));
    if (store.activeId() === id) {
      const remaining = ids.filter((x) => x !== id);
      store.setActiveId(remaining[Math.min(idx, remaining.length - 1)] ?? null);
    }
  }

  /** Create a new terminal on the server, add to list cache, and make it active.
   *  Returns the new terminal ID (for session restore mapping). */
  async function handleCreate(cwd?: string): Promise<TerminalId> {
    if (store.activeMeta()?.git) showTipOnce(CONTEXTUAL_TIPS.worktree);

    const info = await createMut.mutateAsync({ cwd });
    const themeName = deps.randomTheme()
      ? availableThemes[Math.floor(Math.random() * availableThemes.length)]!
          .name
      : undefined;
    addToList(info);
    store.setActiveId(info.id);
    deps.subscribeExit(info.id);
    if (themeName) setThemeName(info.id, themeName);
    return info.id;
  }

  async function handleCreateSubTerminal(parentId: TerminalId, cwd?: string) {
    const info = await createMut.mutateAsync({ cwd, parentId });
    addToList(info);
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

  /** Kill a terminal and all its sub-terminals (instead of promoting them). */
  async function handleKillWithSubs(id: TerminalId) {
    const subs = store.getSubTerminalIds(id);
    for (const subId of subs) await handleKill(subId);
    await handleKill(id);
  }

  async function handleCopyTerminalText() {
    const id = store.activeId();
    if (id === null) return;
    try {
      const text = await client.terminal.screenText({ id });
      await navigator.clipboard.writeText(text);
      toast.success("Copied terminal text to clipboard");
    } catch (err) {
      console.error("Failed to copy terminal text:", err);
      toast.error("Failed to copy terminal text");
    }
  }

  async function handleCloseAll() {
    await killAllMut.mutateAsync(undefined);
    qc.setQueryData(listKey, []);
    store.reset();
  }

  return {
    setThemeName,
    reorderTerminals,
    removeAndAutoSwitch,
    handleCreate,
    handleCreateSubTerminal,
    handleKill,
    handleKillWithSubs,
    handleCopyTerminalText,
    handleCloseAll,
  };
}
