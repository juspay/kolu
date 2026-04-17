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
import { isMobile } from "./useMobile";
import Header from "./Header";
import Sidebar from "./sidebar/Sidebar";
import TerminalContent from "./terminal/TerminalContent";
import TerminalMeta from "./terminal/TerminalMeta";
import TerminalCanvas from "./canvas/TerminalCanvas";
import MobileKeyBar from "./MobileKeyBar";
import CommandPalette from "./CommandPalette";
import ShortcutsHelp from "./ShortcutsHelp";
import DiagnosticInfo from "./DiagnosticInfo";
import ModalDialog, { refocusTerminal } from "./ui/ModalDialog";
import Dialog from "@corvu/dialog";
import EmptyState from "./EmptyState";
import RightPanelLayout from "./right-panel/RightPanelLayout";
import CloseConfirm, { type CloseConfirmTarget } from "./CloseConfirm";
import { createCommands } from "./commands";
import { exportSessionAsPdf } from "./exportSessionAsPdf";

import type { TerminalId } from "kolu-common";
import { client, wsStatus, serverProcessId } from "./rpc/rpc";
import TransportOverlay from "./rpc/TransportOverlay";
import { useTerminals } from "./terminal/useTerminals";
import { useThemeManager } from "./useThemeManager";
import { useSidebar } from "./sidebar/useSidebar";
import { useShortcuts } from "./input/useShortcuts";
import { useSubPanel } from "./terminal/useSubPanel";
import { useCanvasViewport } from "./canvas/viewport/useCanvasViewport";
import { useRightPanel } from "./right-panel/useRightPanel";
import { useColorScheme } from "./settings/useColorScheme";
import { useServerState } from "./settings/useServerState";
import { useTips } from "./settings/useTips";
import { toggleMinimap } from "./canvas/CanvasMinimap";

const App: Component = () => {
  const { store, crud, session, worktree, alerts } = useTerminals();

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
    handleShuffleTheme,
  } = useThemeManager({
    activeId: store.activeId,
    terminalIds: store.terminalIds,
    getThemeName: (id) => store.getMetadata(id)?.themeName,
    setThemeName: crud.setThemeName,
  });

  const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();
  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();
  const { colorScheme, setColorScheme } = useColorScheme();
  const { preferences, updatePreferences } = useServerState();
  // Canvas mode is desktop-only — force focus mode on mobile
  const canvasMode = () => !isMobile() && preferences().canvasMode;
  const toggleCanvasMode = () =>
    updatePreferences({ canvasMode: !canvasMode() });

  const canvasViewport = useCanvasViewport();

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

  // Diagnostic info dialog state (command palette → Debug → Diagnostic info)
  const [diagnosticInfoOpen, setDiagnosticInfoOpen] = createSignal(false);

  // Close confirmation — snapshot ID + meta + split count at open time to prevent
  // stale-target bugs if the user switches terminals while the dialog is open.
  const [closeConfirmTarget, setCloseConfirmTarget] =
    createSignal<CloseConfirmTarget | null>(null);

  // Terminal search bar state — close when switching terminals
  const [searchOpen, setSearchOpen] = createSignal(false);
  createEffect(on(store.activeId, () => setSearchOpen(false), { defer: true }));

  const { initTipTriggers, startupTips, setStartupTips } = useTips();
  initTipTriggers({ terminalIds: store.terminalIds });

  /** Toggle sub-panel: create first split if none exist, otherwise toggle visibility. */
  function handleToggleSubPanel(parentId: TerminalId) {
    if (store.getSubTerminalIds(parentId).length === 0) {
      void crud.handleCreateSubTerminal(
        parentId,
        store.activeMeta()?.cwd ?? undefined,
      );
    } else {
      subPanel.togglePanel(parentId);
    }
  }

  function handleExportSessionAsPdf() {
    const id = store.activeId();
    if (id === null) return;
    exportSessionAsPdf(id, store.getMetadata(id));
  }

  function handleCanvasCenterActive() {
    if (!canvasMode()) return;
    const id = store.activeId();
    if (!id) return;
    const tile = store.getMetadata(id)?.canvasLayout;
    if (tile) canvasViewport.centerOnTile(tile);
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
    toggleSubPanel: handleToggleSubPanel,
    cycleSubTab: (parentId, direction) =>
      subPanel.cycleSubTab(
        parentId,
        store.getSubTerminalIds(parentId),
        direction,
      ),
    handleShuffleTheme,
    handleCopyTerminalText: () => void crud.handleCopyTerminalText(),
    handleExportSessionAsPdf,
    toggleRightPanel: rightPanel.togglePanel,
    canvasCenterActive: handleCanvasCenterActive,
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
    toggleSubPanel: handleToggleSubPanel,
    committedThemeName,
    setPreviewThemeName,
    handleSetTheme,
    handleShuffleTheme,
    setShortcutsHelpOpen,
    setAboutOpen,
    setDiagnosticInfoOpen,
    handleCreateWorktree: (repoPath, initialCommand) =>
      void worktree.handleCreateWorktree(repoPath, initialCommand),
    handleClose: () => {
      const id = store.activeId();
      if (id) closeTerminal(id);
    },
    handleCloseAll: () => void crud.handleCloseAll(),
    simulateAlert: alerts.simulateAlert,
    toggleRightPanel: rightPanel.togglePanel,
    canvasCenterActive: handleCanvasCenterActive,
    toggleMinimap,
    isCanvasMode: canvasMode,
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
      <ShortcutsHelp
        open={shortcutsHelpOpen()}
        onOpenChange={withRefocus(setShortcutsHelpOpen)}
      />
      <DiagnosticInfo
        open={diagnosticInfoOpen()}
        onOpenChange={setDiagnosticInfoOpen}
        activeId={store.activeId()}
      />
      <ModalDialog
        open={aboutOpen()}
        onOpenChange={withRefocus(setAboutOpen)}
        size="sm"
      >
        <Dialog.Content class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-6 text-sm">
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
      <Header
        status={wsStatus()}
        onOpenPalette={() => openPalette()}
        meta={store.activeMeta()}
        onToggleSidebar={toggleSidebar}
        onAgentClick={() => rightPanel.expandPanel()}
        onSearch={() => setSearchOpen(true)}
        appTitle={appTitle()}
        themeName={activeThemeName()}
        onThemeClick={() => openPaletteGroup("Theme")}
        canvasMode={canvasMode()}
        onToggleCanvasMode={toggleCanvasMode}
        sidebarOpen={sidebarOpen()}
        hasSubPanel={
          store.activeId() !== null &&
          store.getSubTerminalIds(store.activeId()!).length > 0
        }
        subPanelExpanded={
          store.activeId() !== null &&
          store.getSubTerminalIds(store.activeId()!).length > 0 &&
          !subPanel.getSubPanel(store.activeId()!).collapsed
        }
        onToggleSubPanel={() => {
          const id = store.activeId();
          if (id) handleToggleSubPanel(id);
        }}
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
        <Show
          when={canvasMode()}
          fallback={
            <>
              <Sidebar
                terminalIds={store.terminalIds()}
                activeId={store.activeId()}
                getMetadata={store.getMetadata}
                isUnread={store.isUnread}
                getDisplayInfo={store.getDisplayInfo}
                getTerminalTheme={getTerminalTheme}
                onSelect={store.setActiveId}
                onCloseTerminal={closeTerminal}
                onCreate={() => crud.handleCreate()}
                onNewTerminalMenu={() => openPaletteGroup("New terminal")}
                onReorder={crud.reorderTerminals}
                open={sidebarOpen()}
                onClose={closeSidebar}
              />
              <RightPanelLayout
                meta={store.activeMeta()}
                themeName={activeThemeName()}
                onThemeClick={() => openPaletteGroup("Theme")}
                contentClass="flex-col"
              >
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
                      {(id) => {
                        const visible = () => store.activeId() === id;
                        return (
                          <div
                            class="w-full h-full relative flex flex-col"
                            classList={{ hidden: !visible() }}
                          >
                            <TerminalContent
                              terminalId={id}
                              visible={visible()}
                              focused={visible()}
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
                            />
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>
                <MobileKeyBar activeId={store.activeId} />
              </RightPanelLayout>
            </>
          }
        >
          {/* Canvas mode — all terminals on freeform 2D canvas */}
          <Show
            when={!session.isLoading()}
            fallback={
              <div class="flex items-center justify-center flex-1 text-fg-3 text-sm">
                Connecting...
              </div>
            }
          >
            <Show
              when={store.terminalIds().length > 0}
              fallback={
                <div
                  data-testid="canvas-container"
                  class="flex-1 min-h-0 canvas-grid-bg"
                >
                  <EmptyState
                    savedSession={session.savedSession() ?? undefined}
                    onRestore={() => void session.handleRestoreSession()}
                  />
                </div>
              }
            >
              <RightPanelLayout
                meta={store.activeMeta()}
                themeName={activeThemeName()}
                onThemeClick={() => openPaletteGroup("Theme")}
              >
                <TerminalCanvas
                  tileIds={store.terminalIds()}
                  activeId={store.activeId()}
                  getTileTheme={(id) => {
                    const t = getTerminalTheme(id as TerminalId);
                    return {
                      bg: t.background ?? "var(--color-surface-1)",
                      fg: t.foreground ?? "var(--color-fg)",
                    };
                  }}
                  getLayout={(id) =>
                    store.getMetadata(id as TerminalId)?.canvasLayout
                  }
                  onLayoutChange={(id, layout) =>
                    crud.setCanvasLayout(id as TerminalId, layout)
                  }
                  onSelect={(id) => store.setActiveId(id as TerminalId)}
                  onClose={(id) => closeTerminal(id as TerminalId)}
                  renderTileTitle={(id) => (
                    <TerminalMeta
                      info={store.getDisplayInfo(id as TerminalId)}
                    />
                  )}
                  renderTileBody={(id, active) => (
                    <TerminalContent
                      terminalId={id as TerminalId}
                      visible={true}
                      focused={active()}
                      theme={getTerminalTheme(id as TerminalId)}
                      searchOpen={active() && searchOpen()}
                      onSearchOpenChange={setSearchOpen}
                      subTerminalIds={store.getSubTerminalIds(id as TerminalId)}
                      getMetadata={store.getMetadata}
                      onCreateSubTerminal={(parentId, cwd) =>
                        void crud.handleCreateSubTerminal(parentId, cwd)
                      }
                      onCloseTerminal={closeTerminal}
                      activeMeta={store.activeMeta()}
                      onFocus={() => store.setActiveId(id as TerminalId)}
                    />
                  )}
                />
              </RightPanelLayout>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default App;
