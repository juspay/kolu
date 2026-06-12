/** App shell: layout + wiring. State lives in useTerminals, behavior in components.
 *
 *  Per #622 the workspace is mode-less: desktop is always the canvas; mobile
 *  is a single fullscreen tile with swipe nav. Per-terminal chrome (theme
 *  pill, agent indicator, screenshot, split toggle) lives on the tile title
 *  bar via `canvas/TileTitleActions`. The header is intentionally minimal. */

import Dialog from "@corvu/dialog";
import { createPwaInstall } from "@kolu/solid-pwa-install";
import { Meta, Title } from "@solidjs/meta";
import type { ServerIdentity } from "kolu-common/contract";
import type { TerminalId } from "kolu-common/surface";
import Commit from "./ui/Commit";
import { realSizes } from "./ui/corvuResizable";
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
import Dock, { toggleRailCards } from "./canvas/dock/Dock";
import { useDockOrder } from "./canvas/dock/useDockOrder";
import { buildWorkspaceEntries } from "./canvas/dockModel";
import TerminalCanvas from "./canvas/TerminalCanvas";
import TileTitleActions from "./canvas/TileTitleActions";
import { useCanvasArrange } from "./canvas/useCanvasArrange";
import { useViewPosture } from "./canvas/useViewPosture";
import { showsWorkspaceSwitcher, supportsSpatialCanvas } from "./capabilities";
import { createCommands } from "./commands";
import DiagnosticInfo from "./DiagnosticInfo";
import DegradedCanvas from "./DegradedCanvas";
import EmptyState from "./EmptyState";
import { daemonDown, localDaemonStatus } from "./useDaemonStatus";
import WelcomeDialog from "./WelcomeDialog";
import { exportScrollbackAsPdf } from "./exportScrollbackAsPdf";
import { exportSessionAsHtml } from "./exportSessionAsHtml";
import { exportSession, importSession } from "./sessionTransfer";
import type { ActionContext } from "./input/actions";
import { useShortcuts } from "./input/useShortcuts";
import IntentEditorDialog from "./intent/IntentEditorDialog";
import { useIntentEditor } from "./intent/useIntentEditor";
import MobileKeyBar from "./MobileKeyBar";
import MobileTileView from "./MobileTileView";
import { useRecorder } from "./recorder/useRecorder";
import WebcamOverlay from "./recorder/WebcamOverlay";
import Resizable from "@corvu/resizable";
import RightPanel from "./right-panel/RightPanel";
import RightPanelDrawer from "./right-panel/RightPanelDrawer";
import { useRightPanel } from "./right-panel/useRightPanel";
import { Z_HANDLE_OUTER } from "./ui/stackLayers";
import { serverProcessId, wsStatus } from "./rpc/rpc";
import TransportOverlay from "./rpc/TransportOverlay";
import ShortcutsHelp from "./ShortcutsHelp";
import { screenshotTerminal } from "./screenshotTerminal";
import TipBanner from "./settings/TipBanner";
import { useColorScheme } from "./settings/useColorScheme";
import { useTips } from "./settings/useTips";
import TerminalContent from "./terminal/TerminalContent";
import TerminalMeta from "./terminal/TerminalMeta";
import { useSubPanel } from "./terminal/useSubPanel";
import { useTerminals } from "./terminal/useTerminals";
import ModalDialog, { refocusTerminal } from "./ui/ModalDialog";
import { surface } from "./ui/Surface";
import { isMobile } from "./useMobile";
import { useThemeManager } from "./useThemeManager";
import { useVisualViewportHeight } from "./useVisualViewportHeight";
import { client, savedSession as serverSavedSession } from "./wire";

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

  // `openInCodeTab` (in `right-panel/openInCodeTab.ts`) dispatches both
  // desktop uncollapse and mobile drawer-open imperatively from the
  // producer call. There is no `on(pendingOpen, ...)` subscriber here —
  // the deferred-effect shape lost re-fires under the production Solid
  // build (see `openInCodeTab.ts`'s header for the canary scenario).

  // Workspace search feeds — the live-terminal source list and recency
  // accessor consumed by the unified command palette's "Search
  // workspaces" group. `useDockOrder` is the same singleton memo the
  // desktop dock and mobile drawer read, so `Cmd+1..9` targets the
  // exact row the dock paints (group-bucketed, parked rows filtered).
  const workspaceEntries = createMemo(() =>
    buildWorkspaceEntries(
      store.terminalIds(),
      store.getDisplayInfo,
      (id) => store.getMetadata(id)?.canvasLayout,
    ),
  );
  const recencyOf = (id: TerminalId): number =>
    store.getMetadata(id)?.lastActivityAt ?? 0;
  const dockTree = useDockOrder();
  // `dockTree` is already a singleton memo and `.flatRows` is a stable
  // projection per memo run; a second `createMemo` here just adds a
  // reactive node without any recomputation benefit. The id-only view
  // is computed at read time so `ActionContext` keeps its narrow
  // `TerminalId[]` shape — rail and cards still consume the full
  // `RankedDockRow` list directly via `dockTree().flatRows`.
  const orderedIds = (): TerminalId[] => dockTree().flatRows.map((r) => r.id);

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

  // About dialog state
  const [aboutOpen, setAboutOpen] = createSignal(false);

  // Welcome overlay state. No "seen" persistence — zero terminals always shows
  // the welcome inline (EmptyState); this just re-summons it on demand via the
  // palette "Tutorial" command. One shared install controller drives both the
  // inline moments and the overlay.
  const [welcomeOpen, setWelcomeOpen] = createSignal(false);
  // The browser captures `beforeinstallprompt` against the served manifest —
  // there's no element to point at a manifest URL, so `createPwaInstall` takes
  // no app-identity overrides. Installed-state is single-owner: surface-app's
  // `isInstalled` is the sole detector, so consumers read `app.isInstalled()`
  // directly (see WelcomeMoments).
  const pwaInstall = createPwaInstall();

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

  // Track the soft-keyboard-shrunk visible area on iOS — `--app-h` overrides
  // the root `h-dvh` so the terminal grid refits into the visible region.
  useVisualViewportHeight();

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
    if (!supportsSpatialCanvas()) return;
    const id = store.activeId();
    if (id) store.activate(id);
  }

  // Intent editor singleton — reads store + RPC directly. The dialog
  // is mounted at the App root; the chip in TerminalMeta and the palette
  // command both call `intentEditor.openTerminal(id)` to surface it.
  const intentEditor = useIntentEditor();

  const arrange = useCanvasArrange({
    store,
    crud,
  });

  // Canvas posture seam — shared by the keyboard shortcut (below) and the
  // command palette. `toggle` is the single writer; its own guard no-ops
  // off the spatial canvas (mobile / narrow) or at zero terminals.
  const posture = useViewPosture();

  // Shared between the keyboard dispatcher and the command palette so a single
  // wiring keeps both surfaces in sync. Palette-only deps (theme management,
  // dialog setters, debug, etc.) are added below in the createCommands call.
  const actionContext: ActionContext = {
    terminalIds: store.terminalIds,
    dockOrderedIds: orderedIds,
    activeId: store.activeId,
    activate: store.activate,
    mruOrder: store.mruOrder,
    activeMeta: store.activeMeta,
    handleCreate: (cwd?: string) => void crud.handleCreate(cwd),
    handleCreateSubTerminal: (parentId, cwd) =>
      void crud.handleCreateSubTerminal(parentId, cwd),
    openNewTerminalMenu: () => openPaletteGroup("New terminal"),
    openWorkspaceSwitcher: () => {
      if (showsWorkspaceSwitcher()) openPaletteGroup("Search workspaces");
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
    toggleDock: toggleRailCards,
    toggleCanvasPosture: posture.toggle,
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

  /** One definition of "Dock → palette": how the receptacle reaches the
   *  command palette. Spread into every Dock mount (the empty-branch Dock
   *  and the one TerminalCanvas owns) so the wiring lives in one place. */
  const dockPalette = {
    onCreate: () => openPaletteGroup("New terminal"),
    onOpenWorkspaceSearch: () => openPaletteGroup("Search workspaces"),
  };

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
    const splitCount = store.getDisplayInfo(id)?.subCount ?? 0;
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
    handleEditActiveIntent: intentEditor.openActive,
    setAboutOpen,
    setWelcomeOpen,
    setDiagnosticInfoOpen,
    handleCreateWorktree: (repoPath, name, initialCommand) =>
      void worktree.handleCreateWorktree(repoPath, name, initialCommand),
    handleClose: () => {
      const id = store.activeId();
      if (id) closeTerminal(id);
    },
    handleClearLocalStorage: () => {
      localStorage.clear();
      location.reload();
    },
    handleExportSession: () => exportSession(serverSavedSession()),
    handleImportSession: () =>
      void importSession().then(
        (s) => s && session.handleRestoreSession({ session: s }),
      ),
    simulateAlert: alerts.simulateAlert,
    canvasCenterActive: handleCanvasCenterActive,
    canvasAutoArrange: arrange.handleCanvasAutoArrange,
    workspaceEntries,
    recencyOf,
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
        onFocus={() => store.setActiveSilently(id)}
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

  const aboutChrome = surface({ portalled: true });

  return (
    <div
      class="relative flex flex-col bg-surface-0 text-fg font-sans"
      style={{
        // `var(--app-h)` is set by useVisualViewportHeight to the
        // soft-keyboard-shrunk visible area; `100dvh` is the fallback for
        // browsers without VisualViewport (or before mount fires).
        height: "var(--app-h, 100dvh)",
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
      <TipBanner />
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
        <Dialog.Content
          class={`${aboutChrome.class} p-6 text-sm`}
          style={aboutChrome.style}
        >
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
              <Commit
                sha={__SURFACE_APP_COMMIT__}
                class="text-accent hover:underline"
              />
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
      <WelcomeDialog
        open={welcomeOpen()}
        onOpenChange={withRefocus(setWelcomeOpen)}
        install={pwaInstall}
      />
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
      {/* Desktop chrome — docked top bar carrying identity and global
       *  controls. The workspace switcher retired in favor of the
       *  dock's mega level (#903). Mobile has its own
       *  pull-down sheet (see MobileTileView) and does not render this
       *  band. */}
      <Show when={!isMobile()}>
        <ChromeBar status={wsStatus()} onOpenPalette={() => openPalette()} />
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
          <Show when={daemonDown()}>
            {/* Honest daemon-down surface — gated BEFORE the empty/terminals
                branch so a dead/degraded kaval never masquerades as "you have
                no terminals" (#1034's empty-canvas lie). */}
            <DegradedCanvas
              state={
                localDaemonStatus()?.state === "dead" ? "dead" : "degraded"
              }
            />
          </Show>
          <Show
            when={!daemonDown() && !showEmpty()}
            fallback={
              // Empty-state welcome — only when the daemon is healthy. When it's
              // down, DegradedCanvas (above) owns the canvas, so this fallback
              // must stay hidden or both would render.
              <Show when={!daemonDown()}>
                <div
                  data-testid="canvas-container"
                  class="relative flex-1 min-h-0 canvas-grid-bg"
                >
                  <CanvasWatermark text={appTitle()} />
                  {/* The Dock stays mounted at zero terminals (desktop only)
                   *  so its `+` new-terminal button is the always-reachable
                   *  mouse path to the first terminal — the welcome card
                   *  advertises ⌘⏎ but carries no clickable affordance
                   *  (#1202). The empty Dock is just its header; the
                   *  `relative` parent anchors its tiled-posture float
                   *  (`top-12 left-4`), the only posture reachable at zero
                   *  tiles. Mobile keeps its own pull-down nav. */}
                  <Show when={!isMobile()}>
                    <Dock {...dockPalette} />
                  </Show>
                  <EmptyState
                    install={pwaInstall}
                    savedSession={session.savedSession() ?? undefined}
                    isRestoring={session.isRestoring()}
                    onRestore={(opts) =>
                      void session.handleRestoreSession(opts)
                    }
                  />
                </div>
              </Show>
            }
          >
            {match(isMobile())
              .with(true, () => (
                <RightPanelDrawer
                  terminalId={store.activeId()}
                  meta={store.activeMeta()}
                  themeName={activeThemeName()}
                  onThemeClick={() => openPaletteGroup("Set theme")}
                  contentClass="flex-col"
                >
                  <MobileTileView
                    orderedIds={orderedIds()}
                    status={wsStatus()}
                    appTitle={appTitle()}
                    onOpenPalette={() => openPalette()}
                    renderBody={renderMobileTileBody}
                    bottomBar={<MobileKeyBar />}
                  />
                </RightPanelDrawer>
              ))
              .with(false, () => (
                // Desktop host: horizontal `@corvu/resizable` split between
                // the canvas and the right panel. `sizes=[1, 0]` collapses
                // the panel to zero width while keeping it mounted — this
                // preserves `CodeTab`'s selectedPath signal and Pierre's
                // tree expansion across collapse round-trips (#818).
                //
                // **This container is expected to span the full viewport
                // width** — the Dock floats `position: absolute` over the
                // canvas in tiled mode rather than reflowing alongside it.
                // `ChromeBar` leans on this invariant for its
                // `right: panelSize * 100vw` offset; treating the Corvu
                // fraction as a viewport-width fraction only works while
                // the assumption holds. If a sibling ever shrinks this
                // container, the ChromeBar offset must move to a measured
                // pixel value or a host-published CSS custom property.
                //
                // `startIntersection={false}` on the handle opts out of
                // Corvu's module-level handle-pairing registry (see
                // `@corvu/resizable/dist/index.js:201-222`). Without the
                // opt-out, this outer horizontal handle pairs with
                // `CodeTab`'s inner vertical handle (their rects touch at
                // the corner) and clicks near the corner land on the
                // wrong handle. `CodeTab` defends from the inner side
                // with the same opt-out — both sides need it.
                <Resizable
                  orientation="horizontal"
                  sizes={
                    rightPanel.collapsed()
                      ? [1, 0]
                      : [1 - rightPanel.panelSize(), rightPanel.panelSize()]
                  }
                  onSizesChange={(sizes) => {
                    // `MIN_PANEL_SIZE = 0.05` inside `setPanelSize` drops
                    // the collapsed `sizes[1] = 0` case so `preferences.size`
                    // never persists as zero (which would re-expand into an
                    // ungrabbable zero-width panel).
                    const s = realSizes(sizes);
                    if (s) rightPanel.setPanelSize(s[1]);
                  }}
                  class="flex-1 min-h-0 overflow-hidden"
                >
                  <Resizable.Panel
                    as="div"
                    class="min-w-0 min-h-0 flex"
                    minSize={0.3}
                  >
                    <TerminalCanvas
                      tileIds={store.terminalIds()}
                      watermark={appTitle()}
                      getLayout={(id) => store.getMetadata(id)?.canvasLayout}
                      onLayoutChange={arrange.applyTileGeometry}
                      onAutoArrange={arrange.handleCanvasAutoArrange}
                      onSelect={store.setActiveSilently}
                      onClose={(id) => closeTerminal(id)}
                      {...dockPalette}
                      renderTileTitle={(id) => (
                        <TerminalMeta
                          info={store.getDisplayInfo(id)}
                          unread={store.isUnread(id)}
                          onOpenIntent={() => intentEditor.openTerminal(id)}
                        />
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
                  </Resizable.Panel>
                  <Show when={!rightPanel.collapsed()}>
                    <Resizable.Handle
                      data-testid="right-panel-handle"
                      startIntersection={false}
                      // `Z_HANDLE_OUTER` lifts the ::before pseudo above
                      // the canvas tile (`Z_CANVAS_TILE_ACTIVE`). The
                      // handle's ::before extends 4px left into the
                      // canvas area (`before:-left-1 before:w-2`); without
                      // the explicit z-index the tile paints over that
                      // half of the hit zone wherever its right edge
                      // meets or passes the right-panel boundary, killing
                      // both the visual hover indicator and the pointer
                      // target. See `ui/stackLayers.ts` for the full
                      // layering contract.
                      class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
                      style={{ "z-index": Z_HANDLE_OUTER }}
                      aria-label="Resize inspector panel"
                    />
                  </Show>
                  <Resizable.Panel
                    as="div"
                    class="min-w-0 min-h-0 overflow-hidden"
                    classList={{
                      "border-l border-edge": !rightPanel.collapsed(),
                    }}
                    minSize={0.1}
                  >
                    <RightPanel
                      terminalId={store.activeId()}
                      meta={store.activeMeta()}
                      onToggle={rightPanel.togglePanel}
                      themeName={activeThemeName()}
                      onThemeClick={() => openPaletteGroup("Set theme")}
                      visible={!rightPanel.collapsed()}
                    />
                  </Resizable.Panel>
                </Resizable>
              ))
              .exhaustive()}
          </Show>
        </Show>
      </div>
      <IntentEditorDialog
        open={intentEditor.open()}
        title={intentEditor.title()}
        value={intentEditor.value()}
        allowClear={intentEditor.allowClear()}
        onOpenChange={intentEditor.onOpenChange}
        onSave={intentEditor.save}
        onClear={intentEditor.clear}
      />
    </div>
  );
};

export default App;
