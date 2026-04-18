/** App shell: layout + wiring. State lives in useTerminals, behavior in components.
 *
 *  Per #622 the workspace is mode-less: desktop is always the canvas; mobile
 *  is a single fullscreen tile with swipe nav. Per-terminal chrome (theme
 *  pill, agent indicator, screenshot, split toggle) lives on the tile title
 *  bar via `renderTileTitleActions`. The header is intentionally minimal. */

import {
  type Component,
  createSignal,
  createEffect,
  createMemo,
  on,
  Show,
} from "solid-js";
import { Title } from "@solidjs/meta";
import { Toaster } from "solid-sonner";
import { match } from "ts-pattern";
import { isMobile } from "./useMobile";
import ChromeBar from "./ChromeBar";
import TerminalContent from "./terminal/TerminalContent";
import TerminalMeta from "./terminal/TerminalMeta";
import AgentIndicator from "./terminal/AgentIndicator";
import TerminalCanvas from "./canvas/TerminalCanvas";
import { groupByRepo, flatPillOrder } from "./canvas/pillTreeOrder";
import MobileTileView from "./MobileTileView";
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
import { screenshotTerminal } from "./screenshotTerminal";
import { ScreenshotIcon, SearchIcon } from "./ui/Icons";
import Tip from "./ui/Tip";

import type { TerminalId } from "kolu-common";
import { client, wsStatus, serverProcessId } from "./rpc/rpc";
import TransportOverlay from "./rpc/TransportOverlay";
import { useTerminals } from "./terminal/useTerminals";
import { useThemeManager } from "./useThemeManager";
import { useShortcuts } from "./input/useShortcuts";
import { useSubPanel } from "./terminal/useSubPanel";
import { useCanvasViewport } from "./canvas/viewport/useCanvasViewport";
import { useRightPanel } from "./right-panel/useRightPanel";
import { useColorScheme } from "./settings/useColorScheme";
import { useTips } from "./settings/useTips";
import { CONTEXTUAL_TIPS, pillTreeSwitchTip } from "./settings/tips";
import { toggleMinimap } from "./canvas/CanvasMinimap";

/** Tile chrome buttons share this affordance. Theme pill is wider — it shows
 *  the theme name. Other buttons are square. */
const TILE_BUTTON_CLASS =
  "flex items-center justify-center h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

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

  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();
  const { colorScheme, setColorScheme } = useColorScheme();
  const canvasViewport = useCanvasViewport();
  const { showTipOnce } = useTips();

  // Pill-tree-grouped order — single source for the desktop pill tree AND
  // the mobile swipe handler so the two views never drift.
  //
  // Desktop: pass `getLayout` so the tree mirrors the canvas spatially
  // (left tile → first pill, right tile → last pill). Reorders live as
  // tiles are dragged. Mobile has no canvas, so layouts are absent and
  // the function falls back to sortOrder.
  const pillGroups = createMemo(() =>
    groupByRepo(
      store.terminalIds(),
      store.getDisplayInfo,
      (id) => store.getMetadata(id)?.canvasLayout,
    ),
  );
  const orderedIds = createMemo(() => flatPillOrder(pillGroups()));

  // Shared TileTheme accessor — feeds both ChromeBar (pill bg) and
  // TerminalCanvas (tile chrome). One source so a theme tweak flows
  // through every surface that mirrors the tile.
  const getChromeTileTheme = (id: TerminalId) => {
    const t = getTerminalTheme(id);
    return {
      bg: t.background ?? "var(--color-surface-1)",
      fg: t.foreground ?? "var(--color-fg)",
    };
  };

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

  // Terminal search bar state — close when switching terminals.
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

  function handleScreenshotTerminal(id?: TerminalId) {
    const targetId = id ?? store.activeId();
    if (targetId === null) return;
    void screenshotTerminal(targetId, store.getMetadata(targetId));
  }

  function handleCanvasCenterActive() {
    if (isMobile()) return;
    const id = store.activeId();
    if (!id) return;
    const tile = store.getMetadata(id)?.canvasLayout;
    if (tile) canvasViewport.centerOnTile(tile);
  }

  function selectTerminalFromPill(id: TerminalId) {
    const idx = orderedIds().indexOf(id);
    if (idx >= 0 && idx < 9) showTipOnce(pillTreeSwitchTip(idx));
    store.setActiveId(id);
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
    handleExportSessionAsPdf,
    handleScreenshotTerminal: () => handleScreenshotTerminal(),
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
    handleScreenshotTerminal: () => handleScreenshotTerminal(),
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
    isMobile,
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

  /** Per-tile chrome rendered into the CanvasTile title bar.
   *  Order (left → right between title and close): agent indicator, theme
   *  pill, split toggle, search, screenshot. */
  function renderTileTitleActions(id: TerminalId) {
    const meta = store.getMetadata(id);
    const themeName = () =>
      store.activeId() === id ? activeThemeName() : meta?.themeName;
    const subCount = () => store.getSubTerminalIds(id).length;
    const splitExpanded = () =>
      subCount() > 0 && !subPanel.getSubPanel(id).collapsed;
    return (
      <>
        <Show when={meta?.agent}>
          {(agent) => (
            <button
              class={`${TILE_BUTTON_CLASS} px-2`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                store.setActiveId(id);
                rightPanel.expandPanel();
              }}
              title="Open inspector"
            >
              <AgentIndicator agent={agent()} />
            </button>
          )}
        </Show>
        <Show when={themeName()}>
          {(name) => (
            <Tip label={`Theme: ${name()}`}>
              <button
                data-testid="tile-theme-pill"
                class={`${TILE_BUTTON_CLASS} px-2 max-w-[14ch] truncate text-xs`}
                style={{ color: "var(--color-fg-3, currentColor)" }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  store.setActiveId(id);
                  openPaletteGroup("Theme");
                  setTimeout(
                    () => showTipOnce(CONTEXTUAL_TIPS.themeFromPalette),
                    500,
                  );
                }}
              >
                {name()}
              </button>
            </Tip>
          )}
        </Show>
        <Tip label={subCount() > 0 ? "Toggle split" : "Add split"}>
          <button
            data-testid="tile-split-toggle"
            class={`${TILE_BUTTON_CLASS} w-7`}
            classList={{ "bg-black/20": splitExpanded() }}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              store.setActiveId(id);
              handleToggleSubPanel(id);
            }}
            aria-label="Toggle split"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              stroke-width="2"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="13" x2="21" y2="13" />
            </svg>
          </button>
        </Tip>
        <Tip label="Find in terminal">
          <button
            data-testid="tile-find"
            class={`${TILE_BUTTON_CLASS} w-7`}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              store.setActiveId(id);
              setSearchOpen(true);
            }}
            aria-label="Find in terminal"
          >
            <SearchIcon />
          </button>
        </Tip>
        <button
          class={`${TILE_BUTTON_CLASS} w-7`}
          style={{ color: "var(--color-fg-3, currentColor)" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleScreenshotTerminal(id);
          }}
          title="Screenshot terminal"
          data-testid="screenshot-button"
        >
          <ScreenshotIcon />
        </button>
      </>
    );
  }

  /** Canvas tile body — every tile stays mounted (`visible={true}`) so
   *  inactive xterms keep their grid sized correctly; only the focused tile
   *  takes keyboard focus. */
  function renderCanvasTileBody(id: TerminalId, active: () => boolean) {
    return (
      <TerminalContent
        terminalId={id}
        visible={true}
        focused={active()}
        theme={getTerminalTheme(id)}
        searchOpen={active() && searchOpen()}
        onSearchOpenChange={setSearchOpen}
        subTerminalIds={store.getSubTerminalIds(id)}
        getMetadata={store.getMetadata}
        onCreateSubTerminal={(parentId, cwd) =>
          void crud.handleCreateSubTerminal(parentId, cwd)
        }
        onCloseTerminal={closeTerminal}
        activeMeta={store.activeMeta()}
        onFocus={() => store.setActiveId(id)}
      />
    );
  }

  /** Mobile body — only the active terminal is visible (others hide via
   *  the parent's classList) so xterm doesn't try to size a 0×0 element. */
  function renderMobileTileBody(id: TerminalId, visible: () => boolean) {
    return (
      <TerminalContent
        terminalId={id}
        visible={visible()}
        focused={visible()}
        theme={getTerminalTheme(id)}
        searchOpen={visible() && searchOpen()}
        onSearchOpenChange={setSearchOpen}
        subTerminalIds={store.getSubTerminalIds(id)}
        getMetadata={store.getMetadata}
        onCreateSubTerminal={(parentId, cwd) =>
          void crud.handleCreateSubTerminal(parentId, cwd)
        }
        onCloseTerminal={closeTerminal}
        activeMeta={store.activeMeta()}
      />
    );
  }

  const showEmpty = () =>
    !session.isLoading() && store.terminalIds().length === 0;

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
      {/* Desktop chrome — docked top bar carrying pill tree, identity,
       *  and global controls. Mobile has its own pull-down sheet (see
       *  MobileTileView) and does not render this band. */}
      <Show when={!isMobile()}>
        <ChromeBar
          status={wsStatus()}
          appTitle={appTitle()}
          onOpenPalette={() => openPalette()}
          groups={pillGroups()}
          activeId={store.activeId()}
          canvasMaximized={store.canvasMaximized()}
          onExitMaximize={store.toggleCanvasMaximized}
          getDisplayInfo={store.getDisplayInfo}
          getTileTheme={getChromeTileTheme}
          isUnread={store.isUnread}
          onSelect={(id) => {
            store.setActiveId(id);
            if (!store.canvasMaximized()) {
              const layout = store.getMetadata(id)?.canvasLayout;
              if (layout) canvasViewport.centerOnTile(layout);
            }
          }}
        />
      </Show>
      {/* relative: anchor for overlay panels.
       *  --active-terminal-{bg,fg} published here so child components
       *  can read them via CSS without prop drilling. The fg lets sub-
       *  components re-tune text tiers against the terminal theme. */}
      <div
        class="relative flex flex-1 min-h-0"
        style={{
          "--active-terminal-bg":
            activeTheme().background ?? "var(--color-surface-1)",
          "--active-terminal-fg": activeTheme().foreground ?? "var(--color-fg)",
        }}
      >
        <Show
          when={!session.isLoading()}
          fallback={
            <div class="flex items-center justify-center flex-1 text-fg-3 text-sm">
              Connecting...
            </div>
          }
        >
          <Show
            when={!showEmpty()}
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
              contentClass={isMobile() ? "flex-col" : undefined}
            >
              {match(isMobile())
                .with(true, () => (
                  <MobileTileView
                    orderedIds={orderedIds()}
                    activeId={store.activeId()}
                    getDisplayInfo={store.getDisplayInfo}
                    isUnread={store.isUnread}
                    setActiveId={store.setActiveId}
                    groups={pillGroups()}
                    status={wsStatus()}
                    appTitle={appTitle()}
                    onOpenPalette={() => openPalette()}
                    renderBody={renderMobileTileBody}
                    bottomBar={<MobileKeyBar activeId={store.activeId} />}
                  />
                ))
                .with(false, () => (
                  <TerminalCanvas
                    tileIds={store.terminalIds()}
                    activeId={store.activeId()}
                    canvasMaximized={store.canvasMaximized()}
                    onToggleMaximize={store.toggleCanvasMaximized}
                    getDisplayInfo={store.getDisplayInfo}
                    getTileTheme={getChromeTileTheme}
                    getLayout={(id) => store.getMetadata(id)?.canvasLayout}
                    onLayoutChange={(id, layout) =>
                      crud.setCanvasLayout(id, layout)
                    }
                    onSelect={(id) => store.setActiveId(id)}
                    onClose={(id) => closeTerminal(id)}
                    renderTileTitle={(id) => (
                      <TerminalMeta info={store.getDisplayInfo(id)} />
                    )}
                    renderTileTitleActions={renderTileTitleActions}
                    renderTileBody={renderCanvasTileBody}
                  />
                ))
                .exhaustive()}
            </RightPanelLayout>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default App;
