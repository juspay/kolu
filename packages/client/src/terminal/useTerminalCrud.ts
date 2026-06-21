/** Terminal CRUD — create, kill, close-all, theme, copy text.
 *
 *  Uses plain oRPC client calls. Server signals propagate list/metadata
 *  changes via the live subscriptions — no optimistic cache needed. */

import type { InitialTerminalMetadata, TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { availableThemes, pickTheme, resolveThemeBgs } from "terminal-themes";
import { createSharedRoot } from "../createSharedRoot";
import { exportScrollbackAsPdf } from "../exportScrollbackAsPdf";
import { exportSessionAsHtml } from "../exportSessionAsHtml";
import { useRightPanel } from "../right-panel/useRightPanel";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { writeTextToClipboard } from "../ui/clipboard";
import { refuseIfWarming } from "../kaval/useDaemonStatus";
import { client, preferences } from "../wire";
import { useSubPanel } from "./useSubPanel";
import { useTerminalSearch } from "./useTerminalSearch";
import { useTerminalStore } from "./useTerminalStore";

/** Terminal CRUD — singleton via `createSharedRoot`. Reads `useTerminalStore`
 *  internally (no `deps` argument), so consumers that already touch the store
 *  — `TileTitleActions`, `TerminalContent` — can call `useTerminalCrud()`
 *  directly instead of receiving crud-derived closures drilled from App.tsx.
 *  Mirrors the `useIntentEditor` de-deps: the old `{ store }` argument was an
 *  unenforceable "deps never change identity" convention held by a comment. */
export const useTerminalCrud = createSharedRoot(() => {
  const store = useTerminalStore();
  const subPanel = useSubPanel();
  const terminalSearch = useTerminalSearch();
  const rightPanel = useRightPanel();
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
        // Re-grab focus for the remaining active sub-terminal: closing a tab via
        // its close button moves focus to that button, and the reactive focus
        // state is otherwise unchanged, so the edge-triggered focus effect can't
        // restore it (and browser focus-after-removal is non-deterministic).
        subPanel.requestRefocus(parentId);
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
    rightPanel.removePanel(id);
    terminalSearch.removeTerminal(id);
    store.setMruOrder((prev) => prev.filter((x) => x !== id));
    if (store.activeId() === id) {
      const remaining = ids.filter((x) => x !== id);
      const next = remaining[Math.min(idx, remaining.length - 1)] ?? null;
      // `activate` pans the canvas to the auto-switched tile — without
      // it the viewport would stay centered on the just-killed tile.
      store.activate(next);
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
    // The one create chokepoint — keyboard (`Cmd+T`/`Cmd+Enter`), palette
    // "New terminal", the Dock `+`, worktree ops, and session restore's
    // per-terminal creates all funnel here. Block while the daemon is warming
    // (boot `connecting` or a supervised `restarting`): the App.tsx canvas
    // gate only hides the EmptyState/Dock affordances, but the shortcut and
    // palette stay live over the neutral warming surface, so without this
    // guard a `Cmd+T` or palette create races the recycle — spawning a
    // terminal into the daemon the restart is about to kill (or against a
    // momentarily-stale `current` connection). Creation must wait for
    // `connected` (F3). `throw` (not a silent return) so the restore loop
    // aborts cleanly rather than half-creating.
    if (refuseIfWarming())
      throw new Error("daemon warming: terminal creation deferred");
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
        rightPanel: initial?.rightPanel,
        lastActivityAt: initial?.lastActivityAt,
        intent: initial?.intent,
      })
      .catch((err: Error) => {
        toast.error(`Failed to create terminal: ${err.message}`);
        throw err;
      });
    // `setActiveSilently`: the canvas's cascade-placement effect bumps
    // the centering signal once the new tile's pending layout is set —
    // calling `activate` here would race the layout and read undefined.
    store.setActiveSilently(info.id);
    showTipOnce(CONTEXTUAL_TIPS.themeSwitch);
    return info.id;
  }

  async function handleCreateSubTerminal(parentId: TerminalId, cwd?: string) {
    // Split creation reaches `client.terminal.create` directly (not via
    // `handleCreate`), so it needs the same warming guard — the split
    // shortcut (Ctrl+`+Shift) and TileTitleActions stay live while warming.
    if (refuseIfWarming()) return;
    const info = await client.terminal
      .create({ cwd, parentId })
      .catch((err: Error) => {
        toast.error(`Failed to create terminal: ${err.message}`);
        throw err;
      });
    subPanel.setActiveSubTab(parentId, info.id);
    subPanel.expandPanel(parentId);
  }

  /** Toggle a terminal's split: create the first sub-terminal if none exist
   *  (seeded with the parent's cwd), otherwise flip the sub-panel's
   *  visibility. Moved out of App.tsx — it complected store + crud + sub-panel,
   *  all of which crud already orchestrates. */
  function toggleSubPanel(parentId: TerminalId) {
    if (store.getSubTerminalIds(parentId).length === 0) {
      void handleCreateSubTerminal(
        parentId,
        store.activeMeta()?.cwd ?? undefined,
      );
    } else {
      subPanel.togglePanel(parentId);
    }
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

  /** Request sleep — the shared entry the ☾ tile button and the palette both
   *  call. Surfaces the one-time discoverability tip, and when the terminal has
   *  splits, confirms via an action toast before closing them (a sleeping record
   *  is a single terminal — splits must not vanish silently, the §2
   *  non-negotiable). No splits → sleep straight away. */
  function requestSleep(id: TerminalId) {
    showTipOnce(CONTEXTUAL_TIPS.sleepTerminal);
    const subs = store.getSubTerminalIds(id).length;
    if (subs > 0) {
      toast.warning(`Sleeping closes ${subs} split${subs > 1 ? "s" : ""}`, {
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Sleep & close splits",
          onClick: () => void handleSleep(id),
        },
      });
      return;
    }
    void handleSleep(id);
  }

  /** Sleep a terminal: close its splits first (a sleeping record is a single
   *  terminal — sub-terminals are CLOSED, not frozen), then flip it to the
   *  dormant arm on the server. The tile STAYS (now dormant) — no
   *  `removeAndAutoSwitch`; the metadata subscription re-renders it frozen with a
   *  Wake call-to-action. Reached through `requestSleep` (which confirms splits). */
  async function handleSleep(id: TerminalId) {
    const subs = store.getSubTerminalIds(id);
    for (const subId of subs) await handleKill(subId);
    try {
      await client.terminal.sleep({ id });
    } catch (err) {
      toast.error(`Failed to sleep terminal: ${(err as Error).message}`);
    }
  }

  /** Wake a sleeping terminal: the server re-spawns its PTY on the same id and
   *  resumes its agent (session-restore-of-one). The metadata subscription flips
   *  it back to active and the tile re-renders live — so the client just asks. */
  async function handleWake(id: TerminalId) {
    try {
      await client.terminal.wake({ id });
    } catch (err) {
      toast.error(`Failed to wake terminal: ${(err as Error).message}`);
    }
  }

  /** Discard a sleeping terminal — remove its record (no PTY to kill, sleep
   *  released it) and auto-switch away. The close-path twin of `handleKill` for
   *  the dormant arm; reached from the reworded close-confirm dialog.
   *
   *  Surfaces a genuine discard failure (network / server error) in a toast and
   *  does NOT evict the tile locally (F4): swallowing every error and removing
   *  anyway would make a failed discard look successful and desync the UI from
   *  the still-present server record. The server's `discardSleeping` is a no-op
   *  on an already-gone id (it returns without throwing), so the common
   *  already-removed case resolves cleanly and the tile evicts as before. */
  async function handleDiscard(id: TerminalId) {
    try {
      await client.terminal.discardSleeping({ id });
    } catch (err) {
      toast.error(`Failed to discard terminal: ${(err as Error).message}`);
      return;
    }
    removeAndAutoSwitch(id);
  }

  async function handleCopyTerminalText() {
    const id = store.focusedId();
    if (id === null) return;
    let text: string;
    try {
      text = await client.terminal.screenText({ id });
    } catch (err) {
      console.error("Failed to read terminal text:", err);
      toast.error(`Failed to read terminal text: ${(err as Error).message}`);
      return;
    }
    try {
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
    const id = store.focusedId();
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
      // killAll bypasses removeAndAutoSwitch's per-terminal eviction, so clear
      // the find-bar map wholesale here too — otherwise stale keys outlive the
      // terminals they pointed at.
      terminalSearch.reset();
    } catch (err) {
      toast.error(`Failed to close all terminals: ${(err as Error).message}`);
    }
  }

  /** Export the active terminal's scrollback as a PDF. Resolves the active id
   *  and null-guards here so the shell doesn't thread `store.*` into the export
   *  feature — an active-terminal-keyed op like the rest of crud. */
  function exportScrollbackPdf() {
    const id = store.activeId();
    if (id === null) return;
    exportScrollbackAsPdf(id, store.getMetadata(id));
  }

  /** Export the active terminal's session as a standalone HTML page. */
  async function exportSessionHtml() {
    const id = store.activeId();
    if (id === null) return;
    await exportSessionAsHtml(id);
  }

  return {
    setThemeName,
    removeAndAutoSwitch,
    handleCreate,
    handleCreateSubTerminal,
    toggleSubPanel,
    handleKill,
    handleKillWithSubs,
    requestSleep,
    handleSleep,
    handleWake,
    handleDiscard,
    handleCopyTerminalText,
    handleRunInActiveTerminal,
    handleCloseAll,
    exportScrollbackPdf,
    exportSessionHtml,
  };
});
