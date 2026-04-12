/** App shell: layout + wiring. State lives in useTerminals, behavior in components. */

import {
  type Component,
  createSignal,
  createEffect,
  on,
  Show,
  For,
} from "solid-js";
import { Title } from "@solidjs/meta";
import { Toaster } from "solid-sonner";
import Header from "./Header";
import PwaInstallBar from "./PwaInstallBar";
import Sidebar from "./Sidebar";
import TerminalPane from "./TerminalPane";
import MobileKeyBar from "./MobileKeyBar";
import CommandPalette from "./CommandPalette";
import FileSearch from "./FileSearch";
import FilePeek from "./FilePeek";
import FileTree from "./FileTree";
import ShortcutsHelp from "./ShortcutsHelp";
import ClaudeTranscriptDialog from "./ClaudeTranscriptDialog";
import ModalDialog, { refocusTerminal } from "./ModalDialog";
import Dialog from "@corvu/dialog";
import EmptyState from "./EmptyState";
import CloseConfirm, { type CloseConfirmTarget } from "./CloseConfirm";
import { createCommands } from "./commands";
import { exportSessionAsPdf } from "./exportSessionAsPdf";

import type { TerminalId } from "kolu-common";
import { client, wsStatus, serverProcessId } from "./rpc";
import TransportOverlay from "./TransportOverlay";
import { useTerminals } from "./useTerminals";
import { useServerState } from "./useServerState";
import { useThemeManager } from "./useThemeManager";
import { useSidebar } from "./useSidebar";
import { useShortcuts } from "./useShortcuts";
import { useSubPanel } from "./useSubPanel";
import { useColorScheme } from "./useColorScheme";
import { useTips } from "./useTips";
import { useFileBrowser } from "./useFileBrowser";

const App: Component = () => {
  const { preferences, updatePreferences } = useServerState();
  const randomTheme = () => preferences().randomTheme;
  const scrollLock = () => preferences().scrollLock;
  const activityAlerts = () => preferences().activityAlerts;
  const sidebarAgentPreviews = () => preferences().sidebarAgentPreviews;

  const { store, crud, session, worktree, alerts } = useTerminals({
    randomTheme,
    activityAlerts,
  });

  // Expose for e2e test access
  (window as any).__koluSimulateAlert = alerts.simulateAlert;

  const {
    committedThemeName,
    setPreviewThemeName,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    isPreviewingTheme,
    handleSetTheme,
    handleRandomizeTheme,
  } = useThemeManager({
    activeId: store.activeId,
    getThemeName: (id) => store.getMetadata(id)?.themeName,
    setThemeName: crud.setThemeName,
  });

  const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();
  const subPanel = useSubPanel();
  const { colorScheme, setColorScheme } = useColorScheme();
  const fileBrowser = useFileBrowser();

  // Fetch hostname from server; used in document title and header
  const [hostname, setHostname] = createSignal<string>();
  void client.server
    .info()
    .then((info) => setHostname(info.hostname))
    .catch(() => {
      // Server info is cosmetic (document title) — safe to ignore on failure
    });
  const appTitle = () => {
    const h = hostname();
    return h ? `kolu@${h}` : "kolu";
  };

  // Palette state
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteInitialGroup, setPaletteInitialGroup] = createSignal<
    string | undefined
  >();

  // Shortcuts help overlay state
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = createSignal(false);

  // About dialog state
  const [aboutOpen, setAboutOpen] = createSignal(false);

  // Claude transcript debug dialog state
  const [claudeTranscriptOpen, setClaudeTranscriptOpen] = createSignal(false);

  // Close confirmation — snapshot ID + meta + split count at open time to prevent
  // stale-target bugs if the user switches terminals while the dialog is open.
  const [closeConfirmTarget, setCloseConfirmTarget] =
    createSignal<CloseConfirmTarget | null>(null);

  // Terminal search bar state — close when switching terminals
  const [searchOpen, setSearchOpen] = createSignal(false);
  createEffect(on(store.activeId, () => setSearchOpen(false), { defer: true }));

  const { initTipTriggers, startupTips, setStartupTips } = useTips();
  initTipTriggers({ terminalIds: store.terminalIds });

  function handleExportSessionAsPdf() {
    const id = store.activeId();
    if (id === null) return;
    exportSessionAsPdf(id, store.getMetadata(id));
  }

  useShortcuts({
    terminalIds: store.terminalIds,
    activeId: store.activeId,
    setActiveId: store.setActiveId,
    mruOrder: store.mruOrder,
    handleCreate: (cwd?: string) => void crud.handleCreate(cwd),
    handleCreateSubTerminal: (parentId, cwd) =>
      void crud.handleCreateSubTerminal(parentId, cwd),
    openNewTerminalMenu: () => openPaletteGroup("New terminal"),
    activeMeta: store.activeMeta,
    setPaletteOpen,
    setShortcutsHelpOpen,
    setSearchOpen,
    setFileSearchOpen: fileBrowser.setFileSearchOpen,
    toggleSubPanel: (parentId) => subPanel.togglePanel(parentId),
    getSubTerminalIds: store.getSubTerminalIds,
    cycleSubTab: (parentId, direction) =>
      subPanel.cycleSubTab(
        parentId,
        store.getSubTerminalIds(parentId),
        direction,
      ),
    handleRandomizeTheme,
    handleCopyTerminalText: () => void crud.handleCopyTerminalText(),
    handleExportSessionAsPdf,
  });

  function openPalette() {
    setPaletteInitialGroup(undefined);
    setPaletteOpen(true);
  }

  /** Wrap a boolean setter so closing any dialog refocuses the terminal. */
  function withRefocus(setter: (open: boolean) => void) {
    return (open: boolean) => {
      setter(open);
      if (!open) requestAnimationFrame(refocusTerminal);
    };
  }

  function openPaletteGroup(group: string) {
    setPaletteInitialGroup(group);
    setPaletteOpen(true);
  }

  /** Close a terminal. Top-level terminals show a confirmation dialog;
   *  splits (sub-terminals) are killed directly — they are ephemeral
   *  sub-panes, like browser tabs, and should never pop the worktree
   *  removal prompt (#462). */
  function closeTerminal(id: TerminalId) {
    const meta = store.getMetadata(id);
    if (!meta) return;
    if (meta.parentId) {
      void crud.handleKill(id);
      return;
    }
    const splitCount = store.getSubTerminalIds(id).length;
    setCloseConfirmTarget({ id, meta, splitCount });
  }

  const commands = createCommands({
    terminalIds: store.terminalIds,
    activeId: store.activeId,
    setActiveId: store.setActiveId,
    activeMeta: store.activeMeta,
    handleCreate: (cwd) => void crud.handleCreate(cwd),
    handleCreateSubTerminal: (parentId, cwd) =>
      void crud.handleCreateSubTerminal(parentId, cwd),
    handleCopyTerminalText: () => void crud.handleCopyTerminalText(),
    handleRunInActiveTerminal: (cmd) => crud.handleRunInActiveTerminal(cmd),
    handleExportSessionAsPdf,
    getSubTerminalIds: store.getSubTerminalIds,
    toggleSubPanel: (parentId) => subPanel.togglePanel(parentId),
    committedThemeName,
    setPreviewThemeName,
    handleSetTheme,
    handleRandomizeTheme,
    setShortcutsHelpOpen,
    setAboutOpen,
    setFileSearchOpen: fileBrowser.setFileSearchOpen,
    handleCreateWorktree: (repoPath, initialCommand) =>
      void worktree.handleCreateWorktree(repoPath, initialCommand),
    handleClose: () => {
      const id = store.activeId();
      if (id) closeTerminal(id);
    },
    handleCloseAll: () => void crud.handleCloseAll(),
    simulateAlert: alerts.simulateAlert,
    setClaudeTranscriptOpen,
  });

  // Reset state on close and return focus to terminal
  function handlePaletteOpenChange(open: boolean) {
    setPaletteOpen(open);
    if (!open) {
      setPaletteInitialGroup(undefined);
      // Only refocus if no other dialog took over (self-healing — no manual dialog list)
      requestAnimationFrame(() => {
        const anyDialogOpen = document.querySelector(
          "[data-corvu-dialog-content]:not([data-closed])",
        );
        if (!anyDialogOpen) refocusTerminal();
      });
    }
  }

  return (
    <div
      class="relative flex flex-col h-dvh bg-surface-0 text-fg font-sans"
      style={{
        "padding-top": "env(safe-area-inset-top)",
        "padding-bottom": "env(safe-area-inset-bottom)",
        "padding-left": "env(safe-area-inset-left)",
        "padding-right": "env(safe-area-inset-right)",
      }}
    >
      <Title>{appTitle()}</Title>
      <TransportOverlay />
      <Toaster
        position="bottom-right"
        theme={colorScheme()}
        richColors
        toastOptions={{
          style: {
            color: "var(--color-fg)",
            border: "1px solid var(--color-edge-bright)",
          },
          actionButtonStyle: {
            background: "var(--color-accent)",
            color: "var(--color-surface-1)",
            "font-weight": "600",
            "border-radius": "4px",
            padding: "4px 12px",
          },
        }}
      />
      <CommandPalette
        commands={commands}
        open={paletteOpen()}
        onOpenChange={handlePaletteOpenChange}
        initialGroup={paletteInitialGroup()}
        transparentOverlay={isPreviewingTheme()}
      />
      <FileSearch
        open={fileBrowser.fileSearchOpen()}
        onOpenChange={fileBrowser.setFileSearchOpen}
        activeMeta={store.activeMeta}
        onOpenFile={(root, path) => void fileBrowser.openPeek(root, path)}
      />
      <FilePeek
        open={fileBrowser.filePeekOpen()}
        onOpenChange={(open) => {
          if (!open) fileBrowser.closePeek();
        }}
        filePath={fileBrowser.peekFile()?.path ?? null}
        root={store.activeMeta()?.git?.repoRoot ?? null}
        content={fileBrowser.peekFile()?.content ?? null}
      />
      <ShortcutsHelp
        open={shortcutsHelpOpen()}
        onOpenChange={withRefocus(setShortcutsHelpOpen)}
      />
      <ClaudeTranscriptDialog
        open={claudeTranscriptOpen()}
        onOpenChange={withRefocus(setClaudeTranscriptOpen)}
        terminalId={store.activeId}
      />
      <ModalDialog open={aboutOpen()} onOpenChange={withRefocus(setAboutOpen)}>
        <Dialog.Content class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-6 max-w-sm text-sm">
          <div class="flex items-center gap-2 mb-3">
            <img src="/favicon.svg" alt="kolu" class="w-6 h-6" />
            <span class="font-semibold text-fg">{appTitle()}</span>
          </div>
          <div class="space-y-1 text-fg-3">
            <p>
              <a
                href="https://github.com/juspay/kolu"
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent hover:underline"
              >
                github.com/juspay/kolu
              </a>
            </p>
            <p>
              Commit:{" "}
              {__KOLU_COMMIT__ !== "dev" ? (
                <a
                  href={`https://github.com/juspay/kolu/commit/${__KOLU_COMMIT__}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-accent hover:underline"
                >
                  {__KOLU_COMMIT__}
                </a>
              ) : (
                <span class="text-fg-2">dev</span>
              )}
            </p>
            <p>
              Server:{" "}
              <span class="font-mono text-fg-2">
                {serverProcessId() ?? "—"}
              </span>
            </p>
          </div>
        </Dialog.Content>
      </ModalDialog>
      <CloseConfirm
        target={closeConfirmTarget()}
        onCancel={() => {
          setCloseConfirmTarget(null);
          requestAnimationFrame(refocusTerminal);
        }}
        onClose={() => {
          const target = closeConfirmTarget();
          setCloseConfirmTarget(null);
          // Don't refocus — the natural reactive focus handlers (sub-panel,
          // active terminal) restore focus to the right place after the kill.
          if (target) void crud.handleKillWithSubs(target.id);
        }}
        onCloseAndRemove={() => {
          const target = closeConfirmTarget();
          setCloseConfirmTarget(null);
          if (target) void worktree.handleKillWorktree(target.id);
        }}
      />
      <PwaInstallBar />
      <Header
        status={wsStatus()}
        onOpenPalette={() => openPalette()}
        onThemeClick={() => openPaletteGroup("Theme")}
        themeName={activeThemeName()}
        meta={store.activeMeta()}
        onToggleSidebar={toggleSidebar}
        onSearch={() => setSearchOpen(true)}
        appTitle={appTitle()}
        randomTheme={randomTheme()}
        onRandomThemeChange={(on) => updatePreferences({ randomTheme: on })}
        scrollLock={scrollLock()}
        onScrollLockChange={(on) => updatePreferences({ scrollLock: on })}
        colorScheme={colorScheme()}
        onColorSchemeChange={setColorScheme}
        activityAlerts={activityAlerts()}
        onActivityAlertsChange={(on) =>
          updatePreferences({ activityAlerts: on })
        }
        sidebarAgentPreviews={sidebarAgentPreviews()}
        onSidebarAgentPreviewsChange={(mode) =>
          updatePreferences({ sidebarAgentPreviews: mode })
        }
        startupTips={startupTips()}
        onStartupTipsChange={setStartupTips}
      />
      {/* relative: anchor for sidebar's absolute overlay on mobile.
       *  --active-terminal-{bg,fg} published here so child components
       *  (Sidebar) can read them via CSS without prop drilling. The fg
       *  lets the active sidebar card re-tune its text tiers against
       *  the terminal theme's own foreground (see #390). */}
      <div
        class="relative flex flex-1 min-h-0"
        style={{
          "--active-terminal-bg":
            activeTheme().background ?? "var(--color-surface-1)",
          "--active-terminal-fg": activeTheme().foreground ?? "var(--color-fg)",
        }}
      >
        <Sidebar
          terminalIds={store.terminalIds()}
          activeId={store.activeId()}
          getMetadata={store.getMetadata}
          isUnread={store.isUnread}
          getDisplayInfo={store.getDisplayInfo}
          getTerminalTheme={getTerminalTheme}
          previewMode={sidebarAgentPreviews()}
          onSelect={store.setActiveId}
          onCloseTerminal={closeTerminal}
          onCreate={() => crud.handleCreate()}
          onNewTerminalMenu={() => openPaletteGroup("New terminal")}
          onReorder={crud.reorderTerminals}
          open={sidebarOpen()}
          onClose={closeSidebar}
          fileTreeRoot={() => store.activeMeta()?.git?.repoRoot ?? null}
          onOpenFile={(root, path) => void fileBrowser.openPeek(root, path)}
        />
        {/* min-w-0: override flex min-width:auto so terminal area shrinks below canvas intrinsic size */}
        <div class="flex-1 min-h-0 min-w-0 flex flex-col">
          <div
            class="flex-1 min-h-0 overflow-hidden"
            style={{ "background-color": activeTheme().background }}
            data-testid="terminal-viewport"
          >
            <Show
              when={!session.isLoading()}
              fallback={
                <div class="flex items-center justify-center h-full text-fg-3 text-sm">
                  Connecting...
                </div>
              }
            >
              <Show when={store.terminalIds().length === 0}>
                <EmptyState
                  savedSession={session.savedSession() ?? undefined}
                  onRestore={() => void session.handleRestoreSession()}
                />
              </Show>
              <For each={store.terminalIds()}>
                {(id) => (
                  <TerminalPane
                    terminalId={id}
                    visible={store.activeId() === id}
                    theme={getTerminalTheme(id)}
                    searchOpen={searchOpen()}
                    onSearchOpenChange={setSearchOpen}
                    subTerminalIds={store.getSubTerminalIds(id)}
                    getMetadata={store.getMetadata}
                    onCreateSubTerminal={(parentId, cwd) =>
                      void crud.handleCreateSubTerminal(parentId, cwd)
                    }
                    onCloseTerminal={closeTerminal}
                    activeMeta={store.activeMeta()}
                    scrollLockEnabled={scrollLock()}
                  />
                )}
              </For>
            </Show>
          </div>
          <MobileKeyBar activeId={store.activeId} />
        </div>
      </div>
    </div>
  );
};

export default App;
