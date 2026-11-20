import Resizable from "@corvu/resizable";
import { activeArm, sleepingArm } from "@kolu/padi-client/surface";
import { attachPageZoomGuard } from "@kolu/solid-browser";
import { createPwaInstall } from "@kolu/solid-pwa-install";
import { Meta, Title } from "@solidjs/meta";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { Toaster } from "solid-sonner";
import AboutDialog from "./AboutDialog";
import TileTip from "./agents/TileTip";
import { useAttention } from "./attention/useAttention";
import ChromeBar from "./ChromeBar";
import CanvasCreateSurface from "./CanvasCreateSurface";
import CloseConfirm, { type CloseConfirmSnapshot } from "./CloseConfirm";
import CommandPalette from "./CommandPalette";
import CompactTileView from "./CompactTileView";
import Dock from "./canvas/dock/Dock";
import { useDockFocus } from "./canvas/dock/useDockFocus";
import { useDockOrder } from "./canvas/dock/useDockOrder";
import TerminalCanvas from "./canvas/TerminalCanvas";
import TileTitleActions from "./canvas/TileTitleActions";
import { useCanvasArrange } from "./canvas/useCanvasArrange";
import { createCommands } from "./commands";
import DiagnosticInfo from "./DiagnosticInfo";
import EmptyState from "./EmptyState";
import ExportSessionDialog, {
  exportSessionDialog,
} from "./ExportSessionDialog";
import BootStalledCanvas from "./host/BootStalledCanvas";
import { ConnectCanvas } from "./host/ConnectCanvas";
import HostDiagnosticsHost from "./host/HostDiagnosticsHost";
import HostDownCanvas from "./host/HostDownCanvas";
import { hostHue, hostLabel } from "./host/hostChipTone";
import { savedSession as serverSavedSession } from "./hostScope/activeWire";
import { createImportSessionAction } from "./importSessionAction";
import { useShortcuts } from "./input/useShortcuts";
import IntentEditorDialog from "./intent/IntentEditorDialog";
import { useIntentEditor } from "./intent/useIntentEditor";
import DegradedCanvas from "./kaval/DegradedCanvas";
import { type CanvasMode, canvasMode } from "./kaval/useCanvasMode";
import MobileKeyBar from "./MobileKeyBar";
import MobilePullChrome from "./MobilePullChrome";
import ConductorPane from "./conductor/ConductorPane";
import { Shown } from "./ui/shown";
import {
  conductorEverSelected,
  conductorMode,
} from "./conductor/useConductorMode";
import { NEW_TERMINAL_GROUP } from "./palette/newTerminalGroup";
import { TERMINALS_GROUP_NAME } from "./palette/terminalsGroup";
import WebcamOverlay from "./recorder/WebcamOverlay";
import RightPanel from "./right-panel/RightPanel";
import RightPanelDrawer from "./right-panel/RightPanelDrawer";
import { useRightPanel } from "./right-panel/useRightPanel";
import { wsStatus } from "./rpc/rpc";
import TransportOverlay from "./rpc/TransportOverlay";
import { runAction } from "./runAction";
import ShortcutsHelp from "./ShortcutsHelp";
import StateBackupsDialog from "./StateBackupsDialog";
import { exportSession, importSession } from "./sessionTransfer";
import TipBanner from "./settings/TipBanner";
import { useColorScheme } from "./settings/useColorScheme";
import { useTips } from "./settings/useTips";
import TerminalContent from "./terminal/TerminalContent";
import TerminalMeta from "./terminal/TerminalMeta";
import { useTerminals } from "./terminal/useTerminals";
import { WorkspaceTerminals } from "./terminal/WorkspaceTerminals";
import { useTileStore } from "./tile/useTileStore";
import { controlledSizes, realSizes } from "./ui/corvuResizable";
import { refocusTerminal } from "./ui/ModalDialog";
import { Z_HANDLE_OUTER } from "./ui/stackLayers";
import { useActionContext } from "./useActionContext";
import { useCommandPalette } from "./useCommandPalette";
import { useDeepLinks } from "./useDeepLinks";
import { isDesktop, layoutMode } from "./useMobile";
import { useServerIdentity } from "./useServerIdentity";
import { useThemeManager } from "./useThemeManager";
import { useVisualViewportHeight } from "./useVisualViewportHeight";
import WelcomeDialog from "./WelcomeDialog";
import { activeHost, activePadiRpc, hostKeys, setActiveHost } from "./wire";

const App: Component = () => {
  const { store, crud, session, worktree, getSubject } = useTerminals();
  const focus = useDockFocus();
  const attention = useAttention({
    activeId: store.activeId,
    focusedId: store.focusedTerminalId,
    activate: focus,
    activeSubject: getSubject,
    terminalIds: store.terminalIds,
    activeAgentState: (id) => activeArm(store.getMetadata(id))?.agent?.state,
  });
  useDeepLinks();
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
  const rightPanelSizes = controlledSizes(() =>
    rightPanel.collapsed()
      ? [1, 0]
      : [1 - rightPanel.panelSize(), rightPanel.panelSize()],
  );
  const { colorScheme } = useColorScheme();
  const { appTitle, themeColor } = useServerIdentity();
  const commandPalette = useCommandPalette();

  const dockTree = useDockOrder();
  const orderedIds = (): TerminalId[] =>
    dockTree().flatShortcutRows.map((r) => r.id);

  const [closeConfirmTarget, setCloseConfirmTarget] =
    createSignal<CloseConfirmSnapshot | null>(null);

  const { initTipTriggers } = useTips();
  initTipTriggers({ terminalIds: store.terminalIds });

  useVisualViewportHeight();

  onCleanup(attachPageZoomGuard(window));

  const pwaInstall = createPwaInstall();

  const intentEditor = useIntentEditor();

  const arrange = useCanvasArrange();

  const actionContext = useActionContext();
  useShortcuts(actionContext);

  const dockPalette = {
    onCreate: () => commandPalette.openGroup(NEW_TERMINAL_GROUP),
    onOpenWorkspaceSearch: () =>
      commandPalette.openPath([TERMINALS_GROUP_NAME, hostLabel(activeHost())]),
  };

  function closeTerminal(id: TerminalId) {
    const meta = store.getMetadata(id);
    if (!meta) return;
    if (meta.parentId) {
      runAction(
        sleepingArm(meta) ? "discard terminal" : "close terminal",
        crud.closeOne(id),
      );
      return;
    }
    const splitCount = store.getDisplayInfo(id)?.subCount ?? 0;
    const worktreePath =
      meta.git.kind === "repo" && meta.git.info.isWorktree
        ? meta.git.info.worktreePath
        : undefined;
    const worktreeRemoval = worktreePath
      ? store.isWorktreeShared(worktreePath, id)
        ? ({ eligible: false, reason: "sharedWithOtherTerminals" } as const)
        : ({ eligible: true } as const)
      : undefined;
    setCloseConfirmTarget({ id, meta, splitCount, worktreeRemoval });
  }

  const runImportSession = createImportSessionAction({
    pick: importSession,
    runImport: ({ session }) => activePadiRpc.session.import({ session }),
  });

  const commands = createCommands({
    ...actionContext,
    handleCopyTerminalText: () =>
      runAction("copy terminal text", crud.handleCopyTerminalText()),
    handleCopyTerminalId: () =>
      runAction("copy terminal ID", crud.handleCopyTerminalId()),
    handleRunInActiveTerminal: (cmd) =>
      runAction("prefill command", crud.handleRunInActiveTerminal(cmd)),
    handleExportScrollbackAsPdf: crud.exportScrollbackPdf,
    handleExportSessionAsHtml: () => exportSessionDialog.openDialog(),
    committedThemeName,
    setPreviewThemeName,
    handleSetTheme,
    handleEditActiveIntent: intentEditor.openActive,
    handleCreateWorktree: (repoPath, name, initialCommand) =>
      runAction(
        "create worktree",
        worktree.handleCreateWorktree(repoPath, name, initialCommand),
      ),
    handleClose: () => {
      const id = store.activeId();
      if (id) closeTerminal(id);
    },
    handleClearLocalStorage: () => {
      localStorage.clear();
      location.reload();
    },
    handleResetActiveTileSize: arrange.resetActiveTileSize,
    handleExportSession: () => exportSession(serverSavedSession()),
    handleImportSession: () => runAction("import session", runImportSession()),
    simulateAlert: attention.simulateAlert,
    canvasCenterActive: arrange.centerActive,
    canvasAutoArrange: arrange.handleCanvasAutoArrange,
    hostKeys,
    activeHost,
    switchHost: setActiveHost,
  });

  const renderTerminalBody = (
    id: TerminalId,
    seen: () => boolean,
    boxDecided: () => boolean,
  ) => (
    <TerminalContent
      terminalId={id}
      visible={seen()}
      boxDecided={boxDecided()}
      focused={tileStore.isActiveTile(id)}
      theme={getTerminalTheme(id)}
      onCloseTerminal={closeTerminal}
      onFocus={() => store.setActiveSilently(id)}
    />
  );

  const canvasShown = () => !conductorMode();

  const mode = createMemo<CanvasMode>(() =>
    canvasMode({
      isLoading: session.isLoading,
      terminalCount: () => tileStore.tileCount(),
      recordsAwaited: () => store.recordPhases().awaited,
    }),
  );
  const requireKind = <K extends CanvasMode["kind"], T>(
    kind: K,
    pick: (m: Extract<CanvasMode, { kind: K }>) => T,
    label: string,
  ): T => {
    const m = mode();
    if (m.kind !== kind) {
      throw new Error(
        `canvas Match ${label}: expected kind ${kind}, got ${m.kind}`,
      );
    }
    return pick(m as Extract<CanvasMode, { kind: K }>);
  };
  const downState = () => requireKind("down", (m) => m.down, "down");
  const bootStalledRecovery = () =>
    requireKind("boot-stalled", (m) => m.recovery, "boot-stalled");
  const warmingDaemonState = () => {
    const m = mode();
    return m.kind === "warming" ? m.daemonState : undefined;
  };

  return (
    <div
      data-testid="app-root"
      class="relative flex flex-col bg-surface-0 text-fg font-sans"
      style={{
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
        initialPath={commandPalette.initialPath()}
        transparentOverlay={isPreviewingTheme()}
      />
      <ShortcutsHelp />
      <HostDiagnosticsHost />
      <DiagnosticInfo activeId={store.activeId()} />
      <StateBackupsDialog />
      <AboutDialog />
      <WelcomeDialog install={pwaInstall} />
      <ExportSessionDialog />
      <CloseConfirm
        target={closeConfirmTarget()}
        onCancel={() => {
          setCloseConfirmTarget(null);
          requestAnimationFrame(refocusTerminal);
        }}
        onClose={() => {
          const target = closeConfirmTarget();
          setCloseConfirmTarget(null);
          if (!target) return;
          if (sleepingArm(target.meta))
            runAction(
              "discard terminal",
              crud.handleDiscard(target.id).pipe(Effect.ignore),
            );
          else runAction("close terminal", crud.handleKillWithSubs(target.id));
        }}
        onCloseAndRemove={() => {
          const target = closeConfirmTarget();
          setCloseConfirmTarget(null);
          if (target)
            runAction(
              "close terminal and remove worktree",
              worktree.handleKillWorktree(target.id),
            );
        }}
      />
      <Show when={isDesktop()}>
        <ChromeBar
          status={wsStatus()}
          onOpenPalette={() => commandPalette.openDialog()}
        />
      </Show>
      <Show when={!isDesktop()}>
        <MobilePullChrome
          status={wsStatus()}
          appTitle={appTitle()}
          onOpenPalette={() => commandPalette.openDialog()}
        />
      </Show>
      <div
        class="relative flex flex-1 min-h-0"
        style={{
          "--active-terminal-bg":
            activeTheme().background ?? "var(--color-surface-1)",
          "--active-terminal-fg": activeTheme().foreground ?? "var(--color-fg)",
          "--canvas-hue": hostHue(activeHost()),
        }}
      >
        <Switch>
          <Match when={mode().kind === "connecting"}>
            <ConnectCanvas daemonState={undefined} />
          </Match>
          <Match when={mode().kind === "down"}>
            <DegradedCanvas down={downState()} />
          </Match>
          <Match when={mode().kind === "host-failed"}>
            <HostDownCanvas />
          </Match>
          <Match when={mode().kind === "boot-stalled"}>
            <BootStalledCanvas recovery={bootStalledRecovery()} />
          </Match>
          <Match when={mode().kind === "warming"}>
            <ConnectCanvas daemonState={warmingDaemonState()} />
          </Match>
          <Match when={mode().kind === "empty"}>
            <CanvasCreateSurface
              onCreate={dockPalette.onCreate}
              backdrop={
                <EmptyState
                  install={pwaInstall}
                  savedSession={session.savedSession() ?? undefined}
                  isRestoring={session.isRestoring()}
                  isForfeiting={session.isForfeiting()}
                  onRestore={(opts) =>
                    runAction(
                      "restore session",
                      session.handleRestoreSession(opts),
                    )
                  }
                  onForfeit={() =>
                    runAction("start fresh", session.handleForfeitSession())
                  }
                  onCreate={dockPalette.onCreate}
                />
              }
            >
              <Show when={isDesktop()}>
                <Dock {...dockPalette} />
              </Show>
            </CanvasCreateSurface>
          </Match>
          <Match when={mode().kind === "workspace"}>
            <WorkspaceTerminals
              ids={isDesktop() ? tileStore.tileIds() : orderedIds()}
              renderBody={renderTerminalBody}
            >
              {(outlet) => (
                <Switch>
                  <Match when={!isDesktop()}>
                    <RightPanelDrawer
                      terminalId={store.focused().id}
                      meta={store.focused().meta}
                      tileId={store.active().id}
                      themeName={activeThemeName()}
                      onThemeClick={() => commandPalette.openGroup("Set theme")}
                      contentClass={
                        layoutMode() === "phone" ? "flex-col" : undefined
                      }
                    >
                      <CompactTileView
                        compact={layoutMode() === "compact"}
                        orderedIds={orderedIds()}
                        renderBody={outlet}
                        bottomBar={<MobileKeyBar />}
                      />
                    </RightPanelDrawer>
                  </Match>
                  <Match when={isDesktop()}>
                    <Resizable
                      orientation="horizontal"
                      sizes={rightPanelSizes()}
                      onSizesChange={(sizes) => {
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
                        <Shown.Provider value={canvasShown}>
                          <TerminalCanvas
                            tileIds={tileStore.tileIds()}
                            getLayout={tileStore.getLayout}
                            onLayoutChange={tileStore.setLayout}
                            onAutoArrange={arrange.handleCanvasAutoArrange}
                            onSelect={tileStore.setActiveSilently}
                            onClose={(id) => closeTerminal(id)}
                            {...dockPalette}
                            renderTileTitle={(id) => (
                              <TerminalMeta
                                terminalId={id}
                                info={store.getDisplayInfo(id)}
                                meta={store.getMetadata(id)}
                                unread={store.isUnread(id)}
                                onOpenIntent={() =>
                                  intentEditor.openTerminal(id)
                                }
                              />
                            )}
                            renderTileTitleActions={(id) => (
                              <TileTitleActions id={id} host={activeHost()} />
                            )}
                            renderTileBar={(id) => <TileTip id={id} />}
                            renderTileBody={outlet}
                          />
                        </Shown.Provider>
                      </Resizable.Panel>
                      <Show when={!rightPanel.collapsed()}>
                        <Resizable.Handle
                          data-testid="right-panel-handle"
                          startIntersection={false}
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
                          terminalId={store.focused().id}
                          meta={store.focused().meta}
                          tileId={store.active().id}
                          onToggle={rightPanel.togglePanel}
                          themeName={activeThemeName()}
                          onThemeClick={() =>
                            commandPalette.openGroup("Set theme")
                          }
                          visible={!rightPanel.collapsed()}
                        />
                      </Resizable.Panel>
                    </Resizable>
                  </Match>
                </Switch>
              )}
            </WorkspaceTerminals>
          </Match>
        </Switch>
        <Show when={conductorEverSelected()}>
          <div
            class="absolute inset-0 z-[45]"
            style={{
              "content-visibility": conductorMode() ? "visible" : "hidden",
            }}
            inert={!conductorMode()}
            aria-hidden={!conductorMode()}
          >
            <Shown.Provider value={conductorMode}>
              <ConductorPane class="absolute inset-0" />
            </Shown.Provider>
          </div>
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
