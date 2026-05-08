/** App shell: layout + wiring. State lives in useTerminals, behavior in components.
 *
 *  Per #622 the workspace is mode-less: desktop is always the canvas; mobile
 *  is a single fullscreen tile with swipe nav. Per-terminal chrome (theme
 *  pill, agent indicator, screenshot, split toggle) lives on the tile title
 *  bar via `canvas/TileTitleActions`. The header is intentionally minimal. */

import Dialog from "@corvu/dialog";
import { Meta, Title } from "@solidjs/meta";
import type { ServerIdentity } from "kolu-common/contract";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  on,
  Show,
} from "solid-js";
import { Toaster } from "solid-sonner";
import { match } from "ts-pattern";
import ChromeBar from "./ChromeBar";
import CloseConfirm, { type CloseConfirmTarget } from "./CloseConfirm";
import CommandPalette from "./CommandPalette";
import "kolu-common/test-hooks";
import CanvasWatermark from "./canvas/CanvasWatermark";
import {
  arrangeRepoIslands,
  placeNextToBucket,
  type RepoIslandTile,
} from "./canvas/repoIslands";
import type { TileLayout } from "./canvas/TileLayout";
import WorkspaceSwitcher, {
  buildWorkspaceEntries,
  buildWorkspaceSwitcherModel,
} from "./canvas/workspace-switcher";
import TerminalCanvas from "./canvas/TerminalCanvas";
import TileTitleActions from "./canvas/TileTitleActions";
import { useCanvasViewport } from "./canvas/viewport/useCanvasViewport";
import { createCommands } from "./commands";
import DiagnosticInfo from "./DiagnosticInfo";
import EmptyState from "./EmptyState";
import { exportScrollbackAsPdf } from "./exportScrollbackAsPdf";
import { exportSessionAsHtml } from "./exportSessionAsHtml";
import type { ActionContext } from "./input/actions";
import { useShortcuts } from "./input/useShortcuts";
import MobileKeyBar from "./MobileKeyBar";
import MobileTileView from "./MobileTileView";
import { useRecorder } from "./recorder/useRecorder";
import WebcamOverlay from "./recorder/WebcamOverlay";
import RightPanelLayout from "./right-panel/RightPanelLayout";
import { useRightPanel } from "./right-panel/useRightPanel";
import { client } from "./wire";
import { serverProcessId, wsStatus } from "./rpc/rpc";
import TransportOverlay from "./rpc/TransportOverlay";
import ShortcutsHelp from "./ShortcutsHelp";
import { screenshotTerminal } from "./screenshotTerminal";
import { useColorScheme } from "./settings/useColorScheme";
import { useTips } from "./settings/useTips";
import TerminalContent from "./terminal/TerminalContent";
import TerminalMeta from "./terminal/TerminalMeta";
import { useSubPanel } from "./terminal/useSubPanel";
import { useTerminals } from "./terminal/useTerminals";
import ModalDialog, { refocusTerminal } from "./ui/ModalDialog";
import { isMobile } from "./useMobile";
import { useThemeManager } from "./useThemeManager";

const App: Component = () => {
  const { store, crud, session, worktree, alerts } = useTerminals();

  // Expose for e2e test access — type comes from "kolu-common/test-hooks"
  window.__koluSimulateAlert = alerts.simulateAlert;

  const {
    committedThemeName,
    setPreviewThemeName,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    isPreviewingTheme,
    handleSetTheme,
    handleShuffleTheme,
  } = useThemeManager();

  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();
  const { colorScheme } = useColorScheme();
  const canvasViewport = useCanvasViewport();

  // Workspace-switcher feeds — desktop and mobile share the same
  // accessors; `buildWorkspaceSwitcherModel` owns the ordering pipeline.
  const workspaceEntries = createMemo(() =>
    buildWorkspaceEntries(
      store.terminalIds(),
      store.getDisplayInfo,
      (id) => store.getMetadata(id)?.canvasLayout,
    ),
  );
  const recencyOf = (id: TerminalId): number =>
    store.getMetadata(id)?.lastActivityAt ?? 0;
  const mobileWorkspaceModel = createMemo(() =>
    buildWorkspaceSwitcherModel(workspaceEntries(), {
      activeId: store.activeId(),
      getRecency: recencyOf,
    }),
  );
  const orderedIds = createMemo(() =>
    mobileWorkspaceModel().entries.map((entry) => entry.id),
  );

  // Fetch server identity for document title, watermark, and PWA chrome color.
  const [identity, setIdentity] = createSignal<ServerIdentity>();
  void client.server
    .info()
    .then((info) => setIdentity(info.identity))
    .catch((err) => {
      // Server info is cosmetic — safe to ignore on failure.
      console.warn("Server info fetch failed:", err);
    });
  const appTitle = () => identity()?.name ?? "kolu";

  // Palette state
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteInitialGroup, setPaletteInitialGroup] = createSignal<
    string | undefined
  >();

  // Shortcuts help overlay state
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = createSignal(false);

  const [workspaceSwitcherOpenRequest, setWorkspaceSwitcherOpenRequest] =
    createSignal(0);

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

  const { initTipTriggers } = useTips();
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

  function handleExportScrollbackAsPdf() {
    const id = store.activeId();
    if (id === null) return;
    exportScrollbackAsPdf(id, store.getMetadata(id));
  }

  function handleExportSessionAsHtml() {
    const id = store.activeId();
    if (id === null) return;
    void exportSessionAsHtml(id);
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

  /** Single commit point for canvas tile geometry — drag, resize,
   *  default-place, and arrange all flow through here. A future tiling
   *  mode that wants to interpret drag-as-swap or resize-as-ratio-adjust
   *  branches inside this function without touching the canvas. */
  function commitTileLayout(id: TerminalId, layout: TileLayout) {
    crud.setCanvasLayout(id, layout);
  }

  /** Project a placed tile into the shape `repoIslands` consumes. */
  function repoIslandTileFor(
    id: TerminalId,
    layout: TileLayout,
  ): RepoIslandTile | undefined {
    const bucket = store.getDisplayInfo(id)?.key.group;
    return bucket ? { id, bucket, layout } : undefined;
  }

  function handleCanvasAutoArrange() {
    if (isMobile()) return;
    const tiles = store.terminalIds().flatMap((id) => {
      const layout = store.getMetadata(id)?.canvasLayout;
      if (!layout) return [];
      const tile = repoIslandTileFor(id, layout);
      return tile ? [tile] : [];
    });
    for (const [id, layout] of arrangeRepoIslands(tiles)) {
      commitTileLayout(id, layout);
    }
  }

  // Shared between the keyboard dispatcher and the command palette so a single
  // wiring keeps both surfaces in sync. Palette-only deps (theme management,
  // dialog setters, debug, etc.) are added below in the createCommands call.
  const actionContext: ActionContext = {
    terminalIds: store.terminalIds,
    activeId: store.activeId,
    setActiveId: store.setActiveId,
    mruOrder: store.mruOrder,
    activeMeta: store.activeMeta,
    handleCreate: (cwd?: string) => void crud.handleCreate(cwd),
    handleCreateSubTerminal: (parentId, cwd) =>
      void crud.handleCreateSubTerminal(parentId, cwd),
    openNewTerminalMenu: () => openPaletteGroup("New terminal"),
    openWorkspaceSwitcher: () => {
      if (!isMobile()) setWorkspaceSwitcherOpenRequest((n) => n + 1);
    },
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
    handleScreenshotTerminal: () => handleScreenshotTerminal(),
    toggleRightPanel: rightPanel.togglePanel,
    toggleRecordingPause: () => useRecorder().togglePause(),
  };

  useShortcuts(actionContext);

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
    const worktreePath = meta.git?.isWorktree
      ? meta.git.worktreePath
      : undefined;
    const worktreeRemoval = worktreePath
      ? store.isWorktreeShared(worktreePath, id)
        ? ({ eligible: false, reason: "sharedWithOtherTerminals" } as const)
        : ({ eligible: true } as const)
      : undefined;
    setCloseConfirmTarget({ id, meta, splitCount, worktreeRemoval });
  }

  const commands = createCommands({
    ...actionContext,
    handleCopyTerminalText: () => void crud.handleCopyTerminalText(),
    handleRunInActiveTerminal: (cmd) => crud.handleRunInActiveTerminal(cmd),
    handleExportScrollbackAsPdf,
    handleExportSessionAsHtml,
    committedThemeName,
    setPreviewThemeName,
    handleSetTheme,
    setAboutOpen,
    setDiagnosticInfoOpen,
    handleCreateWorktree: (repoPath, name, initialCommand) =>
      void worktree.handleCreateWorktree(repoPath, name, initialCommand),
    handleClose: () => {
      const id = store.activeId();
      if (id) closeTerminal(id);
    },
    handleCloseAll: () => void crud.handleCloseAll(),
    simulateAlert: alerts.simulateAlert,
    isMobile,
    canvasCenterActive: handleCanvasCenterActive,
    canvasAutoArrange: handleCanvasAutoArrange,
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
      <Show when={identity()?.themeColor}>
        {(themeColor) => <Meta name="theme-color" content={themeColor()} />}
      </Show>
      <TransportOverlay />
      <WebcamOverlay />
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
      {/* Desktop chrome — docked top bar carrying workspace switcher, identity,
       *  and global controls. Mobile has its own pull-down sheet (see
       *  MobileTileView) and does not render this band. */}
      <Show when={!isMobile()}>
        <ChromeBar
          status={wsStatus()}
          onOpenPalette={() => openPalette()}
          workspaceSwitcher={
            <WorkspaceSwitcher
              entries={workspaceEntries()}
              activeId={store.activeId()}
              getRecency={recencyOf}
              openRequest={workspaceSwitcherOpenRequest()}
              onSelect={(id) => {
                store.setActiveId(id);
                const layout = store.getMetadata(id)?.canvasLayout;
                if (layout) canvasViewport.centerOnTile(layout);
              }}
              onCreate={() => openPaletteGroup("New terminal")}
            />
          }
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
                class="relative flex-1 min-h-0 canvas-grid-bg"
              >
                <CanvasWatermark text={appTitle()} />
                <EmptyState
                  savedSession={session.savedSession() ?? undefined}
                  onRestore={(opts) => void session.handleRestoreSession(opts)}
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
                    groups={mobileWorkspaceModel().compactGroups}
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
                    watermark={appTitle()}
                    getLayout={(id) => store.getMetadata(id)?.canvasLayout}
                    placeNew={(id, existing) => {
                      const bucket = store.getDisplayInfo(id)?.key.group;
                      if (!bucket) return undefined;
                      const islands = existing.flatMap((e) => {
                        const t = repoIslandTileFor(e.id, e.layout);
                        return t ? [t] : [];
                      });
                      return placeNextToBucket(bucket, islands);
                    }}
                    onLayoutChange={commitTileLayout}
                    onSelect={(id) => store.setActiveId(id)}
                    onClose={(id) => closeTerminal(id)}
                    renderTileTitle={(id) => (
                      <TerminalMeta info={store.getDisplayInfo(id)} />
                    )}
                    renderTileTitleActions={(id) => (
                      <TileTitleActions
                        id={id}
                        onOpenPaletteGroup={openPaletteGroup}
                        onToggleSubPanel={handleToggleSubPanel}
                        onOpenSearch={() => setSearchOpen(true)}
                        onScreenshot={handleScreenshotTerminal}
                      />
                    )}
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
