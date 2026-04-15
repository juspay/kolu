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
import Sidebar from "./sidebar/Sidebar";
import TerminalPane from "./terminal/TerminalPane";
import TerminalCanvas from "./terminal/TerminalCanvas";
import MobileKeyBar from "./MobileKeyBar";
import CommandPalette from "./CommandPalette";
import ShortcutsHelp from "./ShortcutsHelp";
import ModalDialog, { refocusTerminal } from "./ui/ModalDialog";
import Dialog from "@corvu/dialog";
import Resizable from "@corvu/resizable";
import EmptyState from "./EmptyState";
import RightPanel from "./right-panel/RightPanel";
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
import { useRightPanel } from "./right-panel/useRightPanel";
import { useColorScheme } from "./settings/useColorScheme";
import { useTips } from "./settings/useTips";

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
  const [canvasMode, setCanvasMode] = createSignal(true);
  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();
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
    handleCreateWorktree: (repoPath, initialCommand) =>
      void worktree.handleCreateWorktree(repoPath, initialCommand),
    handleClose: () => {
      const id = store.activeId();
      if (id) closeTerminal(id);
    },
    handleCloseAll: () => void crud.handleCloseAll(),
    simulateAlert: alerts.simulateAlert,
    toggleRightPanel: rightPanel.togglePanel,
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
      <PwaInstallBar />
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
        onToggleCanvasMode={() => setCanvasMode((v) => !v)}
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
              {/* min-w-0: override flex min-width:auto so terminal area shrinks below canvas intrinsic size.
               *  overflow-hidden: prevent scrollbar when collapsed edge strip + Resizable exceed container width. */}
              <div class="flex-1 min-h-0 min-w-0 flex overflow-hidden">
                <Resizable
                  orientation="horizontal"
                  sizes={
                    rightPanel.collapsed()
                      ? [1, 0]
                      : [1 - rightPanel.panelSize(), rightPanel.panelSize()]
                  }
                  onSizesChange={(sizes) => {
                    if (sizes[1] !== undefined) rightPanel.setPanelSize(sizes[1]);
                  }}
                  class="flex-1 min-h-0 overflow-hidden"
                >
                  <Resizable.Panel
                    as="div"
                    class="min-w-0 min-h-0 flex flex-col"
                    minSize={0.3}
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
                            />
                          )}
                        </For>
                      </Show>
                    </div>
                    <MobileKeyBar activeId={store.activeId} />
                  </Resizable.Panel>

                  <Show when={!rightPanel.collapsed()}>
                    <Resizable.Handle
                      data-testid="right-panel-handle"
                      class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
                      aria-label="Resize inspector panel"
                    />
                  </Show>

                  <Resizable.Panel
                    as="div"
                    class="min-w-0 min-h-0 overflow-hidden"
                    minSize={0}
                  >
                    <Show when={!rightPanel.collapsed()}>
                      <RightPanel
                        meta={store.activeMeta()}
                        onToggle={rightPanel.togglePanel}
                        themeName={activeThemeName()}
                        onThemeClick={() => openPaletteGroup("Theme")}
                      />
                    </Show>
                  </Resizable.Panel>
                </Resizable>
              </div>
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
                <EmptyState
                  savedSession={session.savedSession() ?? undefined}
                  onRestore={() => void session.handleRestoreSession()}
                />
              }
            >
              {/* Pinned: docked right panel with Resizable. Unpinned: overlay. */}
              <Show
                when={!rightPanel.collapsed() && rightPanel.pinned()}
                fallback={
                  <div class="flex-1 min-h-0 min-w-0 flex relative">
                    <TerminalCanvas
                      terminalIds={store.terminalIds()}
                      activeId={store.activeId()}
                      getMetadata={store.getMetadata}
                      getDisplayInfo={store.getDisplayInfo}
                      getTerminalTheme={getTerminalTheme}
                      onSelect={store.setActiveId}
                      onCloseTerminal={closeTerminal}
                      onCreateSubTerminal={(parentId, cwd) =>
                        void crud.handleCreateSubTerminal(parentId, cwd)
                      }
                      activeMeta={store.activeMeta()}
                      searchOpen={searchOpen()}
                      onSearchOpenChange={setSearchOpen}
                      subTerminalIds={store.getSubTerminalIds}
                    />
                    {/* Overlay right panel */}
                    <Show when={!rightPanel.collapsed()}>
                      <>
                        <div
                          class="absolute inset-0 bg-black/20 z-20"
                          onClick={() => rightPanel.collapsePanel()}
                        />
                        <div
                          class="absolute top-0 right-0 bottom-0 z-30 w-80 lg:w-96 shadow-2xl shadow-black/30"
                          style={{ "max-width": "50%" }}
                        >
                          <RightPanel
                            meta={store.activeMeta()}
                            onToggle={rightPanel.togglePanel}
                            themeName={activeThemeName()}
                            onThemeClick={() => openPaletteGroup("Theme")}
                          />
                        </div>
                      </>
                    </Show>
                  </div>
                }
              >
                {/* Pinned: docked via Resizable */}
                <Resizable
                  orientation="horizontal"
                  sizes={[1 - rightPanel.panelSize(), rightPanel.panelSize()]}
                  onSizesChange={(sizes) => {
                    if (sizes[1] !== undefined) rightPanel.setPanelSize(sizes[1]);
                  }}
                  class="flex-1 min-h-0 overflow-hidden"
                >
                  <Resizable.Panel
                    as="div"
                    class="min-w-0 min-h-0 flex"
                    minSize={0.3}
                  >
                    <TerminalCanvas
                      terminalIds={store.terminalIds()}
                      activeId={store.activeId()}
                      getMetadata={store.getMetadata}
                      getDisplayInfo={store.getDisplayInfo}
                      getTerminalTheme={getTerminalTheme}
                      onSelect={store.setActiveId}
                      onCloseTerminal={closeTerminal}
                      onCreateSubTerminal={(parentId, cwd) =>
                        void crud.handleCreateSubTerminal(parentId, cwd)
                      }
                      activeMeta={store.activeMeta()}
                      searchOpen={searchOpen()}
                      onSearchOpenChange={setSearchOpen}
                      subTerminalIds={store.getSubTerminalIds}
                    />
                  </Resizable.Panel>
                  <Resizable.Handle
                    class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
                    aria-label="Resize inspector panel"
                  />
                  <Resizable.Panel
                    as="div"
                    class="min-w-0 min-h-0 overflow-hidden"
                    minSize={0}
                  >
                    <RightPanel
                      meta={store.activeMeta()}
                      onToggle={rightPanel.togglePanel}
                      themeName={activeThemeName()}
                      onThemeClick={() => openPaletteGroup("Theme")}
                    />
                  </Resizable.Panel>
                </Resizable>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default App;
