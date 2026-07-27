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

import Resizable from "@corvu/resizable";
import { activeArm, sleepingArm } from "@kolu/padi/surface";
import { createPwaInstall } from "@kolu/solid-pwa-install";
import { Meta, Title } from "@solidjs/meta";
import type { TerminalId } from "kolu-common/surface";
import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";
import {
  type Component,
  createMemo,
  createSignal,
  Match,
  Show,
  Switch,
} from "solid-js";
import { Toaster } from "solid-sonner";
import { match, P } from "ts-pattern";
import AboutDialog from "./AboutDialog";
import { useAttention } from "./attention/useAttention";
import ChromeBar from "./ChromeBar";
import CloseConfirm, { type CloseConfirmTarget } from "./CloseConfirm";
import CommandPalette from "./CommandPalette";
import CompactTileView from "./CompactTileView";
import Dock from "./canvas/dock/Dock";
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
import type { LogLine } from "./host/CanvasFailureCard";
import { ConnectCanvas } from "./host/ConnectCanvas";
import HostDownCanvas from "./host/HostDownCanvas";
import { hostHue, hostLabel } from "./host/hostChipTone";
import { savedSession as serverSavedSession } from "./hostScope/activeWire";
import { createImportSessionAction } from "./importSessionAction";
import { useShortcuts } from "./input/useShortcuts";
import IntentEditorDialog from "./intent/IntentEditorDialog";
import { useIntentEditor } from "./intent/useIntentEditor";
import DegradedCanvas from "./kaval/DegradedCanvas";
import { type CanvasMode, canvasMode } from "./kaval/useCanvasMode";
import { activeEntryState } from "./kaval/useDaemonStatus";
import MobileKeyBar from "./MobileKeyBar";
import MobilePullChrome from "./MobilePullChrome";
import MobileTileView from "./MobileTileView";
import { TERMINALS_GROUP_NAME } from "./palette/terminalsGroup";
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
import { realSizes } from "./ui/corvuResizable";
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
import {
  activeHost,
  activePadiRpc,
  connectionInfo,
  hostKeys,
  setActiveHost,
} from "./wire";

const App: Component = () => {
  const { store, crud, session, worktree, getSubject } = useTerminals();
  // Attention (the ONE owner): every host runs the same rules — sound + OS popup +
  // app badge + host marks + dock unread — off each host's `urgency` cell, with the
  // active host supplying rich copy / dock unread. `store.activate` focuses a tile
  // on the (post-switch) active host. See `useAttention`.
  const attention = useAttention({
    activeId: store.activeId,
    activate: store.activate,
    markUnread: store.markUnread,
    activeSubject: getSubject,
    terminalIds: store.terminalIds,
    activeAgentState: (id) => activeArm(store.getMetadata(id))?.agent?.state,
  });
  // Deep links: a `#/…` URL (bookmark, orchestrator tag, PWA launch) commands the
  // view onto a host / terminal / file / settings — through the SAME view actions,
  // view-only by law. See `useDeepLinks`.
  useDeepLinks();
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

  // Dock row order for Cmd+1..9 (active host). The switcher indexes the
  // fleet separately via useFleetTerminalIndex in createCommands.
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
    // Dock search → host-scoped terminal list (Terminals › $activeHost).
    onOpenWorkspaceSearch: () =>
      commandPalette.openPath([TERMINALS_GROUP_NAME, hostLabel(activeHost())]),
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

  // Import runs host-side now (padi is the one restore writer): replace the
  // persisted session with the picked blob and restore it in one RPC. The
  // client-side view-state seeds via the hydration effect once the restored
  // terminals arrive, exactly as `session.restore` does. The re-entry guard +
  // loading/success/error toast round-trip live in `createImportSessionAction`
  // (a plain closure, so it doesn't spend the shell's reactive-primitive
  // budget; see App.shell.test.ts). Created once at setup so the in-flight
  // guard persists across invocations.
  const runImportSession = createImportSessionAction({
    pick: importSession,
    runImport: ({ session }) => activePadiRpc.session.import({ session }),
  });

  const commands = createCommands({
    ...actionContext,
    handleCopyTerminalText: () => void crud.handleCopyTerminalText(),
    handleCopyTerminalId: () => void crud.handleCopyTerminalId(),
    handleRunInActiveTerminal: (cmd) => crud.handleRunInActiveTerminal(cmd),
    handleExportScrollbackAsPdf: crud.exportScrollbackPdf,
    handleExportSessionAsHtml: () => exportSessionDialog.openDialog(),
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
    handleClearLocalStorage: () => {
      localStorage.clear();
      location.reload();
    },
    handleResetActiveTileSize: arrange.resetActiveTileSize,
    handleExportSession: () => exportSession(serverSavedSession()),
    handleImportSession: () => void runImportSession(),
    simulateAlert: attention.simulateAlert,
    canvasCenterActive: arrange.centerActive,
    canvasAutoArrange: arrange.handleCanvasAutoArrange,
    hostKeys,
    activeHost,
    switchHost: setActiveHost,
  });

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
        onCloseTerminal={closeTerminal}
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
        onCloseTerminal={closeTerminal}
      />
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
      // How many listed terminals' records haven't composed yet — lets the pure
      // resolver hold `connecting` over `empty` while a reload's live terminals are
      // still in flight, so the restore card can't flash before they appear.
      recordsAwaited: () => store.recordPhases().awaited,
    }),
  );
  // Payload readers for thrash-sensitive canvas arms. Plain functions, not
  // memos — they don't add to the shell's reactive-primitive budget.
  // Key every Match on `mode().kind === "…"` (stable boolean): `mode()` is a
  // fresh object every getMonotonicNow tick (boot-deadline accrual), so an
  // object-valued `when` remounts the arm ~1 Hz and wipes local state (elapsed
  // baseline on ConnectCanvas #1962; focus/action identity on BootStalledCanvas).
  // Fail loud (not `!`) if the arm is active without its payload — unrepresentable.
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
  // The failed episode as ONE value. `cause`, `reason` and the retained output tail are
  // three fields of ONE `EntryStatus` (`padiMap.entry(activeHost()).state()`), so they are
  // read together, under one guard, at the arm that renders them — never two accessors with
  // two policies over the same value (which is how the tail came to be collected, shipped,
  // and then dropped unread while the reason was shown). `log` stays `undefined` rather
  // than collapsing to `[]`: the map's liveness floor DROPS `connection` over a dead link
  // while keeping `failure`, and "we cannot see the output" must not render as "the failure
  // produced none". The session carries the tail FORWARD into its `failed` arm
  // (see surface-remote/session.ts's `setDown`), so these are the lines of the episode that
  // actually gave up.
  const hostFailure = (): {
    cause: EntryFailedCause;
    reason: string;
    log: readonly LogLine[] | undefined;
  } => {
    const s = activeEntryState();
    if (s.kind !== "failed") {
      throw new Error(`canvas Match host-failed: entry is ${s.kind}`);
    }
    return {
      cause: s.failure.cause,
      reason: s.failure.reason,
      log: s.connection?.log,
    };
  };
  const bootStalledRecovery = () =>
    requireKind("boot-stalled", (m) => m.recovery, "boot-stalled");
  // Warming arm's kaval restart state (undefined while a remote provision
  // narrates off the connection cell) — undefined is a valid payload here.
  const warmingDaemonState = () => {
    const m = mode();
    return m.kind === "warming" ? m.daemonState : undefined;
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
        initialPath={commandPalette.initialPath()}
        transparentOverlay={isPreviewingTheme()}
      />
      <ShortcutsHelp />
      <DiagnosticInfo activeId={store.activeId()} />
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
          // Don't refocus — the natural reactive focus handlers (sub-panel,
          // active terminal) restore focus to the right place after the kill.
          // A sleeping terminal has no PTY to kill: DISCARD its record instead.
          if (!target) return;
          if (sleepingArm(target.meta)) void crud.handleDiscard(target.id);
          else void crud.handleKillWithSubs(target.id);
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
      {/* Touch chrome — the pull-down handle + chrome sheet (global controls +
       *  the host row), the mobile analog of the desktop ChromeBar. Rendered
       *  HERE, a sibling above the canvas `<Switch>`, so the host row stays
       *  reachable in EVERY canvas mode — including while a host is
       *  connecting/warming or down, which replace the workspace tile view with
       *  a full-screen status canvas. (It used to live inside MobileTileView,
       *  so switching to a not-yet-connected host stranded the user with no way
       *  to switch back.) */}
      <Show when={!isDesktop()}>
        <MobilePullChrome
          status={wsStatus()}
          appTitle={appTitle()}
          onOpenPalette={() => commandPalette.openDialog()}
        />
      </Show>
      {/* relative: anchor for overlay panels.
       *  --active-terminal-{bg,fg} published here so child components
       *  can read them via CSS without prop drilling. The fg lets sub-
       *  components re-tune text tiers against the terminal theme.
       *  --canvas-hue is the ACTIVE host's identity hue, published on this
       *  ONE wrapper that spans every canvas surface (empty · populated ·
       *  connecting · degraded · host-down) so the `.canvas-grid-bg` floor
       *  in ALL of them picks it up by inheritance and re-tints reactively
       *  the instant `activeHost` changes — no per-surface wiring. */}
      <div
        class="relative flex flex-1 min-h-0"
        style={{
          "--active-terminal-bg":
            activeTheme().background ?? "var(--color-surface-1)",
          "--active-terminal-fg": activeTheme().foreground ?? "var(--color-fg)",
          "--canvas-hue": hostHue(activeHost()),
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
            {/* Neutral connecting state until BOTH the session cell AND the daemon-status
                stream have produced their first value. Funnels through `ConnectCanvas` (the
                ONE not-yet-connected renderer) with no `daemonState` — so it shows the SAME
                "Connecting to <host>…" copy as the `warming` overlay's gap/probing case, and a
                routing flap between the two modes produces identical pixels (no flicker). */}
            <ConnectCanvas daemonState={undefined} />
          </Match>
          <Match when={mode().kind === "down"}>
            {/* Boolean kind key — same thrash rule as warming (#1962). Payload via
                accessors (not object-valued `when`, which remounts ~1 Hz). Kind
                narrows: when this arm is active the payload is defined. */}
            <DegradedCanvas down={downState()} />
          </Match>
          <Match when={mode().kind === "host-failed"}>
            {/* The ACTIVE host's map-membership entry failed (ssh/contract fault,
                cause-typed) — distinct from `down` (a connected host's dead kaval).
                Its own surface: cause-typed copy + [Switch to local], no Retry. */}
            <HostDownCanvas failure={hostFailure()} />
          </Match>
          <Match when={mode().kind === "boot-stalled"}>
            {/* #1763 + #1908 D2: a boot overlay held past its per-host ceiling, rendered off the
                resolver's honest {@link BootStalledRecovery} verdict — a warming-remote campaign
                the server connector still owns (non-terminal copy, [Retry connection] → recheck())
                vs a genuinely client-side leg ([Reload]). A hung LOCAL kaval takes the down/dead
                arm above instead (byte-identical #1713). Boolean kind key so focus/action
                identity on BootStalledCanvas survives monotonic mode() thrash. */}
            <BootStalledCanvas
              recovery={bootStalledRecovery()}
              log={connectionInfo()?.log}
            />
          </Match>
          <Match when={mode().kind === "warming"}>
            {/* The host binding is coming up. `ConnectCanvas` narrates a REMOTE cold
                provision off the connection cell (probing → provisioning, live log tail +
                elapsed) instead of a mute "Connecting…"; a kaval-restart warming
                (daemonState defined) keeps the neutral label.
                Key on the STABLE boolean `kind === "warming"` — NOT a mode object.
                `mode()` is a fresh object every getMonotonicNow tick (boot-deadline
                accrual); an object-keyed Match remounted ConnectCanvas every second,
                wiping its elapsed baseline so the timer only jumped when a log frame
                arrived (#1962). Boolean `when` keeps the arm mounted while kind holds. */}
            <ConnectCanvas daemonState={warmingDaemonState()} />
          </Match>
          <Match when={mode().kind === "empty"}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: the zero-terminal canvas surface is the same pointer-driven canvas widget as TerminalCanvas (which lives in biome's spatial-mouse-canvas a11y override) — double-click-to-create's keyboard equivalent is the ⌘K/⌘T palette it opens, so role/tabIndex/fake onKeyDown would claim a11y it doesn't deliver. Scoped inline because App.tsx is the composition root, not a dedicated canvas file that warrants a file-wide override. */}
            <div
              data-testid="canvas-container"
              class="relative flex-1 min-h-0 canvas-grid-bg"
              // Double-click the bare welcome surface to open the "New terminal"
              // flow — the SAME `onCreate` the populated canvas (TerminalCanvas)
              // and the dock's `+` reach, so the affordance is identical at zero
              // terminals or many. Guarded to the background
              // (`target === currentTarget`): EmptyState centers its card under a
              // `pointer-events-none` wrapper (the contract lives there), so a
              // bare-area double-click targets THIS container, while one on the
              // card or the dock targets that element instead and is left alone.
              onDblClick={(e) => {
                if (e.target === e.currentTarget) dockPalette.onCreate();
              }}
            >
              {/* The Dock stays mounted at zero terminals (desktop only) so its
               *  `+` new-terminal button is the always-reachable mouse path to
               *  the first terminal — the welcome card advertises ⌘⏎ but carries
               *  no clickable affordance (#1202). The empty Dock is just its
               *  header; the `relative` parent anchors its tiled-posture float
               *  (`top-16 left-4`), the only posture reachable at zero tiles.
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
                onForfeit={() => void session.handleForfeitSession()}
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
                // The reactive read stays a GETTER (not an eager call): Solid's
                // JSX prop spread preserves the getter (mergeProps-style, not an
                // eager copy), so it re-runs `orderedIds()` when the tile view
                // reads the prop, and tracks it. An eager `orderedIds:
                // orderedIds()` would snapshot the value at mount — a
                // freshly-created terminal would never reach the body's
                // `<For each={props.orderedIds}>`. (The chrome props — status /
                // appTitle / onOpenPalette — moved to `MobilePullChrome` above,
                // which is why they're no longer threaded through here.)
                const tileProps = {
                  get orderedIds() {
                    return orderedIds();
                  },
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
                          onOpenIntent={() => intentEditor.openTerminal(id)}
                        />
                      )}
                      renderTileTitleActions={(id) => (
                        <TileTitleActions id={id} />
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
