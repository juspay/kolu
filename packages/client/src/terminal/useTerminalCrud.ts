/** Terminal CRUD — create, kill, close-all, theme, reorder, copy text.
 *
 *  Uses plain oRPC client calls. Server signals propagate list/metadata
 *  changes via the live subscriptions — no optimistic cache needed.
 *
 *  The server prunes any panel-tab references to a killed terminal across
 *  the surviving fleet, so the client doesn't have to walk every other
 *  tile's `panels` itself when a terminal goes away — `setTerminalPanels`
 *  republishes the affected metadata. */

import { toast } from "solid-sonner";
import { availableThemes, resolveThemeBgs, pickTheme } from "terminal-themes";
import { client } from "../rpc/rpc";
import { useTerminalPanels } from "./useTerminalPanels";
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
  const panels = useTerminalPanels();
  const { showTipOnce } = useTips();
  const { preferences } = usePreferences();

  /** The terminal the user is currently interacting with — if a non-main
   *  panel slot has focus and its active tab is a terminal, that's the one;
   *  otherwise the active tile itself. */
  function focusedTerminalId(): TerminalId | null {
    const tileId = store.activeId();
    if (tileId === null) return null;
    const focus = panels.getFocusEdge(tileId);
    if (focus === "main") return tileId;
    const slot = panels.getSlot(tileId, focus);
    if (!slot) return tileId;
    const active = slot.tabs[slot.active];
    return active && active.kind === "terminal" ? active.id : tileId;
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

  /** Remove a terminal and auto-switch if it was active. The server-side
   *  `pruneTerminalReferencesFromPanels` already drops any tabs referencing
   *  the dead id from other tiles' `panels`, so the client only needs to
   *  promote orphan sub-terminals (if any) and update view-state. */
  function removeAndAutoSwitch(id: TerminalId) {
    const parentId = store.getMetadata(id)?.parentId;
    if (parentId) {
      // Sub-terminals don't carry their own `panels` slots in v1, but a
      // future kind=terminal-with-its-own-panels would need a cleanup hook
      // here. Today: just drop client-side runtime state.
      panels.removeTerminalRuntime(id);
      return;
    }

    // Top-level terminal — promote sub-terminals to top-level so the user
    // doesn't lose access to them.
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
    panels.removeTerminalRuntime(id);
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
   *  yield already carries the saved theme / canvas layout / panels state,
   *  closing the race with the canvas cascade effect (#642). */
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
        panels: initial?.panels,
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

  /** Create a sub-terminal under `parentId`. Returns the new id; caller
   *  decides what to do with it (typically: add it as a tab in the parent's
   *  bottom panel via `useTerminalPanels.addTab`). Returns `null` on error
   *  so callers can chain `.catch(() => null)` against the rejection. */
  async function handleCreateSubTerminal(
    parentId: TerminalId,
    cwd?: string,
  ): Promise<TerminalId> {
    const info = await client.terminal
      .create({ cwd, parentId })
      .catch((err: Error) => {
        toast.error(`Failed to create terminal: ${err.message}`);
        throw err;
      });
    deps.subscribeExit(info.id);
    return info.id;
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
