/** App shell: layout + wiring. State lives in useTerminals, behavior in components. */

import {
  type Component,
  createSignal,
  createEffect,
  createMemo,
  on,
  Show,
  For,
} from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { orpc } from "./orpc";
import { Title } from "@solidjs/meta";
import { Toaster } from "solid-sonner";
import Header from "./Header";
import Sidebar from "./Sidebar";
import TerminalPane from "./TerminalPane";
import CommandPalette from "./CommandPalette";
import ShortcutsHelp from "./ShortcutsHelp";
import MissionControl, { type MCMode } from "./MissionControl";
import ModalDialog, { refocusTerminal } from "./ModalDialog";
import Dialog from "@corvu/dialog";
import EmptyState from "./EmptyState";
import { createCommands } from "./commands";

import { wsStatus, serverRestarted } from "./rpc";
import { useTerminals } from "./useTerminals";
import { usePreferences } from "./usePreferences";
import { useActivity } from "./useActivity";
import { useThemeManager } from "./useThemeManager";
import { useSidebar } from "./useSidebar";
import { useShortcuts } from "./useShortcuts";
import { useSubPanel } from "./useSubPanel";
import { useColorScheme } from "./useColorScheme";
import { useTips } from "./useTips";
import { useRecentRepos } from "./useRecentRepos";

const App: Component = () => {
  const {
    randomTheme,
    setRandomTheme,
    scrollLock,
    setScrollLock,
    activityAlerts,
    setActivityAlerts,
  } = usePreferences();

  const {
    terminalIds,
    activeId,
    setActiveId,
    getMeta,
    getDisplayInfo,
    setThemeName,
    activeMeta,
    isLoading,
    handleCreate,
    handleCreateSubTerminal,
    handleKill,
    getSubTerminalIds,
    reorderTerminals,
    mruOrder,
    handleCopyTerminalText,
    handleCreateWorktree,
    handleKillWorktree,
    handleCloseAll,
    savedSession,
    handleRestoreSession,
    simulateAlert,
  } = useTerminals({ randomTheme, activity: useActivity(), activityAlerts });

  // Expose for e2e test access
  (window as any).__koluSimulateAlert = simulateAlert;

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
    activeId,
    getThemeName: (id) => getMeta(id)?.meta?.themeName,
    setThemeName,
  });

  const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();
  const subPanel = useSubPanel();
  const { colorScheme, setColorScheme } = useColorScheme();

  // Fetch hostname from server; used in document title and header
  const serverInfo = createQuery(() => orpc.server.info.queryOptions());
  const appTitle = () => {
    const h = serverInfo.data?.hostname;
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

  // Mission Control state — single discriminated union, no impossible states
  const [mcMode, setMcMode] = createSignal<MCMode>({ mode: "closed" });

  // Terminal search bar state — close when switching terminals
  const [searchOpen, setSearchOpen] = createSignal(false);
  createEffect(on(activeId, () => setSearchOpen(false), { defer: true }));

  const { initTipTriggers, startupTips, setStartupTips } = useTips();
  initTipTriggers({ terminalIds });

  useShortcuts({
    terminalIds,
    activeId,
    setActiveId,
    handleCreate: (cwd?: string) => void handleCreate(cwd),
    handleCreateSubTerminal: (parentId, cwd) =>
      void handleCreateSubTerminal(parentId, cwd),
    activeMeta,
    setPaletteOpen,
    setShortcutsHelpOpen,
    setSearchOpen,
    mcMode,
    setMcMode,
    toggleSubPanel: (parentId) => subPanel.togglePanel(parentId),
    getSubTerminalIds,
    cycleSubTab: (parentId, direction) =>
      subPanel.cycleSubTab(parentId, getSubTerminalIds(parentId), direction),
    handleRandomizeTheme,
    handleCopyTerminalText: () => void handleCopyTerminalText(),
  });

  const { refetch: refetchRecentRepos } = useRecentRepos();

  // Refetch recent repos whenever the palette opens, regardless of how (Ctrl+K, header click, etc.)
  createEffect(
    on(paletteOpen, (open) => {
      if (open) refetchRecentRepos();
    }),
  );

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

  const commands = createCommands({
    terminalIds,
    activeId,
    setActiveId,
    activeMeta,
    handleCreate: (cwd) => void handleCreate(cwd),
    handleCreateSubTerminal: (parentId, cwd) =>
      void handleCreateSubTerminal(parentId, cwd),
    handleKill: (id) => void handleKill(id),
    handleCopyTerminalText: () => void handleCopyTerminalText(),
    getSubTerminalIds,
    toggleSubPanel: (parentId) => subPanel.togglePanel(parentId),
    committedThemeName,
    setPreviewThemeName,
    handleSetTheme,
    handleRandomizeTheme,
    setMcMode,
    setShortcutsHelpOpen,
    setAboutOpen,
    handleCreateWorktree: (repoPath) => void handleCreateWorktree(repoPath),
    handleKillWorktree: () => void handleKillWorktree(),
    handleCloseAll: () => void handleCloseAll(),
    simulateAlert,
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
        theme="dark"
        toastOptions={{
          style: {
            background: "var(--color-surface-1)",
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
      <MissionControl
        mcMode={mcMode()}
        onMcModeChange={(mode) => {
          setMcMode(mode);
          if (mode.mode === "closed") requestAnimationFrame(refocusTerminal);
        }}
        terminalIds={terminalIds()}
        mruOrder={mruOrder()}
        activeId={activeId()}
        getMeta={getMeta}
        getDisplayInfo={getDisplayInfo}
        getTerminalTheme={getTerminalTheme}
        onSelect={setActiveId}
      />
      <ModalDialog open={aboutOpen()} onOpenChange={withRefocus(setAboutOpen)}>
        <Dialog.Content class="bg-surface-1 border border-edge-bright rounded-lg p-6 max-w-sm text-sm">
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
      <Header
        status={wsStatus()}
        onOpenPalette={() => openPalette()}
        onThemeClick={() => openPaletteGroup("Theme")}
        onMissionControl={() => setMcMode({ mode: "browse" })}
        themeName={activeThemeName()}
        meta={activeMeta()}
        onToggleSidebar={toggleSidebar}
        onSearch={() => setSearchOpen(true)}
        appTitle={appTitle()}
        randomTheme={randomTheme()}
        onRandomThemeChange={setRandomTheme}
        scrollLock={scrollLock()}
        onScrollLockChange={setScrollLock}
        colorScheme={colorScheme()}
        onColorSchemeChange={setColorScheme}
        activityAlerts={activityAlerts()}
        onActivityAlertsChange={setActivityAlerts}
        startupTips={startupTips()}
        onStartupTipsChange={setStartupTips}
      />
      {/* relative: anchor for sidebar's absolute overlay on mobile */}
      <div class="relative flex flex-1 min-h-0">
        <Sidebar
          terminalIds={terminalIds()}
          activeId={activeId()}
          getMeta={getMeta}
          getDisplayInfo={getDisplayInfo}
          onSelect={setActiveId}
          onCreate={() => handleCreate()}
          onReorder={reorderTerminals}
          open={sidebarOpen()}
          onClose={closeSidebar}
        />
        {/* min-w-0: override flex min-width:auto so terminal area shrinks below canvas intrinsic size */}
        <div class="flex-1 min-h-0 min-w-0">
          <div
            class="h-full overflow-hidden"
            style={{ "background-color": activeTheme().background }}
          >
            <Show
              when={!isLoading()}
              fallback={
                <div class="flex items-center justify-center h-full text-fg-3 text-sm">
                  Connecting...
                </div>
              }
            >
              <Show when={terminalIds().length === 0}>
                <EmptyState
                  savedSession={savedSession() ?? undefined}
                  onRestore={() => void handleRestoreSession()}
                />
              </Show>
              <For each={terminalIds()}>
                {(id) => (
                  <TerminalPane
                    terminalId={id}
                    visible={activeId() === id}
                    theme={getTerminalTheme(id)}
                    searchOpen={searchOpen()}
                    onSearchOpenChange={setSearchOpen}
                    subTerminalIds={getSubTerminalIds(id)}
                    getMeta={getMeta}
                    onCreateSubTerminal={(parentId, cwd) =>
                      void handleCreateSubTerminal(parentId, cwd)
                    }
                    activeMeta={activeMeta()}
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
