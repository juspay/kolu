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
import Sidebar from "./Sidebar";
import TerminalPane from "./TerminalPane";
import CommandPalette from "./CommandPalette";
import ShortcutsHelp from "./ShortcutsHelp";
import ClaudeTranscriptDialog from "./ClaudeTranscriptDialog";
import ModalDialog, { refocusTerminal } from "./ModalDialog";
import Dialog from "@corvu/dialog";
import EmptyState from "./EmptyState";
import CloseConfirm, { type CloseConfirmTarget } from "./CloseConfirm";
import { createCommands } from "./commands";

import type { TerminalId } from "kolu-common";
import { client, wsStatus, serverRestarted } from "./rpc";
import { useTerminals } from "./useTerminals";
import { useServerState } from "./useServerState";
import { useThemeManager } from "./useThemeManager";
import { useSidebar } from "./useSidebar";
import { useShortcuts } from "./useShortcuts";
import { useSubPanel } from "./useSubPanel";
import { useColorScheme } from "./useColorScheme";
import { useTips } from "./useTips";

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

  /** Close a terminal — always shows the confirmation dialog. */
  function closeTerminal(id: TerminalId) {
    const meta = store.getMetadata(id);
    if (!meta) return;
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
    getSubTerminalIds: store.getSubTerminalIds,
    toggleSubPanel: (parentId) => subPanel.togglePanel(parentId),
    committedThemeName,
    setPreviewThemeName,
    handleSetTheme,
    handleRandomizeTheme,
    setShortcutsHelpOpen,
    setAboutOpen,
    handleCreateWorktree: (repoPath) =>
      void worktree.handleCreateWorktree(repoPath),
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
      {/* Dim the app when the server process has changed — state is stale */}
      <Show when={serverRestarted()}>
        <div class="absolute inset-0 bg-black/60 z-50 pointer-events-auto" />
      </Show>
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
        />
        {/* min-w-0: override flex min-width:auto so terminal area shrinks below canvas intrinsic size */}
        <div class="flex-1 min-h-0 min-w-0">
          <div
            class="h-full overflow-hidden"
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
        </div>
      </div>
    </div>
  );
};

export default App;
