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
import type { Browser } from "@kolu/solid-browser";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { toast } from "solid-sonner";
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
import { codeLister, codeModeFor } from "./codeLister";
import {
  type BrowserLocation,
  type CodeViewState,
  createCodeHistory,
} from "./codeViewState";

const MIN_PANEL_SIZE = 0.05;
/** Lower bound for the Code-tab vertical split — keep the tree and content
 *  panes from collapsing to invisible via drag. Mirrors `MIN_PANEL_SIZE`'s
 *  role for the horizontal split. */
const MIN_TREE_SIZE = 0.1;
const MAX_TREE_SIZE = 0.9;
/** Drop a size write when it matches the stored value. Corvu's `Resizable`
 *  runs `createEffect(() => onSizesChange(sizes()))`, so it re-emits the
 *  *current* `sizes` prop on every reactive invalidation — and re-registers
 *  panels (re-emitting again) on every mount during restart churn. Those
 *  re-emits carry the value we already hold; persisting them is pure noise
 *  (#1041). Corvu rounds sizes to 6 decimals, so a tolerance below that
 *  catches the echo without dropping a real one-pixel drag step. */
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

/** Per-terminal navigation history — one record per terminal bundling the
 *  back/forward stack with the repo it was captured against. Both fields share
 *  a single lifecycle (seeded in `seedHistory`, dropped in `removePanel`, reset
 *  together on a repo change), so they live in one Map entry rather than two
 *  parallel maps that must be kept in sync by hand.
 *
 *  - **`browser`** — the back/forward stack for the terminal's Code tab.
 *    In-memory only: history is session-local, and the persisted
 *    `selectedFileByMode` remains the single render + restore truth. This stack
 *    only *records* the sequence of visited locations so back/forward can
 *    re-apply earlier ones. Lazily created for a fresh terminal on its first
 *    navigation.
 *  - **`lastRepo`** — the repo root the stack was last captured against. The
 *    recorded locations are repo-relative `{ mode, path }` with no repo
 *    identity of their own, so a stack built in repo A is meaningless in repo B;
 *    this field is how we tell, per terminal, whether the repo *that terminal*
 *    sits in has moved since its history was last touched. Keyed per terminal
 *    (not a single "previously active" value) on purpose: a terminal's repo can
 *    change while it is INACTIVE — a `cd` in its PTY updates its server metadata
 *    even though `CodeTab` (a singleton over the active terminal) isn't watching
 *    it. Comparing only against the immediately previous active tuple would miss
 *    that and let a stale A-relative stack replay against A's new repo on
 *    switch-back. Per-terminal tracking catches it whenever the terminal next
 *    becomes active. `undefined` means "no repo recorded yet" (fresh or
 *    not-yet-in-a-repo terminal); `syncRepo` keys its first-sight decision off
 *    that, so it is distinct from `null` ("recorded, and that terminal is in no
 *    repo"). */
type TerminalHistory = {
  browser: Browser<BrowserLocation>;
  lastRepo: string | null | undefined;
};
const history = new Map<TerminalId, TerminalHistory>();

/** Resolve (creating if absent) a terminal's history record. The browser
 *  instance is created once and then **never replaced** — resets clear it in
 *  place — so reading `.canBack()/.canForward()` through it is reactive on the
 *  controller's own signals: the toolbar's ◀/▶ enablement, subscribed to this
 *  stable instance on first render, keeps tracking navigation across repo
 *  resets and session re-seeds without re-wiring. (Replacing the instance
 *  would strand that subscription on the dead object and freeze the buttons.) */
function historyFor(id: TerminalId): TerminalHistory {
  let h = history.get(id);
  if (!h) {
    h = { browser: createCodeHistory(), lastRepo: undefined };
    history.set(id, h);
  }
  return h;
}

function browserFor(id: TerminalId): Browser<BrowserLocation> {
  return historyFor(id).browser;
}

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

function reportToServer(
  id: TerminalId,
  rpc: ReturnType<typeof padiRpcOf>,
): void {
  const s = perTerminal[id];
  if (!s) return;
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

  /** The per-terminal record for `id`: the local state if this browser has
   *  written one, else THE TERMINAL'S OWN RECORD, else the fresh seed. The ONE
   *  fallback — the tile reader, the pane reader and the promotion seed all go
   *  through it.
   *
   *  Reading the record here, rather than waiting for session restore to copy
   *  it into the local store, is the READ half of the rule the split's saved
   *  state follows (`terminal/splitPanelState.ts`): a mount must never lay a
   *  tile out from a default the record disagrees with. It matters for SIZE in
   *  maximized posture, where the panel's width comes out of the tile's box.
   *  Unlike the split, a local entry here has no settle rule — once this
   *  browser writes one it wins for the rest of the session, so a failed write
   *  shows until the next reload and a foreign write is not adopted. That is
   *  this module's long-standing behaviour and is untouched here. */
  function stateOf(id: TerminalId | null): RightPanelPerTerminalState {
    if (id === null) return freshPerTerminalState();
    return (
      perTerminal[id] ??
      store.getMetadata(id)?.rightPanel ??
      freshPerTerminalState()
    );
  }

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

  /** All panel writes share local initialization, mutation, and persistence.
   *  The host is explicit so an in-flight create can retain its destination.
   *
   *  The local entry is seeded from {@link stateOf} — the record when there is
   *  one — so a partial write cannot replace the terminal's saved tab, mode or
   *  selection with a default it never held. */
  function mutatePanel(
    id: TerminalId,
    update:
      | Partial<RightPanelPerTerminalState>
      | ((s: RightPanelPerTerminalState) => void),
    rpc: ReturnType<typeof padiRpcOf>,
  ): void {
    if (!perTerminal[id]) setPerTerminal(id, { ...stateOf(id) });
    if (typeof update === "function") {
      setPerTerminal(id, produce(update));
    } else {
      setPerTerminal(id, update);
    }
    reportToServer(id, rpc);
  }

  /** UI gestures that belong to the TILE (visibility) target the active tile; an
   *  empty workspace has no target. */
  function mutateTile(
    update:
      | Partial<RightPanelPerTerminalState>
      | ((s: RightPanelPerTerminalState) => void),
  ): void {
    const id = store.activeId();
    if (id !== null) mutatePanel(id, update, activePadiRpc);
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

  /** Write the ACTIVE TILE's `collapsed` bit (reported to the server for session
   *  restore). Naturally a no-op on an empty workspace — the EmptyState owns the
   *  screen and there's no active tile, so `mutateTile` drops the write rather
   *  than recording a ghost state. Every collapsed-mutating path (toggle/collapse/
   *  expand and `reveal`'s desktop branch) routes through here so the write lives
   *  in one place rather than per-caller. */
  const setCollapsed = (next: boolean) => {
    mutateTile({ collapsed: next });
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
    const h = historyFor(id);
    h.browser.reset(path !== null ? { mode: state.codeMode, path } : undefined);
    h.lastRepo = undefined;
  }

  /** The FOCUSED PANE's Code-tab place, behind the Code view's one state
   *  interface. Each verb reads and writes the pane that has focus — main or
   *  any split — so focus moving between panes moves the whole place with it. */
  const code: CodeViewState = {
    owner: () => {
      const id = store.focusedTerminalId();
      return id === null ? null : { kind: "pane", terminalId: id };
    },
    codeMode: paneCodeMode,
    setCodeMode: (mode) => mutatePane({ codeMode: mode }),
    /** Per-mode file selection, keyed by `(focusedPane, mode)` so each pane
     *  remembers its own pick in each of local/branch/browse. */
    selectedFile: (mode) => paneState().selectedFileByMode?.[mode] ?? null,
    // A shallow PATCH, not a `produce` mutator: the decoded record is readonly
    // (Effect's `Struct.Type`), so the map is REBUILT — the deselect arm drops
    // the mode's key entirely rather than writing `undefined` into it, which is
    // also what keeps the reported payload decodable (#17: these inner fields are
    // `optionalKey` too).
    setSelectedFile: (mode, path) => {
      const cur = paneState().selectedFileByMode ?? {};
      if (path === null) {
        if (!(mode in cur)) return;
        const { [mode]: _dropped, ...rest } = cur;
        mutatePane({
          selectedFileByMode: Object.keys(rest).length > 0 ? rest : undefined,
        });
      } else {
        if (cur[mode] === path) return;
        mutatePane({ selectedFileByMode: { ...cur, [mode]: path } });
      }
    },
    // ── Navigation history (back / forward), one stack per pane ──────
    recordNavigation: (loc) => {
      const id = store.focusedTerminalId();
      if (id !== null) browserFor(id).navigate(loc);
    },
    navigateBack: () => {
      const id = store.focusedTerminalId();
      return id === null ? null : browserFor(id).back();
    },
    navigateForward: () => {
      const id = store.focusedTerminalId();
      return id === null ? null : browserFor(id).forward();
    },
    canNavigateBack: () => {
      const id = store.focusedTerminalId();
      return id === null ? false : browserFor(id).canBack();
    },
    canNavigateForward: () => {
      const id = store.focusedTerminalId();
      return id === null ? false : browserFor(id).canForward();
    },
    /** Reconcile the focused pane's history with the repo it sits in,
     *  dropping the stack only when *that pane's own* repo has changed since
     *  its history was last touched.
     *
     *  The decision is keyed PER TERMINAL (`history.get(id).lastRepo`), not
     *  against the previously focused pane: a terminal's repo can change while
     *  it is UNFOCUSED (a `cd` in its PTY updates server metadata unobserved).
     *  Tracking each terminal's last-seen repo independently catches that
     *  change the moment the terminal next becomes focused — even if other
     *  panes were focused in between — without wiping a freshly-focused
     *  terminal's history just because the focused repo shifted on a plain
     *  switch. The first call for a terminal records its repo without
     *  resetting, so a session-restored (seeded) stack survives the initial
     *  mount. */
    syncRepo: (repo) => {
      const id = store.focusedTerminalId();
      if (id === null) return;
      // `historyFor` resolves (creating if absent) the terminal's record, so a
      // `lastRepo` of `undefined` is the sole "no repo recorded yet" marker —
      // distinct from `null` ("recorded, terminal is in no repo").
      const h = historyFor(id);
      const prevRepo = h.lastRepo;
      h.lastRepo = repo;
      // A genuine repo move on a terminal we've already seen drops the
      // now-stale stack — cleared in place so the toolbar stays subscribed to
      // the live instance.
      if (prevRepo !== undefined && repo !== prevRepo) h.browser.reset();
    },
  };

  return {
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
    togglePanel: () => setCollapsed(!collapsed()),
    collapsePanel: () => setCollapsed(true),
    expandPanel: () => setCollapsed(false),
    setPanelSize: (size: number) => {
      if (size > MIN_PANEL_SIZE && Math.abs(size - rp().size) > SIZE_EPSILON)
        updatePreferences({ rightPanel: { size } }, { coalesce: true });
    },
    /** Vertical split fraction inside the Code tab — tree pane occupies
     *  this share, content pane gets the rest. Persisted across reload. */
    codeTabTreeSize: () => rp().codeTabTreeSize,
    setCodeTabTreeSize: (size: number) => {
      if (
        size >= MIN_TREE_SIZE &&
        size <= MAX_TREE_SIZE &&
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
     *  persisted `collapsed`) stay separate and are resolved here in one place. */
    reveal: () => {
      if (!isDesktop()) setDrawerOpen(true);
      else if (collapsed()) setCollapsed(false);
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
    /** Switch the focused pane to Inspector. `codeMode` is preserved so toggling
     *  back to Code restores the user's last sub-mode. */
    showInspector: () => mutatePane({ activeTab: "inspector" }),
    /** Switch the focused pane to the Code tab. When `mode` is omitted, the
     *  persisted `codeMode` is used — this is the round-trip case
     *  (Inspector→Code restores the last view). Pass `mode` explicitly to
     *  override. */
    showCode: (mode?: CodeTabView) =>
      mutatePane({
        activeTab: "code",
        ...(mode !== undefined && { codeMode: mode }),
      }),
    /** Atomic "set the Code tab at `mode`" — switch to Code, set the
     *  requested sub-mode. Does NOT touch visibility (collapsed pref or
     *  drawer-open signal); the host (`RightPanelDrawer`) watches the
     *  paired `pendingOpen` signal seeded by `openInCodeTab` and ensures
     *  the surface is visible per its own semantics (desktop expand vs.
     *  touch-layout drawer open). Keeping visibility out of this function is
     *  what lets one persisted bit live on the desktop side without
     *  touch-layout gestures polluting it.
     *
     *  Short-circuits when the tab+mode is already current — every
     *  diff→browse and browse→browse `openCodeAt` would otherwise
     *  round-trip an idempotent write to the server. */
    openCodeAt: (mode: CodeTabView) => {
      const cur = paneState();
      if (cur.activeTab === "code" && cur.codeMode === mode) return;
      mutatePane({ activeTab: "code", codeMode: mode });
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
      setPerTerminal(produce((s) => delete s[id]));
      history.delete(id);
    },
  } as const;
}
