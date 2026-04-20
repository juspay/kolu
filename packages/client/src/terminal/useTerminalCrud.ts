/** Terminal CRUD — create, kill, close-all, theme, reorder, copy text.
 *
 *  Uses plain oRPC client calls. Server signals propagate list/metadata
 *  changes via the live subscriptions — no optimistic cache needed. */

import { toast } from "solid-sonner";
import { availableThemes, resolveThemeBgs, pickTheme } from "terminal-themes";
import { client } from "../rpc/rpc";
import { useSubPanel } from "./useSubPanel";
import { writeTextToClipboard } from "./clipboard";
import { useTips } from "../settings/useTips";
import { usePreferences } from "../settings/usePreferences";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import type {
  CanvasLayout,
  InitialTerminalMetadata,
  TerminalId,
} from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useTerminalCrud(deps: {
  store: TerminalStore;
  subscribeExit: (id: TerminalId) => void;
}) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const { showTipOnce } = useTips();
  const { preferences } = usePreferences();

  /** The terminal the user is currently interacting with —
   *  the active sub-tab when a split has focus, otherwise the workspace root. */
  function focusedTerminalId(): TerminalId | null {
    const parentId = store.activeId();
    if (parentId === null) return null;
    const panel = subPanel.getSubPanel(parentId);
    return !panel.collapsed && panel.focusTarget === "sub" && panel.activeSubTab
      ? panel.activeSubTab
      : parentId;
  }

  // --- Handlers ---

  /** Set a terminal's theme name on the server. */
  function setThemeName(id: TerminalId, name: string) {
    void client.terminal
      .setTheme({ id, themeName: name })
      .catch((err: Error) =>
        toast.error(`Failed to set theme: ${err.message}`),
      );
  }

  /** Reorder terminals on the server. */
  function reorderTerminals(ids: TerminalId[]) {
    void client.terminal
      .reorder({ ids })
      .catch((err: Error) =>
        toast.error(`Failed to reorder terminals: ${err.message}`),
      );
  }

  /** Persist a terminal's canvas tile position/size on the server. */
  function setCanvasLayout(id: TerminalId, layout: CanvasLayout) {
    void client.terminal
      .setCanvasLayout({ id, layout })
      .catch((err: Error) =>
        toast.error(`Failed to save canvas layout: ${err.message}`),
      );
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
      return;
    }

    // Top-level terminal — promote sub-terminals to top-level
    const orphanIds = store.getSubTerminalIds(id);
    for (const subId of orphanIds) {
      void client.terminal
        .setParent({ id: subId, parentId: null })
        .catch((err: Error) =>
          toast.error(`Failed to set parent: ${err.message}`),
        );
    }

    const ids = store.terminalIds();
    const idx = ids.indexOf(id);
    subPanel.removePanel(id);
    store.setMruOrder((prev) => prev.filter((x) => x !== id));
    if (store.activeId() === id) {
      const remaining = ids.filter((x) => x !== id);
      store.setActiveId(remaining[Math.min(idx, remaining.length - 1)] ?? null);
    }
  }

  /** Create a new terminal on the server and make it active.
   *  Returns the new terminal ID (for session restore mapping).
   *  `initial` carries client-owned metadata to seed atomically on the
   *  server — used by session restore so the first `terminal.list`
   *  yield already carries the saved theme / canvas layout / sub-panel
   *  state, closing the race with the canvas cascade effect (#642). */
  async function handleCreate(
    cwd?: string,
    initial?: InitialTerminalMetadata,
  ): Promise<TerminalId> {
    if (store.activeMeta()?.git) showTipOnce(CONTEXTUAL_TIPS.worktree);

    // Snapshot peer backgrounds BEFORE creating — the new terminal gets the
    // server's default theme for a frame, which we don't want scored as a
    // peer against itself.
    const peerBgs = preferences().shuffleTheme
      ? resolveThemeBgs(
          store.terminalIds(),
          (id) => store.getMetadata(id)?.themeName,
        )
      : null;
    const theme =
      initial?.themeName ??
      (peerBgs
        ? pickTheme(availableThemes, { spread: true, peerBgs })
        : undefined);
    const info = await client.terminal
      .create({
        cwd,
        themeName: theme,
        canvasLayout: initial?.canvasLayout,
        subPanel: initial?.subPanel,
      })
      .catch((err: Error) => {
        toast.error(`Failed to create terminal: ${err.message}`);
        throw err;
      });
    store.setActiveId(info.id);
    deps.subscribeExit(info.id);
    showTipOnce(CONTEXTUAL_TIPS.themeSwitch);
    return info.id;
  }

  async function handleCreateSubTerminal(parentId: TerminalId, cwd?: string) {
    const info = await client.terminal
      .create({ cwd, parentId })
      .catch((err: Error) => {
        toast.error(`Failed to create terminal: ${err.message}`);
        throw err;
      });
    subPanel.setActiveSubTab(parentId, info.id);
    subPanel.expandPanel(parentId);
    deps.subscribeExit(info.id);
  }

  async function handleKill(id: TerminalId) {
    try {
      await client.terminal.kill({ id });
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
    const id = focusedTerminalId();
    if (id === null) return;
    try {
      const text = await client.terminal.screenText({ id });
      await writeTextToClipboard(text);
      toast.success("Copied terminal text to clipboard");
    } catch (err) {
      console.error("Failed to copy terminal text:", err);
      toast.error(`Failed to copy terminal text: ${(err as Error).message}`);
    }
  }

  /** Write a command line into the active terminal WITHOUT pressing Enter.
   *  Used by the "Recent agents" palette entry to prefill a previously
   *  seen agent CLI — the user reviews/edits and hits Enter themselves.
   *  No-op if no terminal is active. */
  function handleRunInActiveTerminal(command: string) {
    const id = focusedTerminalId();
    if (id === null) return;
    void client.terminal
      .sendInput({ id, data: command })
      .catch((err: Error) =>
        toast.error(`Failed to prefill command: ${err.message}`),
      );
  }

  async function handleCloseAll() {
    try {
      await client.terminal.killAll();
      store.reset();
    } catch (err) {
      toast.error(`Failed to close all terminals: ${(err as Error).message}`);
    }
  }

  return {
    setThemeName,
    reorderTerminals,
    setCanvasLayout,
    removeAndAutoSwitch,
    handleCreate,
    handleCreateSubTerminal,
    handleKill,
    handleKillWithSubs,
    handleCopyTerminalText,
    handleRunInActiveTerminal,
    handleCloseAll,
  };
}
