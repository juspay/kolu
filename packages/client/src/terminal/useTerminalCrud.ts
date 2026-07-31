/** Terminal CRUD — create, kill, close-all, theme, copy text.
 *
 *  Uses plain oRPC client calls. Server signals propagate list/metadata
 *  changes via the live subscriptions — no optimistic cache needed. */

import type { InitialTerminalMetadata } from "@kolu/padi/surface";
import type { TranscriptHtmlMode } from "@kolu/padi/transcript";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { usePendingLayouts } from "../canvas/usePendingLayouts";
import { createSharedRoot } from "../createSharedRoot";
import { exportScrollbackAsPdf } from "../exportScrollbackAsPdf";
import { exportSessionAsHtml } from "../exportSessionAsHtml";
import { refuseIfWarming } from "../kaval/useDaemonStatus";
import { useRightPanel } from "../right-panel/useRightPanel";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { writeTextToClipboard } from "../ui/clipboard";
import { activePadiRpc } from "../wire";
import {
  createEvictionDedup,
  evictTerminal,
  type TerminalEvictionPorts,
} from "./useActiveReconcile";
import { useNewTerminalThemePolicyReport } from "./useNewTerminalThemePolicyReport";
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
  const pendingLayouts = usePendingLayouts();
  const { showTipOnce } = useTips();
  // Keep every host's padi told what the new-terminal theme preference resolves
  // to — padi picks the theme for creates from ANY caller, including ones that
  // never touch this module (MCP, a TUI, a script).
  useNewTerminalThemePolicyReport();

  // --- Handlers ---

  /** Set a terminal's theme name on the server. */
  function setThemeName(id: TerminalId, name: string) {
    void activePadiRpc.chrome
      .setTheme({ id, themeName: name })
      .catch((err: Error) =>
        toast.error(`Failed to set theme: ${err.message}`),
      );
  }

  // The ONE cleanup body's side-effecting seams (see useActiveReconcile).
  // Wired once here; the imperative close path and the list-driven reconcile
  // both drive `evictTerminal` through these ports, so they can't diverge.
  const evictionPorts: TerminalEvictionPorts = {
    getSubTerminalIds: store.getSubTerminalIds,
    activeId: store.activeId,
    focusedTerminalId: store.focusedTerminalId,
    activate: store.activate,
    dropFromMru: (id) => store.forgetFromMru(id),
    promoteToTopLevel: (subId) =>
      void activePadiRpc.chrome
        .setParent({ id: subId, parentId: null })
        .catch((err: Error) =>
          toast.error(`Failed to set parent: ${err.message}`),
        ),
    subPanel: {
      collapse: subPanel.collapsePanel,
      collapseChrome: subPanel.collapsePanelChrome,
      activeSubTab: (parentId) => subPanel.peekSubPanel(parentId).activeSubTab,
      setActiveSubTab: subPanel.setActiveSubTab,
      selectSubTab: subPanel.selectSubTab,
      requestRefocus: subPanel.requestRefocus,
      remove: subPanel.removePanel,
    },
    removeRightPanel: rightPanel.removePanel,
    removeSearch: terminalSearch.removeTerminal,
  };

  const eviction = createEvictionDedup(
    (id, parentId, topLevelBefore, departing) =>
      evictTerminal(evictionPorts, id, parentId, topLevelBefore, departing),
  );

  /** Remove a terminal and auto-switch if it was active — the IMPERATIVE close
   *  path (kill, discard). Runs synchronously with metadata still present, so it
   *  reads the live parentId + top-level order. Claims the id (when a list-drop
   *  will follow) so the later list-driven reconcile skips it — see
   *  `createEvictionDedup`. */
  function removeAndAutoSwitch(id: TerminalId) {
    eviction.evictImperatively(
      id,
      store.getMetadata(id)?.parentId ?? null,
      store.terminalIds(),
      store.getMetadata(id) !== undefined,
    );
  }

  /** Create a new terminal on the server and make it active.
   *  Returns the new terminal ID (for session restore mapping).
   *  `initial` carries client-owned metadata to seed atomically on the
   *  server — used by session restore so the first `terminal.list`
   *  yield already carries the saved theme / canvas layout / sub-panel
   *  state, closing the race with the canvas cascade effect (#642). */
  async function handleCreate(
    cwd?: string,
    // CHROME-only seed: the create RPC forwards theme / layout / panels / intent and
    // nothing else. `InitialTerminalMetadata` also carries the server-derived restore
    // facts (`lastActivityAt`, `lastAgentCommand`, `restoreTarget`) that only host-side
    // `session.restore` threads through `respawnActive` — a client create has no truth
    // about them and this handler drops them. Omit them from the param so the type can't
    // advertise an option that has no effect (F6).
    initial?: Omit<
      InitialTerminalMetadata,
      "lastActivityAt" | "lastAgentCommand" | "restoreTarget"
    >,
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

    // The new terminal's theme is resolved SERVER-SIDE by padi's
    // `lifecycle.create` handler, so every caller — keyboard/palette create,
    // session restore, and MCP-created terminals — honours the same
    // `newTerminalTheme` / `shuffleBehavior` preference. The only theme the
    // client pins explicitly is a caller-provided override (session restore /
    // worktree), which still wins.
    // Inherit the active tile's size for the new terminal. Set BEFORE
    // the create RPC — the server push during the await triggers the
    // canvas placement effect, which consumes the signal. If we set
    // after the await, the effect has already run with no size to inherit.
    //
    // Only the cascade-placed fresh-create path consumes the slot: a
    // create carrying `initial.canvasLayout` (session restore, #642) is
    // server-seeded, so the placement effect's `newIds` excludes it and a
    // set would be never-consumed. So we touch the slot ONLY on the
    // fresh-create path — but there we set it UNCONDITIONALLY (size, or
    // `null` when there's no active tile to inherit from), so a fresh
    // create always OWNS the slot value rather than leaving a stale size
    // armed by an earlier create that no new tile ever consumed.
    //
    // Prefer the active tile's *pending* layout over its echoed metadata:
    // a just-resized tile's visible size lives in `pendingLayouts.pending`
    // until the server metadata echo catches up (`getLayout` reads only
    // the echo). Reading the echo alone would inherit the pre-resize size
    // when a create races the echo. `active()` bundles (id, meta) from one
    // glitch-free read.
    if (!initial?.canvasLayout) {
      const { id: activeId, meta } = store.active();
      // `active()` bundles (id, meta): meta is null whenever id is null, so the
      // no-active-tile branch is just `undefined` — there's no metadata to read.
      const activeLayout = activeId
        ? pendingLayouts.resolveLayout(activeId, meta?.canvasLayout)
        : undefined;
      pendingLayouts.setNextDefaultSize(
        activeLayout ? { w: activeLayout.w, h: activeLayout.h } : null,
      );
    }
    const info = await activePadiRpc.lifecycle
      .create({
        cwd,
        themeName: initial?.themeName,
        canvasLayout: initial?.canvasLayout,
        subPanel: initial?.subPanel,
        rightPanel: initial?.rightPanel,
        intent: initial?.intent,
      })
      .catch((err: Error) => {
        // Create failed → no server push, so the canvas effect won't consume
        // the pending size. Clear it here (not in a `finally`, which would
        // race the deferred effect on the success path) so a stale size can't
        // leak into a later create that has no active tile to overwrite it.
        pendingLayouts.setNextDefaultSize(null);
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
    // Split creation reaches `lifecycle.create` directly (not via
    // `handleCreate`), so it needs the same warming guard — the split
    // shortcut (Ctrl+`+Shift) and TileTitleActions stay live while warming.
    if (refuseIfWarming()) return;
    const info = await activePadiRpc.lifecycle
      .create({ cwd, parentId })
      .catch((err: Error) => {
        toast.error(`Failed to create terminal: ${err.message}`);
        throw err;
      });
    subPanel.focusSubTab(parentId, info.id);
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
      await activePadiRpc.lifecycle.kill({ id });
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
      await activePadiRpc.lifecycle.sleep({ id });
    } catch (err) {
      toast.error(`Failed to sleep terminal: ${(err as Error).message}`);
    }
  }

  /** Wake a sleeping terminal: the server re-spawns its PTY on the same id and
   *  resumes its agent (session-restore-of-one). The metadata subscription flips
   *  it back to active and the tile re-renders live — so the client just asks. */
  async function handleWake(id: TerminalId) {
    try {
      await activePadiRpc.lifecycle.wake({ id });
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
   *  already-removed case resolves cleanly and the tile evicts as before.
   *
   *  Returns `true` on success, `false` on a surfaced failure — the
   *  worktree-removal close path (F10) must NOT delete the worktree when the
   *  sleeping record wasn't actually discarded, or the still-present terminal
   *  would point at a removed cwd. The standalone close-confirm caller ignores
   *  the result (it only needs the toast). */
  async function handleDiscard(id: TerminalId): Promise<boolean> {
    try {
      await activePadiRpc.lifecycle.discardSleeping({ id });
    } catch (err) {
      toast.error(`Failed to discard terminal: ${(err as Error).message}`);
      return false;
    }
    removeAndAutoSwitch(id);
    return true;
  }

  async function handleCopyTerminalText() {
    const id = store.focusedId();
    if (id === null) return;
    let text: string;
    try {
      text = await activePadiRpc.screen.text({ id });
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

  /** Copy the focused terminal's id to the clipboard — the value
   *  `kaval-tui attach <id>` takes to grab this exact PTY from a shell. Each
   *  split is its own PTY with its own id, so this copies the focused pane's,
   *  matching `handleCopyTerminalText`'s `focusedId()`. */
  async function handleCopyTerminalId() {
    const id = store.focusedId();
    if (id === null) return;
    try {
      await writeTextToClipboard(id);
      toast.success("Copied terminal ID to clipboard");
    } catch (err) {
      console.error("Failed to copy terminal ID:", err);
      toast.error(`Failed to copy terminal ID: ${(err as Error).message}`);
    }
  }

  /** Write a command line into the active terminal WITHOUT pressing Enter.
   *  Used by the "Recent agents" palette entry to prefill a previously
   *  seen agent CLI — the user reviews/edits and hits Enter themselves.
   *  No-op if no terminal is active. */
  function handleRunInActiveTerminal(command: string) {
    const id = store.focusedId();
    if (id === null) return;
    void activePadiRpc.lifecycle
      .sendInput({ id, data: command })
      .catch((err: Error) =>
        toast.error(`Failed to prefill command: ${err.message}`),
      );
  }

  async function handleCloseAll() {
    try {
      await activePadiRpc.lifecycle.killAll();
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
  async function exportSessionHtml(
    modes: [TranscriptHtmlMode, ...TranscriptHtmlMode[]],
  ) {
    const id = store.activeId();
    if (id === null) return;
    await exportSessionAsHtml(id, modes);
  }

  return {
    setThemeName,
    removeAndAutoSwitch,
    /** List-driven cleanup for a naturally-departed terminal (dedup-guarded).
     *  Wired into the reconcile in useTerminals. */
    evictDeparted: eviction.evictDeparted,
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
    handleCopyTerminalId,
    handleRunInActiveTerminal,
    handleCloseAll,
    exportScrollbackPdf,
    exportSessionHtml,
  };
});
