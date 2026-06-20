/** App shell: layout + wiring. State lives in useXxx singletons, behavior in
 *  components. App.tsx mounts the chrome, the canvas surface (chosen by
 *  `canvasMode`), the dialogs, and the overlays — and holds nothing but the
 *  layout. New domain state belongs in a `useXxx.ts` singleton, NOT here; the
 *  `app-shell-stays-thin` code-police rule + `App.shell.test.ts` enforce it.
 *
 *  The workspace mounts one macro layout chosen by `layoutMode` (useMobile):
 *  desktop is the spatial canvas; phone (below `sm`) is a single fullscreen
 *  tile; compact (a roomy finger-driven handheld — unfolded foldables, tablets)
 *  is a two-pane dock rail + active tile. (Per #622 it stays mode-less — one
 *  layout per form factor, no in-app switch.) Per-terminal chrome (theme pill,
 *  agent indicator, screenshot, split toggle) lives on the tile title bar via
 *  `canvas/TileTitleActions`. The header is intentionally minimal. */

import { createPwaInstall } from "@kolu/solid-pwa-install";
import { Meta, Title } from "@solidjs/meta";
import { sleepingArm, type TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js";
import { Toaster } from "solid-sonner";
import { match, P } from "ts-pattern";
import AboutDialog from "./AboutDialog";
import ChromeBar from "./ChromeBar";
import CloseConfirm, { type CloseConfirmTarget } from "./CloseConfirm";
import CommandPalette from "./CommandPalette";
import { realSizes } from "./ui/corvuResizable";
import Resizable from "@corvu/resizable";
import CanvasWatermark from "./canvas/CanvasWatermark";
import DormantTileBody from "./canvas/DormantTileBody";
import Dock from "./canvas/dock/Dock";
import { useDockOrder } from "./canvas/dock/useDockOrder";
import { buildWorkspaceEntries } from "./canvas/dockModel";
import TerminalCanvas from "./canvas/TerminalCanvas";
import TileTitleActions from "./canvas/TileTitleActions";
import { useCanvasArrange } from "./canvas/useCanvasArrange";
import { createCommands } from "./commands";
import DegradedCanvas from "./kaval/DegradedCanvas";
import DiagnosticInfo from "./DiagnosticInfo";
import EmptyState from "./EmptyState";
import CompactTileView from "./CompactTileView";
import { useShortcuts } from "./input/useShortcuts";
import IntentEditorDialog from "./intent/IntentEditorDialog";
import { useIntentEditor } from "./intent/useIntentEditor";
import MobileKeyBar from "./MobileKeyBar";
import MobileTileView from "./MobileTileView";
import WebcamOverlay from "./recorder/WebcamOverlay";
import RightPanel from "./right-panel/RightPanel";
import RightPanelDrawer from "./right-panel/RightPanelDrawer";
import { useRightPanel } from "./right-panel/useRightPanel";
import { wsStatus } from "./rpc/rpc";
import TransportOverlay from "./rpc/TransportOverlay";
import ShortcutsHelp from "./ShortcutsHelp";
import { exportSession, importSession } from "./sessionTransfer";
import TipBanner from "./settings/TipBanner";
import { useColorScheme } from "./settings/useColorScheme";
import { useTips } from "./settings/useTips";
import TerminalContent from "./terminal/TerminalContent";
import TerminalMeta from "./terminal/TerminalMeta";
import { useTerminals } from "./terminal/useTerminals";
import { useTileStore } from "./tile/useTileStore";
import { refocusTerminal } from "./ui/ModalDialog";
import { Z_HANDLE_OUTER } from "./ui/stackLayers";
import { type CanvasMode, canvasMode } from "./kaval/useCanvasMode";
import { isDesktop, layoutMode } from "./useMobile";
import { useActionContext } from "./useActionContext";
import { useCommandPalette } from "./useCommandPalette";
import { useServerIdentity } from "./useServerIdentity";
import { useThemeManager } from "./useThemeManager";
import { useVisualViewportHeight } from "./useVisualViewportHeight";
import WelcomeDialog from "./WelcomeDialog";
import { savedSession as serverSavedSession } from "./wire";

const App: Component = () => {
  const { store, crud, session, worktree, alerts } = useTerminals();
  // The tile registry — what the canvas, dock, switcher, and mode read for tile
  // PRESENCE (the set, layout, active selection, count). The terminal store
  // stays the source for terminal CONTENT (display info, metadata, the active
  // terminal behind RightPanel / theme / screenshot).
  const tileStore = useTileStore();

  const {
    committedThemeName,
    setPreviewThemeName,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    isPreviewingTheme,
    handleSetTheme,
  } = useThemeManager();

  const rightPanel = useRightPanel();
  const { colorScheme } = useColorScheme();
  const { appTitle, themeColor } = useServerIdentity();
  const commandPalette = useCommandPalette();

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
      tileStore.tileIds(),
      store.getDisplayInfo,
      tileStore.getLayout,
    ),
  );
  const recencyOf = (id: TerminalId): number =>
    store.getMetadata(id)?.lastActivityAt ?? 0;
  const dockTree = useDockOrder();
  // `dockTree` is already a singleton memo and `.flatRows` is a stable
  // projection per memo run; the id-only view is computed at read time so the
  // mobile drawer still gets a narrow `TerminalId[]`.
  const orderedIds = (): TerminalId[] => dockTree().flatRows.map((r) => r.id);

  // Close confirmation — snapshot ID + meta + split count at open time to prevent
  // stale-target bugs if the user switches terminals while the dialog is open.
  const [closeConfirmTarget, setCloseConfirmTarget] =
    createSignal<CloseConfirmTarget | null>(null);

  const { initTipTriggers } = useTips();
  initTipTriggers({ terminalIds: store.terminalIds });

  // Track the soft-keyboard-shrunk visible area on iOS — `--app-h` overrides
  // the root `h-dvh` so the terminal grid refits into the visible region.
  useVisualViewportHeight();

  // One shared install controller drives both the inline welcome moments
  // (EmptyState) and the on-demand WelcomeDialog. The browser captures
  // `beforeinstallprompt` against the served manifest, so `createPwaInstall`
  // takes no app-identity overrides.
  const pwaInstall = createPwaInstall();

  // Intent editor singleton — reads store + RPC directly. The dialog
  // is mounted at the App root; the chip in TerminalMeta and the palette
  // command both call `intentEditor.openTerminal(id)` to surface it.
  const intentEditor = useIntentEditor();

  const arrange = useCanvasArrange();

  // The single wiring shared by the keyboard dispatcher and the command
  // palette — composed from the domain singletons in `useActionContext`.
  const actionContext = useActionContext();
  useShortcuts(actionContext);

  /** One definition of "Dock → palette": how the receptacle reaches the
   *  command palette. Spread into every Dock mount (the empty-branch Dock
   *  and the one TerminalCanvas owns) so the wiring lives in one place. */
  const dockPalette = {
    onCreate: () => commandPalette.openGroup("New terminal"),
    onOpenWorkspaceSearch: () => commandPalette.openGroup("Search workspaces"),
  };

  /** Close a terminal. Top-level terminals show a confirmation dialog;
   *  splits (sub-terminals) are killed directly — they are ephemeral
   *  sub-panes, like browser tabs, and should never pop the worktree
   *  removal prompt (#462). Stays in the shell: it pops the root-mounted
   *  `<CloseConfirm>` dialog whose open-state the shell owns. */
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
    handleExportScrollbackAsPdf: crud.exportScrollbackPdf,
    handleExportSessionAsHtml: () => void crud.exportSessionHtml(),
    committedThemeName,
    setPreviewThemeName,
    handleSetTheme,
    handleEditActiveIntent: intentEditor.openActive,
    handleCreateWorktree: (repoPath, name, initialCommand) =>
      void worktree.handleCreateWorktree(repoPath, name, initialCommand),
    handleClose: () => {
      const id = store.activeId();
      if (id) closeTerminal(id);
    },
    handleSleepActive: () => {
      const id = store.activeId();
      if (id) void crud.handleSleep(id);
    },
    handleWakeActive: () => {
      const id = store.activeId();
      if (id) void session.handleWake(id);
    },
    handleClearLocalStorage: () => {
      localStorage.clear();
      location.reload();
    },
    handleResetActiveTileSize: arrange.resetActiveTileSize,
    handleExportSession: () => exportSession(serverSavedSession()),
    handleImportSession: () =>
      void importSession().then(
        (s) => s && session.handleRestoreSession({ session: s }),
      ),
    simulateAlert: alerts.simulateAlert,
    canvasCenterActive: arrange.centerActive,
    canvasAutoArrange: arrange.handleCanvasAutoArrange,
    workspaceEntries,
    recencyOf,
  });

  /** The one content-kind dispatch for a sleeping tile's body — desktop AND
   *  mobile route through here so neither surface mounts xterm against a
   *  PTY-released terminal. Returns the dormant placeholder (intent/cwd/Wake)
   *  for a sleeping id, or `null` for a live id (the caller renders the live
   *  body in that case). */
  function renderSleepingBodyIfSleeping(id: TerminalId): JSX.Element | null {
    if (tileStore.contentOf(id)?.kind !== "sleeping") return null;
    const meta = sleepingArm(store.getMetadata(id));
    if (!meta) return null;
    return (
      <DormantTileBody meta={meta} onWake={() => void session.handleWake(id)} />
    );
  }

  /** Canvas tile body — every live tile stays mounted (`visible={true}`) so
   *  inactive xterms keep their grid sized correctly; only the focused tile
   *  takes keyboard focus. A sleeping tile renders the frozen dormant body
   *  instead (no PTY/xterm). */
  function renderCanvasTileBody(id: TerminalId, active: () => boolean) {
    return (
      renderSleepingBodyIfSleeping(id) ?? (
        <TerminalContent
          terminalId={id}
          visible={true}
          focused={active()}
          theme={getTerminalTheme(id)}
          onCloseTerminal={closeTerminal}
          onFocus={() => store.setActiveSilently(id)}
        />
      )
    );
  }

  /** Mobile body — only the active terminal is visible (others hide via
   *  the parent's classList) so xterm doesn't try to size a 0×0 element. A
   *  sleeping tile renders the dormant body instead. */
  function renderMobileTileBody(id: TerminalId, visible: () => boolean) {
    return (
      renderSleepingBodyIfSleeping(id) ?? (
        <TerminalContent
          terminalId={id}
          visible={visible()}
          focused={visible()}
          theme={getTerminalTheme(id)}
          onCloseTerminal={closeTerminal}
        />
      )
    );
  }

  // The one canvas-surface decision — which surface wins, in what order. The
  // precedence (and the #1034 / F3 correctness it carries) lives in
  // `useCanvasMode`; App just renders the chosen arm's layout.
  const mode = createMemo<CanvasMode>(() =>
    canvasMode({
      isLoading: session.isLoading,
      // Keyed off the TILE count: a sleeping-only workspace (PR 2) stays on the
      // canvas instead of falling back to the empty state. Today === terminal
      // count.
      terminalCount: () => tileStore.tileCount(),
    }),
  );
  // Narrow the tagged union for the down/warming arms. Plain functions, not
  // memos — they don't add to the shell's reactive-primitive budget.
  const downMode = () => {
    const m = mode();
    return m.kind === "down" ? m : undefined;
  };
  const warmingMode = () => {
    const m = mode();
    return m.kind === "warming" ? m : undefined;
  };

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
      <Show when={themeColor()}>
        {(color) => <Meta name="theme-color" content={color()} />}
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
        open={commandPalette.open()}
        onOpenChange={commandPalette.onOpenChange}
        initialGroup={commandPalette.initialGroup()}
        transparentOverlay={isPreviewingTheme()}
      />
      <ShortcutsHelp />
      <DiagnosticInfo activeId={store.activeId()} />
      <AboutDialog />
      <WelcomeDialog install={pwaInstall} />
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
          if (!target) return;
          // A sleeping tile has no PTY to kill — closing it DISCARDS the frozen
          // record (the same confirm, reworded). Routes to discardSleeping, not
          // a kill.
          if (target.meta.state === "sleeping") {
            void session.handleDiscardSleeping(target.id);
          } else {
            void crud.handleKillWithSubs(target.id);
          }
        }}
        onCloseAndRemove={() => {
          const target = closeConfirmTarget();
          setCloseConfirmTarget(null);
          if (target) void worktree.handleKillWorktree(target.id);
        }}
      />
      {/* Desktop chrome — docked top bar carrying identity and global
       *  controls. The workspace switcher retired in favor of the
       *  dock's mega level (#903). The touch layouts have their own
       *  pull-down sheet (see MobileTileView) and do not render this
       *  band. */}
      <Show when={isDesktop()}>
        <ChromeBar
          status={wsStatus()}
          onOpenPalette={() => commandPalette.openDialog()}
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
        {/* Exactly one canvas surface, chosen by `canvasMode` — a total,
            exclusive partition whose arm ORDER is the precedence (down beats
            empty per #1034; warming beats empty per F3). The decision lives in
            `useCanvasMode`; only the per-surface layout stays here.

            `<Switch>`, NOT a ts-pattern `match(mode())`, is load-bearing: the
            `mode` memo returns a FRESH `CanvasMode` object every recompute (any
            daemon-status / terminal-count tick), so a `{match(mode())…}` JSX
            expression re-runs and RE-CREATES the matched subtree on every such
            tick — remounting `TerminalCanvas`/`TerminalContent`, which makes
            Corvu re-fire `onCollapse` and silently collapses a just-opened
            sub-panel (the whole `sub-terminal.feature` regressed this way).
            `<Match when={mode().kind === "…"}>` keys on a STABLE boolean, so the
            arm persists while the kind is unchanged and only inner props update
            fine-grainedly. Keep this as `<Switch>`. */}
        <Switch>
          <Match when={mode().kind === "connecting"}>
            {/* Neutral connecting state until BOTH the session cell AND the
                daemon-status stream have produced their first value. */}
            <div class="flex items-center justify-center flex-1 text-fg-3 text-sm">
              Connecting...
            </div>
          </Match>
          <Match when={downMode()}>
            {(m) => <DegradedCanvas state={m().state} />}
          </Match>
          <Match when={warmingMode()}>
            {(m) => (
              <div
                data-testid="daemon-warming"
                data-daemon-state={m().daemonState}
                class="flex items-center justify-center flex-1 text-fg-3 text-sm canvas-grid-bg"
              >
                {m().label}
              </div>
            )}
          </Match>
          <Match when={mode().kind === "empty"}>
            <div
              data-testid="canvas-container"
              class="relative flex-1 min-h-0 canvas-grid-bg"
            >
              <CanvasWatermark text={appTitle()} />
              {/* The Dock stays mounted at zero terminals (desktop only) so its
               *  `+` new-terminal button is the always-reachable mouse path to
               *  the first terminal — the welcome card advertises ⌘⏎ but carries
               *  no clickable affordance (#1202). The empty Dock is just its
               *  header; the `relative` parent anchors its tiled-posture float
               *  (`top-12 left-4`), the only posture reachable at zero tiles.
               *  The touch layouts mount no tile view (and so no pull-down nav)
               *  at zero terminals — `EmptyState`'s own `onCreate` button is
               *  their tappable path to the first terminal instead. */}
              <Show when={isDesktop()}>
                <Dock {...dockPalette} />
              </Show>
              <EmptyState
                install={pwaInstall}
                savedSession={session.savedSession() ?? undefined}
                isRestoring={session.isRestoring()}
                onRestore={(opts) => void session.handleRestoreSession(opts)}
                onCreate={dockPalette.onCreate}
              />
            </div>
          </Match>
          <Match when={mode().kind === "workspace"}>
            {match(layoutMode())
              .with(P.union("phone", "compact"), (m) => {
                // One touch host for both handheld layouts: the same
                // bottom-sheet `RightPanelDrawer` wrapping a touch tile view.
                // They diverge only on two axes — the phone stacks its single
                // fullscreen tile in a column (`contentClass="flex-col"`) while
                // the roomier compact (Z Fold unfolded, tablets) keeps the
                // default row, and the tile view is `MobileTileView` vs
                // `CompactTileView`. The inner tile props are identical, so
                // they live in one `tileProps` object.
                //
                // The reactive reads stay GETTERS (not eager calls): Solid's JSX
                // prop spread preserves the getters (mergeProps-style, not an
                // eager copy), so each re-runs `orderedIds()` / `wsStatus()` /
                // `appTitle()` when the tile view reads the prop, and tracks them.
                // An eager `orderedIds: orderedIds()` would snapshot the value at
                // mount — a freshly-created terminal would never reach the body's
                // `<For each={props.orderedIds}>`.
                const tileProps = {
                  get orderedIds() {
                    return orderedIds();
                  },
                  get status() {
                    return wsStatus();
                  },
                  get appTitle() {
                    return appTitle();
                  },
                  onOpenPalette: () => commandPalette.openDialog(),
                  renderBody: renderMobileTileBody,
                  bottomBar: <MobileKeyBar />,
                };
                return (
                  <RightPanelDrawer
                    terminalId={store.active().id}
                    meta={store.active().meta}
                    themeName={activeThemeName()}
                    onThemeClick={() => commandPalette.openGroup("Set theme")}
                    contentClass={m === "phone" ? "flex-col" : undefined}
                  >
                    {/* `m` is a fixed match-arm value, not a signal, so a plain
                     *  ternary picks the tile view — no reactive `<Show>` needed. */}
                    {m === "phone" ? (
                      <MobileTileView {...tileProps} />
                    ) : (
                      <CompactTileView {...tileProps} />
                    )}
                  </RightPanelDrawer>
                );
              })
              .with("desktop", () => (
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
                      tileIds={tileStore.tileIds()}
                      watermark={appTitle()}
                      getLayout={tileStore.getLayout}
                      onLayoutChange={tileStore.setLayout}
                      onAutoArrange={arrange.handleCanvasAutoArrange}
                      onSelect={tileStore.setActiveSilently}
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
                          onSleep={() => void crud.handleSleep(id)}
                          onWake={() => void session.handleWake(id)}
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
                      terminalId={store.active().id}
                      meta={store.active().meta}
                      onToggle={rightPanel.togglePanel}
                      themeName={activeThemeName()}
                      onThemeClick={() => commandPalette.openGroup("Set theme")}
                      visible={!rightPanel.collapsed()}
                    />
                  </Resizable.Panel>
                </Resizable>
              ))
              .exhaustive()}
          </Match>
        </Switch>
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
