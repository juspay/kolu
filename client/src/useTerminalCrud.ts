/** Terminal CRUD — create, kill, close-all, theme, reorder, copy text.
 *
 *  Uses plain oRPC client calls. Server signals propagate list/metadata
 *  changes via the live subscriptions — no optimistic cache needed. */

import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import { availableThemes, FONT_FAMILY } from "./theme";
import { client } from "./rpc";
import { getTerminalRefs } from "./terminalRefs";
import { useSubPanel } from "./useSubPanel";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";
import type { TerminalId } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useTerminalCrud(deps: {
  store: TerminalStore;
  randomTheme: Accessor<boolean>;
  subscribeExit: (id: TerminalId) => void;
}) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const { showTipOnce } = useTips();

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
   *  Returns the new terminal ID (for session restore mapping). */
  async function handleCreate(cwd?: string): Promise<TerminalId> {
    if (store.activeMeta()?.git) showTipOnce(CONTEXTUAL_TIPS.worktree);

    const info = await client.terminal.create({ cwd }).catch((err: Error) => {
      toast.error(`Failed to create terminal: ${err.message}`);
      throw err;
    });
    const themeName = deps.randomTheme()
      ? availableThemes[Math.floor(Math.random() * availableThemes.length)]!
          .name
      : undefined;
    store.setActiveId(info.id);
    deps.subscribeExit(info.id);
    if (themeName) setThemeName(info.id, themeName);
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

  /** Export the active terminal's buffer as a themed HTML print preview.
   *  The user picks "Save as PDF" from the browser print dialog. */
  function handleExportSessionAsPdf() {
    const id = store.activeId();
    if (id === null) return;
    const refs = getTerminalRefs(id);
    if (!refs) {
      toast.error("Terminal not ready");
      return;
    }
    const bodyHtml = refs.serialize.serializeAsHTML({
      includeGlobalBackground: true,
    });
    const label = store.terminalLabel(id);
    // Pull the active theme off the live xterm so the popup matches exactly
    // what the user sees — serializeAsHTML only emits a global background,
    // not a default foreground, so unset text would fall back to browser
    // black without this.
    const theme = refs.xterm.options.theme ?? {};
    const fg = theme.foreground ?? "#000000";
    const bg = theme.background ?? "#ffffff";
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Popup blocked — allow popups to export as PDF");
      return;
    }
    const doc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(label)} — kolu export</title>
    <link rel="stylesheet" href="/fonts/fonts.css" />
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        font-family: ${FONT_FAMILY};
        color: ${fg};
        background-color: ${bg};
        white-space: pre;
        font-variant-ligatures: none;
      }
      @page { margin: 1cm; }
      @media print {
        html, body { background-color: ${bg}; }
      }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
    win.document.open();
    win.document.write(doc);
    win.document.close();
    // Wait for fonts to load before printing so glyph metrics are stable.
    // Fall through to print() on any fonts.ready failure — unstyled print is
    // still better than a silent no-op.
    const print = () => {
      win.focus();
      win.print();
    };
    const fontsReady = win.document.fonts?.ready;
    if (fontsReady) {
      fontsReady.then(print, print);
    } else {
      print();
    }
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
    removeAndAutoSwitch,
    handleCreate,
    handleCreateSubTerminal,
    handleKill,
    handleKillWithSubs,
    handleCopyTerminalText,
    handleExportSessionAsPdf,
    handleCloseAll,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
