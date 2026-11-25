/** Right panel state — singleton module.
 *
 *  Three storage layers because the right panel has three volatilities:
 *
 *  - **Workspace chrome** (size, codeTabTreeSize) lives on
 *    `preferences.rightPanel` — global to the user, set once and forgotten.
 *    `size`/`codeTabTreeSize` drive the desktop Resizable's width + the Code-tab
 *    tree/content split (viewer density taste, tuned once, left put), each with a
 *    real writer (`setPanelSize`/`setCodeTabTreeSize`). The NEW-TERMINAL collapsed
 *    default, used when there is no active terminal to inherit from, is a
 *    separate top-level `preferences.newTerminalCollapsed` seed (not
 *    on this record) — a copy-on-create default; the LIVE collapsed state follows
 *    the tile (below).
 *  - **Touch-layout drawer open state** (phone + compact) is session-local, NOT
 *    persisted. Dismissing the bottom-drawer host on a handheld is an ephemeral
 *    gesture; persisting it into account prefs would mean the next desktop
 *    session opens with the panel collapsed for reasons the user never
 *    expressed on desktop.
 *  - **Per-terminal task state** (collapsed, activeTab, codeMode, per-mode
 *    selected file) lives in an in-memory store keyed by terminal id; mutations
 *    push to the server via padi's `chrome.setRightPanel`, which writes
 *    `TerminalMetadata.rightPanel` for session restore. Pattern mirrors
 *    `useSubPanel.ts` for `activeTab`/`codeMode`/`selectedFileByMode`.
 *    Persisted per-terminal via session restore, so it survives a reload.
 *
 *  ── ONE RECORD PER TERMINAL, TWO SUBJECTS (read this before editing a read) ──
 *  The panel splits its subject in two, and `collapsed` is the odd one out:
 *
 *  - **Open/closed (`collapsed`) belongs to the TILE** (`store.activeId()`).
 *    Moving focus between panes of one tile must never open/close the panel or
 *    shift layout, so visibility is a property of the tile you are looking at.
 *    The posture travels with the tile via `TerminalMetadata.rightPanel` (#959) —
 *    a PR-review tile keeps its panel open while a build-log tile keeps its
 *    closed — and a tile's record is its record.
 *    **A split's own `collapsed` field is simply not read while it is a split.**
 *    It is not removed (no schema change): every terminal carries the same
 *    `RightPanelPerTerminalState` shape, a split's record is written by
 *    `adoptTileCollapsed` at promotion so a split handed its own tile inherits
 *    the posture of the tile it left, and session restore seeds it for every
 *    listed terminal exactly as before.
 *  - **Tab, code mode, per-mode selected file, and the back/forward history
 *    belong to the FOCUSED PANE** (`store.focusedTerminalId()`) — main or any
 *    split, at any nesting depth. Each split remembers its own tab and its own
 *    file; returning to main restores main's. This is what makes the panel
 *    follow focus into a split running an agent in another repo.
 *
 *  Callers read/write through the parameterless API; it resolves the tile via
 *  `store.activeId()` and the pane via `store.focusedTerminalId()` internally. */

import {
  type CodeTabView,
  DEFAULT_RIGHT_PANEL_PER_TERMINAL,
  type RightPanelPerTerminalState,
  type RightPanelTab,
  rightPanelView,
} from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, createSignal, createStore } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { runAction } from "../runAction";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileStore } from "../tile/useTileStore";
import { isDesktop } from "../useMobile";
import {
  activeHost,
  activePadiRpc,
  padiRpcOf,
  preferences,
  updatePreferences,
} from "../wire";
import { codeLister, codeModeFor } from "../code-view/codeLister";
import {
  type CodeViewState,
  codeHistoryVerbs,
  createCodeHistories,
  selectionWith,
} from "../code-view/codeViewState";

const MIN_PANEL_SIZE = 0.05;
/** The smallest share of a Code view's split either pane may be dragged to,
 *  in either arrangement, so neither the tree nor the file collapses to
 *  nothing. The tree's share therefore lies in [floor, 1 − floor]: the band
 *  every writer of a tree share accepts, and each pane's Corvu `minSize`.
 *  Mirrors `MIN_PANEL_SIZE`'s role for the Right panel's own split. */
export const MIN_CODE_PANE_SHARE = 0.1;
/** Drop a size write that matches the value already stored. Corvu reports
 *  only real changes — a controlled root never echoes the `sizes` prop back
 *  (`ui/corvuResizable.ts` holds the corvu-read lore) — but the prop and the
 *  store DIVERGE while the panel is collapsed: the prop reads `[1, 0]` while
 *  the store keeps the remembered share. So a genuine report, from a panel
 *  registering during restart churn or from the layout pass on expand, can
 *  carry exactly the share we already hold, and persisting it is pure noise
 *  (#1041). Corvu rounds sizes to 6 decimals, so a tolerance below that
 *  catches those without dropping a real one-pixel drag step. */
const SIZE_EPSILON = 1e-6;

const [perTerminal, setPerTerminal] = createStore<
  Record<TerminalId, RightPanelPerTerminalState>
>({});

/** Session-local visibility of the touch-layout bottom-drawer host (phone +
 *  compact). Distinct from the per-terminal `collapsed` bit so dismissing the
 *  drawer on a handheld doesn't cross-contaminate the desktop panel state.
 *  `RightPanelDrawer` (the touch-layout host) owns the open/close gestures; the
 *  desktop Resizable ignores this signal entirely. */
const [drawerOpen, setDrawerOpen] = createSignal(false);

/** Per-terminal navigation history — the back/forward stack of each pane's
 *  Code tab, bundled with the repo it was captured against
 *  ({@link createCodeHistories}: seeded in `seedHistory`, dropped in
 *  `removePanel`, reset on a repo change).
 *
 *  In-memory only: history is session-local, and the persisted
 *  `selectedFileByMode` remains the single render + restore truth. The stack
 *  only *records* the sequence of visited locations so back/forward can
 *  re-apply earlier ones.
 *
 *  Keyed per terminal (not a single "previously active" value) on purpose: a
 *  terminal's repo can change while it is INACTIVE — a `cd` in its PTY updates
 *  its server metadata even though the Code tab isn't watching it. Comparing
 *  only against the immediately previous active tuple would miss that and let
 *  a stale A-relative stack replay against A's new repo on switch-back.
 *  Per-terminal tracking catches it whenever the terminal next becomes
 *  active. */
const histories = createCodeHistories<TerminalId>();

/** The state a terminal with no record yet reads/seeds as. Every field is the
 *  static `DEFAULT_RIGHT_PANEL_PER_TERMINAL` EXCEPT `collapsed`, which reads
 *  through the user's NEW-TERMINAL default from `preferences.newTerminalCollapsed`
 *  — a top-level copy-on-create seed (same seed shape as `newTerminalTheme`,
 *  though that one has a settings writer and this does not yet), after which the
 *  terminal owns its own `collapsed`. Computed fresh each call so it tracks the
 *  live preference until the terminal first writes a record. */
function freshPerTerminalState(): RightPanelPerTerminalState {
  return {
    ...DEFAULT_RIGHT_PANEL_PER_TERMINAL,
    collapsed: preferences().newTerminalCollapsed,
  };
}

/** The per-terminal record for `id`: the local state if this browser has
 *  written one, else THE TERMINAL'S OWN RECORD, else the fresh seed. The ONE
 *  fallback — the tile reader, the pane reader, the promotion seed and the
 *  focused-place mirror all go through it.
 *
 *  Reading the record here, rather than waiting for session restore to copy
 *  it into the local store, is the READ half of the rule the split's saved
 *  state follows (`terminal/splitPanelState.ts`): a mount must never lay a
 *  tile out from a default the record disagrees with. It matters for SIZE in
 *  maximized posture, where the panel's width comes out of the tile's box.
 *  Unlike the split, a local entry here has no settle rule — once this
 *  browser writes one it wins for the rest of the session, so a failed write
 *  shows until the next reload and a foreign write is not adopted. That is
 *  this module's long-standing behaviour and is untouched here.
 *
 *  EVERY read here is reactive, so this is a TRACKED-PHASE function: callers in
 *  the effect phase take their facts from {@link focusedPlace} instead. */
function stateOf(id: TerminalId | null): RightPanelPerTerminalState {
  if (id === null) return freshPerTerminalState();
  return (
    perTerminal[id] ??
    useTerminalStore().getMetadata(id)?.rightPanel ??
    freshPerTerminalState()
  );
}

/** The focused pane and the record it carries. */
type PanePlace = {
  readonly id: TerminalId | null;
  readonly state: RightPanelPerTerminalState;
};

interface PlaceMirror {
  /** The focused pane and its record, as plain values. */
  readonly now: () => PanePlace;
  /** Fold a write this module just made into the mirror. */
  readonly noteWrite: (
    id: TerminalId,
    state: RightPanelPerTerminalState,
  ) => void;
}

/** THE FOCUSED PANE'S PLACE AS PLAIN VALUES — what the WRITE-ONLY verbs of
 *  `CodeViewState` consult instead of the store.
 *
 *  `setSelectedFile` and `recordNavigation` are called from the Code view's
 *  EFFECT PHASE (the inventory-membership clear, and the landing of a
 *  front-door open), where reading a signal, a store property or a memo is
 *  STRICT_READ_UNTRACKED. Both need the same two facts — which pane is focused,
 *  and what its record says — so ONE mirror serves both, and the write path
 *  below takes its merge base from the caller rather than reading it.
 *
 *  Kept in step from two sides: one app-lifetime computation that does the
 *  reactive reads (a focus move, a restored record, a write made elsewhere all
 *  land in it), and {@link PlaceMirror.noteWrite}, which folds in this module's
 *  own writes as they are made — a store write is staged, so the computation
 *  alone would not let two writes in one tick compose.
 *
 *  The copy is taken in the COMPUTE, which runs eagerly at creation and again
 *  in each propagation pass — so the mirror is current before ANY effect
 *  callback of that pass reads it, with no ordering between effects to rely on.
 *  Assigning a plain field is not a reactive write, and the compute does
 *  nothing else: no signal, no store, no I/O. The effect phase has nothing left
 *  to do, which is why it is empty rather than the keeper.
 *
 *  The initial value is the STATIC default, never `freshPerTerminalState()`:
 *  it is only ever read if something consults the mirror before the compute has
 *  run at all, and `collapsed` — the one field that seed reads a preference for
 *  — is a TILE fact no write-only verb consults. */
const focusedPlace = createSharedRoot((): PlaceMirror => {
  const store = useTerminalStore();
  let place: PanePlace = { id: null, state: DEFAULT_RIGHT_PANEL_PER_TERMINAL };
  createEffect(
    (): void => {
      const id = store.focusedTerminalId();
      place = {
        id,
        state: id === null ? DEFAULT_RIGHT_PANEL_PER_TERMINAL : stateOf(id),
      };
    },
    () => {},
  );
  return {
    now: () => place,
    noteWrite: (id, state) => {
      if (id === place.id) place = { id, state };
    },
  };
});

/** Echo a terminal's panel record to the server, for session restore.
 *
 *  The record is PASSED IN — the one the local write just produced — never read
 *  back out of the store: a store write is STAGED, so `perTerminal[id]` here
 *  would still answer with the PRE-write record, and with nothing at all on a
 *  terminal's very first write (which would drop that report entirely and leave
 *  the first tab/collapse of every terminal unpersisted). */
function reportToServer(
  id: TerminalId,
  s: RightPanelPerTerminalState,
  rpc: ReturnType<typeof padiRpcOf>,
): void {
  // Run at the seam: the caller is a synchronous store mutation echoing a local
  // write that already happened, with nothing to compose into.
  runAction(
    "save panel state",
    rpc.chrome
      .setRightPanel({
        id,
        collapsed: s.collapsed,
        activeTab: s.activeTab,
        codeMode: s.codeMode,
        // SPREAD, never `selectedFileByMode: s.selectedFileByMode` (#17): the
        // field is `Schema.optionalKey` on the wire, and Effect Schema accepts
        // an ABSENT key but REJECTS a present-but-`undefined` one — where zod's
        // `.optional()` tolerated both. The bound face decodes its input at the
        // edge, so an explicit `undefined` here would THROW at this call site
        // the first time a terminal has no file selected in any mode. Absence is
        // the only spelling of "no selection".
        ...(s.selectedFileByMode !== undefined && {
          selectedFileByMode: s.selectedFileByMode,
        }),
      })
      .pipe(
        Effect.catch((err) =>
          // A failed `setRightPanel` means the optimistic per-terminal state
          // (collapsed / active tab / code mode / selected file) is NOT
          // persisted — it silently reverts on the next session restore. The
          // connection-health pip only reports TRANSPORT health, so an
          // application-level rejection (validation / authorization) on an
          // otherwise-live padi would go unseen; surface it per the repo's
          // terminal-mutation rule (toast with the server message). One STABLE
          // toast id dedups the failure so a downed padi — where every
          // tab/file/collapse write fails — collapses onto a single toast
          // instead of one per interaction.
          Effect.sync(() => {
            toast.error(`Failed to save panel state: ${toError(err).message}`, {
              id: "right-panel-report-failed",
            });
          }),
        ),
      ),
  );
}

export function useRightPanel() {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const rp = () => preferences().rightPanel;

  /** Whether there's anything for the panel to show — at least one terminal
   *  exists. An empty workspace renders the `EmptyState` in place of the
   *  panel host (App.tsx's `showEmpty`), so the desktop chrome must treat the
   *  panel as absent regardless of the active terminal's `collapsed` state —
   *  otherwise the ChromeBar reserves panel-width it never fills (a "ghost"
   *  gap) and the toggle reads as open with nothing behind it. */
  const hasTerminals = () => tileStore.tileCount() > 0;

  /** The focused pane's place, as plain values — the mirror the write-only
   *  verbs read (see {@link focusedPlace}). Touched HERE, in the one function
   *  every consumer of the panel calls, so the computation that keeps it is
   *  standing from the app's first use of the panel rather than from whichever
   *  write happens to reach it first. */
  const place = focusedPlace();

  /** The desktop panel's collapsed bit — the TILE's, so moving focus between
   *  panes of one tile never opens/closes the panel or shifts layout. The
   *  posture lives on the tile's own `TerminalMetadata.rightPanel` record (the
   *  same record every terminal carries; #959 gave each tile its own), and only
   *  `collapsed` is read from it for a tile — the record's tab/mode/selection
   *  fields are the PANE's and are read through `paneState()`. A split's own
   *  `collapsed` is not read while it is a split (see the header). A tile with no
   *  record yet reads the new-terminal default from `preferences.
   *  newTerminalCollapsed` via `freshPerTerminalState`, and the posture survives
   *  reload via session restore. Only the take-up-space *geometry*
   *  (`size`/`codeTabTreeSize` below) stays global. */
  const collapsed = (): boolean => stateOf(store.activeId()).collapsed;

  /** Read the per-terminal record for the FOCUSED PANE
   *  (`store.focusedTerminalId()`) — the panel's CONTENT subject: active tab,
   *  code mode, per-mode selected file. A split carries its own; main keeps its
   *  own. Read-only; write through the mutators. */
  function paneState(): RightPanelPerTerminalState {
    return stateOf(store.focusedTerminalId());
  }

  /** The focused pane's EFFECTIVE Code-tab mode — the stored mode through the
   *  one browse-only rule ({@link codeModeFor}). Every reader of the mode goes
   *  through here, so the Code tab, its queries, the per-mode selection and
   *  `openInCodeTab` all agree. */
  function paneCodeMode(): CodeTabView {
    const id = store.focusedTerminalId();
    const git = id === null ? undefined : store.getMetadata(id)?.git;
    return codeModeFor(codeLister(git), paneState().codeMode);
  }

  /** Write `update` onto `id`'s record from a base the CALLER has already read,
   *  and persist the result. READ-FREE — it consults no signal, memo or store
   *  property of its own — so a write-only verb may run it in the effect phase.
   *  (The draft the mutator reads is not a tracked read; the merge base is the
   *  only thing that would have been one, and it arrives as a value.)
   *
   *  The base is the terminal's current record, so a partial write cannot
   *  replace its saved tab, mode or selection with a default it never held. An
   *  entry already held locally wins over the base — two writes in one tick then
   *  compose on the staged entry rather than each starting from the committed
   *  one.
   *
   *  The record the write PRODUCES is captured inside the mutator and handed on
   *  to {@link reportToServer} and to the place mirror: a read of
   *  `perTerminal[id]` after the write would answer with the pre-write record. */
  function writeFrom(
    id: TerminalId,
    base: RightPanelPerTerminalState,
    update:
      | Partial<RightPanelPerTerminalState>
      | ((s: RightPanelPerTerminalState) => void),
    rpc: ReturnType<typeof padiRpcOf>,
  ): void {
    // Assigned by the mutator below, which the store setter runs synchronously.
    let written!: RightPanelPerTerminalState;
    setPerTerminal((all) => {
      const held = all[id];
      const state = held ?? { ...base };
      if (typeof update === "function") update(state);
      else Object.assign(state, update);
      if (!held) all[id] = state;
      written = { ...state };
    });
    place.noteWrite(id, written);
    reportToServer(id, written, rpc);
  }

  /** All panel writes made from the TRACKED phase (a gesture, an action, a
   *  capture): the merge base is read here, through {@link stateOf}. The host is
   *  explicit so an in-flight create can retain its destination. */
  function mutatePanel(
    id: TerminalId,
    update:
      | Partial<RightPanelPerTerminalState>
      | ((s: RightPanelPerTerminalState) => void),
    rpc: ReturnType<typeof padiRpcOf>,
  ): void {
    writeFrom(id, stateOf(id), update, rpc);
  }

  /** UI gestures that belong to the PANE (tab / sub-mode / selection) target the
   *  focused pane — main or any split. An empty workspace has no target. */
  function mutatePane(
    update:
      | Partial<RightPanelPerTerminalState>
      | ((s: RightPanelPerTerminalState) => void),
  ): void {
    const id = store.focusedTerminalId();
    if (id !== null) mutatePanel(id, update, activePadiRpc);
  }

  /** Write a TILE's `collapsed` bit (reported to the server for session
   *  restore). `null` is "no tile to record a posture for" — an empty workspace,
   *  where the EmptyState owns the screen — and drops the write rather than
   *  recording a ghost state. Every collapsed-mutating path (toggle / collapse /
   *  expand and `reveal`'s desktop branch) routes through here so the write lives
   *  in one place rather than per-caller.
   *
   *  The tile is NAMED by the caller, never re-read here: a caller that has just
   *  moved focus would otherwise write the posture of the tile the user was on
   *  before it, since a focus write is staged and `store.activeId()` still
   *  answers with the old one for the rest of the synchronous run. */
  const setCollapsed = (tileId: TerminalId | null, next: boolean) => {
    if (tileId !== null)
      mutatePanel(tileId, { collapsed: next }, activePadiRpc);
  };

  /** Capture a panel patch NOW and apply it to the terminal's id when an async
   *  create finally yields one — the ONE copy-on-create shape, shared by a new
   *  TILE's visibility and a new SPLIT's tab. `mutatePanel` merges a partial, so
   *  applying the seed preserves whatever else the terminal already carries. The
   *  host is captured with the value so a create that outlives a host switch
   *  still writes to the host it was made on. */
  function capturePanelSeed(seed: Partial<RightPanelPerTerminalState>) {
    const rpc = padiRpcOf(activeHost());
    return (id: TerminalId) => mutatePanel(id, seed, rpc);
  }

  /** Seed a terminal's NAVIGATION HISTORY from its saved state — the one piece
   *  of right-panel state no record carries, so the one piece a restore still
   *  has to hand over. The per-terminal record itself is READ off the terminal
   *  (see {@link stateOf}); copying it into the local store is what used to
   *  leave a window where the two disagreed.
   *
   *  Seeded only when a file was actually selected; a restored-but-empty mode
   *  starts with no history. `lastRepo: undefined` resets the repo baseline so
   *  the next `syncRepo` re-adopts this terminal's current repo without
   *  resetting — the stack just seeded is the truth, and re-seeding is a "this
   *  is a fresh start" event, same as first mount. */
  function seedHistory(id: TerminalId): void {
    const state = stateOf(id);
    const path = state.selectedFileByMode?.[state.codeMode] ?? null;
    histories.seed(
      id,
      path !== null ? { mode: state.codeMode, path } : undefined,
    );
  }

  /** The focused pane's stack as the LIVE focus names it — the rendered
   *  enablement reads, which must re-answer when focus moves to a pane with a
   *  different history. */
  const liveBrowser = () => {
    const id = store.focusedTerminalId();
    return id === null ? null : histories.browserFor(id);
  };

  /** The FOCUSED PANE's Code-tab place, behind the Code view's one state
   *  interface. Each verb reads and writes the pane that has focus — main or
   *  any split — so focus moving between panes moves the whole place with it.
   *
   *  Two phases, two sources for "which pane": the RENDERED reads
   *  (`codeMode`, `selectedFile`, the two enablement accessors) go through the
   *  store, so they re-answer the moment focus moves; the WRITE-ONLY verbs
   *  (`setSelectedFile`, `recordNavigation`, and the two navigate verbs that
   *  share their lookup) go through the {@link focusedPlace} mirror, because the
   *  Code view calls them from its effect phase where a store read would be
   *  STRICT_READ_UNTRACKED. */
  const code: CodeViewState = {
    codeMode: paneCodeMode,
    setCodeMode: (mode) => mutatePane({ codeMode: mode }),
    /** Per-mode file selection, keyed by `(focusedPane, mode)` so each pane
     *  remembers its own pick in each of local/branch/browse. */
    selectedFile: (mode) => paneState().selectedFileByMode?.[mode] ?? null,
    // A shallow PATCH, not a draft mutation: the decoded record is readonly
    // (Effect's `Struct.Type`), so the map is REBUILT ({@link selectionWith}).
    //
    // WRITE-ONLY: the pane and the record it carries both come from the mirror,
    // and the write takes that record as its merge base, so nothing here reads
    // reactive state. No focused pane is no target, exactly as `mutatePane`
    // drops a write on an empty workspace.
    setSelectedFile: (mode, path) => {
      const { id, state } = place.now();
      if (id === null) return;
      const next = selectionWith(state.selectedFileByMode, mode, path);
      if (next !== "unchanged")
        writeFrom(id, state, { selectedFileByMode: next }, activePadiRpc);
    },
    // ── Navigation history (back / forward), one stack per pane ──────
    // Keyed by the mirror's plain id: `recordNavigation` lands in the effect
    // phase beside the selection it records (`CodeTab`'s one `select` funnel),
    // so this lookup must read nothing reactive either.
    ...codeHistoryVerbs(() => {
      const { id } = place.now();
      return id === null ? null : histories.browserFor(id);
    }),
    // …and the two the toolbar RENDERS, back on the live focus: keyed by the
    // mirror they would answer about the previous pane until something else
    // invalidated the button, leaving back/forward enabled on a pane with no
    // history to walk.
    canNavigateBack: () => liveBrowser()?.canBack() ?? false,
    canNavigateForward: () => liveBrowser()?.canForward() ?? false,
  };

  return {
    /** Reconcile terminal `id`'s history with the repo it sits in, dropping
     *  the stack only when *that terminal's own* repo has changed since its
     *  history was last touched. The caller hands the pane and its root as ONE
     *  pair, read together (`RightPanel`, from the focused pane's bundle): a
     *  pane looked up here on its own could be paired with the previous pane's
     *  root for a propagation step, and wipe the new pane's history.
     *
     *  The recorded locations are repo-relative paths (`{ mode, path }`) with
     *  no repo identity of their own, so they are only meaningful within the
     *  repo they were captured in. When a terminal `cd`s from repo A to repo B,
     *  re-applying an A-relative entry inside B would open the wrong same-named
     *  file (or a path B's membership effect then clears). Resetting on a
     *  genuine repo change keeps back/forward scoped to the repo currently
     *  shown; the next `recordNavigation` re-seeds the stack.
     *
     *  The decision is keyed PER TERMINAL ({@link createCodeHistories}), not
     *  against the previously focused pane: a terminal's repo can change while
     *  it is UNFOCUSED (a `cd` in its PTY updates server metadata unobserved).
     *  Tracking each terminal's last-seen repo independently catches that
     *  change the moment the terminal next becomes focused — even if other
     *  panes were focused in between — without wiping a freshly-focused
     *  terminal's history just because the focused repo shifted on a plain
     *  switch. The first call for a terminal records its repo without
     *  resetting, so a session-restored (seeded) stack survives the initial
     *  mount. */
    syncRepo: (id: TerminalId, repo: string | null) =>
      histories.syncRepo(id, repo),
    // ── Workspace chrome ─────────────────────────────────────────────
    // `size`/`codeTabTreeSize` are GLOBAL server prefs — viewer layout/density
    // taste, per-tab by THE RULE. `collapsed` is per-terminal (it follows the
    // terminal, #959) but is grouped here as the panel's other visibility read.
    collapsed,
    panelSize: () => rp().size,
    /** At least one terminal exists, so the desktop panel host is mounted
     *  (rather than the EmptyState). Desktop chrome gates its panel
     *  affordances on this — the toggle is dead and the offset zero when
     *  there's nothing to inspect. */
    hasTerminals,
    /** Effective desktop visibility: the panel only occupies canvas space
     *  when it isn't collapsed AND a terminal exists. ChromeBar keys its
     *  width offset and toggle state off this (not raw `collapsed`) so an
     *  empty workspace shows no ghost panel. */
    panelOpen: () => hasTerminals() && !collapsed(),
    togglePanel: () => setCollapsed(store.activeId(), !collapsed()),
    collapsePanel: () => setCollapsed(store.activeId(), true),
    expandPanel: () => setCollapsed(store.activeId(), false),
    setPanelSize: (size: number) => {
      if (size > MIN_PANEL_SIZE && Math.abs(size - rp().size) > SIZE_EPSILON)
        updatePreferences({ rightPanel: { size } }, { coalesce: true });
    },
    /** Vertical split fraction inside the Code tab — tree pane occupies
     *  this share, content pane gets the rest. Persisted across reload. */
    codeTabTreeSize: () => rp().codeTabTreeSize,
    setCodeTabTreeSize: (size: number) => {
      if (
        size >= MIN_CODE_PANE_SHARE &&
        size <= 1 - MIN_CODE_PANE_SHARE &&
        Math.abs(size - rp().codeTabTreeSize) > SIZE_EPSILON
      ) {
        updatePreferences(
          { rightPanel: { codeTabTreeSize: size } },
          { coalesce: true },
        );
      }
    },

    // ── Touch-layout drawer (session-local) ──────────────────────────
    /** Whether the bottom-drawer host is open. Only meaningful on the touch
     *  layouts (phone + compact) — desktop reads `collapsed()` instead. Not
     *  persisted. */
    drawerOpen,
    setDrawerOpen,
    /** Reveal the panel by whatever mechanism the current layout uses — open
     *  the bottom-drawer host on the touch layouts, uncollapse the desktop
     *  Resizable otherwise. Producers (e.g. `openInCodeTab`) call this to
     *  express intent ("show the panel") without owning the touch-vs-desktop
     *  fork; the two visibility volatilities (session-local `drawerOpen`,
     *  persisted `collapsed`) stay separate and are resolved here in one place.
     *
     *  `of` NAMES the pane the reveal is FOR — its containing tile owns the
     *  desktop posture. A caller that has just moved focus to that pane MUST
     *  name it: a focus write is staged, so the active tile read here would
     *  still be the one the user was on, and the reveal would uncollapse THAT
     *  tile's panel instead. Named by nobody, it is the active tile — the
     *  chrome gestures, which move no focus of their own. */
    reveal: (of?: TerminalId) => {
      if (!isDesktop()) {
        setDrawerOpen(true);
        return;
      }
      const tileId =
        of === undefined ? store.activeId() : store.containingTile(of);
      if (tileId !== null && stateOf(tileId).collapsed)
        setCollapsed(tileId, false);
    },

    // ── Per-pane task state ──────────────────────────────────────────
    /** DU view of the FOCUSED PANE's active tab — `{ kind: "inspector" }` or
     *  `{ kind: "code", mode }`. Matches `match(...).with(...).exhaustive()`. */
    activeTab: (): RightPanelTab =>
      rightPanelView({
        activeTab: paneState().activeTab,
        codeMode: paneCodeMode(),
      }),
    /** The focused pane's Code-tab place — mode, per-mode selection, history —
     *  as the Code view's one state interface. The mode is the persisted
     *  sub-mode regardless of which tab is active: CodeTab needs it even when
     *  the user has flipped over to Inspector — selection / filter state is
     *  keyed by it, and the fallback behaviour of reading `activeTab` would mask
     *  a "browse" selection as "local" while Inspector is active and trigger a
     *  spurious reset on the round-trip back. */
    code,
    /** Switch a pane to Inspector. `codeMode` is preserved so toggling back to
     *  Code restores the user's last sub-mode.
     *
     *  `of` NAMES the pane, exactly as `reveal` does, and for the same reason: a
     *  caller that has just landed focus on it must name it, since a focus write
     *  is staged and the focused pane read here would still be the one the user
     *  came from — the Inspector would then open on THAT pane. Named by nobody,
     *  it is the focused pane (the panel's own tab bar, which moves no focus). */
    showInspector: (of?: TerminalId) => {
      if (of === undefined) mutatePane({ activeTab: "inspector" });
      else mutatePanel(of, { activeTab: "inspector" }, activePadiRpc);
    },
    /** Switch the focused pane to the Code tab. When `mode` is omitted, the
     *  persisted `codeMode` is used — this is the round-trip case
     *  (Inspector→Code restores the last view). Pass `mode` explicitly to
     *  override. */
    showCode: (mode?: CodeTabView) =>
      mutatePane({
        activeTab: "code",
        ...(mode !== undefined && { codeMode: mode }),
      }),
    /** Atomic "set PANE `terminalId`'s Code tab at `mode`" — switch that pane to
     *  Code, set the requested sub-mode. Does NOT touch visibility (collapsed
     *  pref or drawer-open signal); `openInCodeTab` pairs it with `reveal`, and
     *  keeping visibility out of this function is what lets one persisted bit
     *  live on the desktop side without touch-layout gestures polluting it.
     *
     *  The pane is NAMED, not read off focus: the one caller moves focus TO that
     *  pane in the same breath, and a focus write is staged — reading the
     *  focused pane here would answer with the pane the user was on and change
     *  ITS tab instead.
     *
     *  Short-circuits when the tab+mode is already current — every
     *  diff→browse and browse→browse `openCodeAt` would otherwise
     *  round-trip an idempotent write to the server. */
    openCodeAt: (terminalId: TerminalId, mode: CodeTabView) => {
      const cur = stateOf(terminalId);
      if (cur.activeTab === "code" && cur.codeMode === mode) return;
      mutatePanel(
        terminalId,
        { activeTab: "code", codeMode: mode },
        activePadiRpc,
      );
    },

    // ── Handing panel state to a terminal that has just appeared ─────
    //
    // Two hand-overs — a tile's posture, a split's tab — and one adoption of a
    // record the server already holds. Each hand-over returns an APPLIER so the
    // source and the host are pinned when the caller reads them: a create that
    // outlives a host switch still writes to the host it was made on, and a
    // focus change while the create is pending cannot change what the new
    // terminal starts on. One verb therefore serves both timings — read now and
    // apply when the id arrives (a browser create), or apply at once (a split
    // that arrived on the list, a promotion).

    /** Hand `id` the open/closed posture of `fromTile` — the tile it is appearing
     *  beside or leaving — or the new-terminal default when there is none. A
     *  no-op when `id` IS `fromTile`. */
    adoptTileCollapsed: (fromTile: TerminalId | null) => {
      const apply = capturePanelSeed({
        collapsed: stateOf(fromTile).collapsed,
      });
      return (id: TerminalId) => {
        if (id === fromTile) return;
        apply(id);
      };
    },

    /** Hand `id` the active tab of the terminal it came from — the pane a
     *  browser split was made from, or a split's own parent when it arrived from
     *  elsewhere — so creating a split never flips the panel. A no-op when the
     *  split already carries a record of its own (the creator may have passed a
     *  `rightPanel` on `lifecycle.create`, and {@link stateOf} reads it) or when
     *  this browser already holds in-flight state for it. */
    seedSplitTab: (fromId: TerminalId | null) => {
      const apply = capturePanelSeed({ activeTab: stateOf(fromId).activeTab });
      return (id: TerminalId) => {
        if (perTerminal[id]) return;
        if (store.getMetadata(id)?.rightPanel) {
          seedHistory(id);
          return;
        }
        apply(id);
      };
    },

    /** Seed a terminal's in-memory navigation history from its saved state —
     *  the only right-panel state a record does not carry. Called by
     *  `useSessionRestore` during hydration. */
    seedHistory,
    /** Clean up state for a terminal that no longer exists. Mirrors
     *  `useSubPanel.removePanel`. */
    removePanel: (id: TerminalId) => {
      setPerTerminal((s) => {
        delete s[id];
      });
      histories.forget(id);
    },
  } as const;
}
