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
import { toast, Toaster } from "solid-sonner";
import { match } from "ts-pattern";
import ChromeBar from "./ChromeBar";
import CloseConfirm, { type CloseConfirmTarget } from "./CloseConfirm";
import CommandPalette from "./CommandPalette";
import "kolu-common/test-hooks";
import CanvasWatermark from "./canvas/CanvasWatermark";
import { useCanvasArrange } from "./canvas/useCanvasArrange";
import { buildWorkspaceEntries } from "./canvas/dockModel";
import { toggleRailCards } from "./canvas/dock/Dock";
import { useDockOrder } from "./canvas/dock/useDockOrder";
import TerminalCanvas from "./canvas/TerminalCanvas";
import TileTitleActions from "./canvas/TileTitleActions";
import { createCommands } from "./commands";
import DiagnosticInfo from "./DiagnosticInfo";
import IntentEditorDialog from "./intent/IntentEditorDialog";
import { useIntentEditor } from "./intent/useIntentEditor";
import EmptyState from "./EmptyState";
import { exportScrollbackAsPdf } from "./exportScrollbackAsPdf";
import { exportSessionAsHtml } from "./exportSessionAsHtml";
import type { ActionContext } from "./input/actions";
import { useShortcuts } from "./input/useShortcuts";
import MobileKeyBar from "./MobileKeyBar";
import MobileTileView from "./MobileTileView";
import {
  configureRecorderNotifications,
  useRecorder,
  WebcamOverlay,
} from "@kolu/solid-recorder";
import RightPanel from "./right-panel/RightPanel";
import RightPanelDrawer from "./right-panel/RightPanelDrawer";
import { useRightPanel } from "./right-panel/useRightPanel";
import { client } from "./wire";
import { serverProcessId, wsStatus } from "./rpc/rpc";
import TransportOverlay from "./rpc/TransportOverlay";
import ShortcutsHelp from "./ShortcutsHelp";
import { screenshotTerminal } from "./screenshotTerminal";
import TipBanner from "./settings/TipBanner";
import { useColorScheme } from "./settings/useColorScheme";
import { useTips } from "./settings/useTips";
import { useVisualViewportHeight } from "./useVisualViewportHeight";
import TerminalContent from "./terminal/TerminalContent";
import TerminalMeta from "./terminal/TerminalMeta";
import { useSubPanel } from "./terminal/useSubPanel";
import { useTerminals } from "./terminal/useTerminals";
import ModalDialog, { refocusTerminal } from "./ui/ModalDialog";
import { surface } from "./ui/Surface";
import { isMobile } from "./useMobile";
import { useThemeManager } from "./useThemeManager";

// Wire @kolu/solid-recorder's notification surface to solid-sonner.
// The framework defaults to `console.*`; this swap installs Kolu's
// toast presentation once at module load.
configureRecorderNotifications({
  onError: (m) => toast.error(m),
  onSuccess: (m, opts) => toast.success(m, opts),
  onWarning: (m) => toast.warning(m),
});

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
    if (isMobile()) return;
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
    isMobile,
  });

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
      if (!isMobile()) openPaletteGroup("Search workspaces");
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
    simulateAlert: alerts.simulateAlert,
    isMobile,
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
                  isRestoring={session.isRestoring()}
                  onRestore={(opts) => void session.handleRestoreSession(opts)}
                />
              </div>
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
                    bottomBar={<MobileKeyBar activeId={store.activeId} />}
                  />
                </RightPanelDrawer>
              ))
              .with(false, () => (
                <TerminalCanvas
                  tileIds={store.terminalIds()}
                  watermark={appTitle()}
                  getLayout={(id) => store.getMetadata(id)?.canvasLayout}
                  placeNew={arrange.placeNew}
                  onLayoutChange={arrange.applyTileGeometry}
                  onAutoArrange={arrange.handleCanvasAutoArrange}
                  onSelect={store.setActiveSilently}
                  onClose={(id) => closeTerminal(id)}
                  onOpenWorkspaceSearch={() =>
                    openPaletteGroup("Search workspaces")
                  }
                  onCreate={() => openPaletteGroup("New terminal")}
                  renderTileTitle={(id) => (
                    <TerminalMeta
                      info={store.getDisplayInfo(id)}
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
                  rightPanel={
                    <RightPanel
                      terminalId={store.activeId()}
                      meta={store.activeMeta()}
                      onToggle={rightPanel.togglePanel}
                      themeName={activeThemeName()}
                      onThemeClick={() => openPaletteGroup("Set theme")}
                      visible={!rightPanel.collapsed()}
                      shell={true}
                    />
                  }
                />
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
