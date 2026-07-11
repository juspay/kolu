/** Right panel state — singleton module.
 *
 *  Three storage layers because the right panel has three volatilities:
 *
 *  - **Workspace chrome** (size, codeTabTreeSize) lives on
 *    `preferences.rightPanel` — global to the user, set once and forgotten.
 *    `size`/`codeTabTreeSize` drive the desktop Resizable's width + the Code-tab
 *    tree/content split (viewer density taste, tuned once, left put), each with a
 *    real writer (`setPanelSize`/`setCodeTabTreeSize`). The NEW-TERMINAL collapsed
 *    default is a separate top-level `preferences.newTerminalCollapsed` seed (not
 *    on this record) — a copy-on-create default; the LIVE collapsed state follows
 *    the terminal (below).
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
 *    `collapsed` joined this layer so the panel *follows the terminal* (#959) —
 *    a PR-review terminal keeps its panel open while a build-log terminal keeps
 *    its closed, instead of one global bit forcing both. Unlike `useSubPanel`
 *    (which seeds from a plain static default), a fresh terminal seeds
 *    `collapsed` by reading through the `newTerminalCollapsed` preference above,
 *    then owns it. Persisted per-terminal via session restore, so it survives a
 *    reload the same way the active tab does.
 *
 *  Callers read/write for the *active* terminal — the API is parameterless,
 *  resolving the current terminal id from `useTerminalStore` internally. */

import {
  type CodeTabView,
  DEFAULT_RIGHT_PANEL_PER_TERMINAL,
  type RightPanelPerTerminalState,
  type RightPanelTab,
  rightPanelView,
} from "@kolu/padi/surface";
import {
  type Browser,
  createBrowser,
  DEFAULT_MAX_ENTRIES,
} from "@kolu/solid-browser";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { toast } from "solid-sonner";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileStore } from "../tile/useTileStore";
import { isDesktop } from "../useMobile";
import { activePadiRpc, preferences, updatePreferences } from "../wire";

/** A spot in the Code tab's navigable space — the unit `@kolu/solid-browser`'s
 *  history records. `mode` is the All/Local/Branch sub-view, carried *inside*
 *  the location so back/forward cross modes naturally; `path` is the selected
 *  repo-relative file (null when the mode has no selection yet); `ref` is an
 *  optional line range to re-highlight when the entry is revisited (terminal
 *  `path:N` links, comment jumps), absent for plain file picks. */
export type BrowserLocation = {
  mode: CodeTabView;
  path: string | null;
  ref?: { startLine: number; endLine: number };
};

/** Two locations name the "same page" — same file in the same mode — when
 *  their mode+path match. `navigate` then refreshes the entry's `ref` in place
 *  instead of recording a duplicate (re-opening the current file at a new line
 *  doesn't deepen history). This idempotence is what lets every navigation
 *  funnel — including Pierre's echoed re-selects — call `recordNavigation`
 *  without risking double history entries. */
const SAME_LOCATION = (a: BrowserLocation, b: BrowserLocation): boolean =>
  a.mode === b.mode && a.path === b.path;

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
 *  a single lifecycle (seeded in `seedPanel`, dropped in `removePanel`, reset
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

/** Single owner of a terminal history controller's construction contract:
 *  `isSameEntry: SAME_LOCATION` (idempotent on mode+path) and the explicit
 *  `DEFAULT_MAX_ENTRIES` cap, wired in exactly one place. Always an empty
 *  stack — seeding (session restore) and clearing (repo change) happen *in
 *  place* via `browser.reset(...)`, never by building a replacement, so the
 *  instance (and the toolbar's reactive subscriptions to its enablement
 *  signals) survives every reset. */
function newBrowserFor(): Browser<BrowserLocation> {
  return createBrowser<BrowserLocation>({
    isSameEntry: SAME_LOCATION,
    maxEntries: DEFAULT_MAX_ENTRIES,
  });
}

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
    h = { browser: newBrowserFor(), lastRepo: undefined };
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

function ensureState(id: TerminalId): void {
  if (perTerminal[id]) return;
  setPerTerminal(id, freshPerTerminalState());
}

function reportToServer(id: TerminalId): void {
  const s = perTerminal[id];
  if (!s) return;
  void activePadiRpc.surface.chrome
    .setRightPanel({
      id,
      collapsed: s.collapsed,
      activeTab: s.activeTab,
      codeMode: s.codeMode,
      selectedFileByMode: s.selectedFileByMode,
    })
    .catch((err: Error) =>
      // A rejected `setRightPanel` means the optimistic per-terminal state
      // (collapsed / active tab / code mode / selected file) is NOT persisted —
      // it silently reverts on the next session restore. The connection-health
      // pip only reports TRANSPORT health, so an application-level rejection
      // (validation / authorization) on an otherwise-live padi would go
      // unseen; surface it per the repo's terminal-mutation rule (toast with
      // the server message). One STABLE toast id dedups the failure so a downed
      // padi — where every tab/file/collapse write fails — collapses onto a
      // single toast instead of one per interaction.
      toast.error(`Failed to save panel state: ${err.message}`, {
        id: "right-panel-report-failed",
      }),
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

  /** The desktop panel's collapsed bit — PER-TERMINAL, so the panel follows the
   *  terminal (#959): each terminal remembers whether its panel was showing,
   *  alongside its active tab and selected file (all on the same
   *  `TerminalMetadata.rightPanel` record). Reads the ACTIVE terminal's value; a
   *  terminal with no record yet (fresh, or none active) reads the new-terminal
   *  default from `preferences.newTerminalCollapsed` via `freshPerTerminalState`.
   *  It survives reload via session restore, exactly like the active tab. Only the
   *  take-up-space *geometry* (`size`/`codeTabTreeSize` below) stays global. */
  const collapsed = (): boolean => activeState().collapsed;

  /** Read the per-terminal record for the active terminal, falling back
   *  to defaults when no terminal is active or the terminal has no record
   *  yet. The returned object is read-only — write through the mutators. */
  function activeState(): RightPanelPerTerminalState {
    const id = store.activeId();
    if (id === null) return freshPerTerminalState();
    return perTerminal[id] ?? freshPerTerminalState();
  }

  /** Mutate the active terminal's per-terminal record. No-op when no
   *  terminal is active — clicks on the panel before a terminal exists
   *  are dropped silently.
   *
   *  Accepts either a shallow patch (`Partial<RightPanelPerTerminalState>`)
   *  or a producer function for nested updates (e.g. mutating one key in
   *  `selectedFileByMode`). Both paths share the same `ensureState →
   *  setStore → reportToServer` triplet so future contract changes
   *  (client-side equality gate, telemetry) land in one place. */
  function mutateActive(
    update:
      | Partial<RightPanelPerTerminalState>
      | ((s: RightPanelPerTerminalState) => void),
  ): void {
    const id = store.activeId();
    if (id === null) return;
    ensureState(id);
    if (typeof update === "function") {
      setPerTerminal(id, produce(update));
    } else {
      setPerTerminal(id, update);
    }
    reportToServer(id);
  }

  /** Write the ACTIVE terminal's `collapsed` bit (per-terminal, reported to the
   *  server for session restore). Naturally a no-op on an empty workspace — the
   *  EmptyState owns the screen and there's no active terminal, so `mutateActive`
   *  drops the write rather than recording a ghost state. Every collapsed-mutating
   *  path (toggle/collapse/expand and `reveal`'s desktop branch) routes through
   *  here so the per-terminal write lives in one place rather than per-caller. */
  const setCollapsed = (next: boolean) => {
    mutateActive({ collapsed: next });
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

    // ── Per-terminal task state ──────────────────────────────────────
    /** DU view of the active tab — `{ kind: "inspector" }` or
     *  `{ kind: "code", mode }`. Matches `match(...).with(...).exhaustive()`. */
    activeTab: (): RightPanelTab => rightPanelView(activeState()),
    /** Persisted Code-tab sub-mode regardless of which tab is active.
     *  CodeTab needs the mode even when the user has flipped over to
     *  Inspector — selection / filter state is keyed by it, and the
     *  fallback behaviour of reading `activeTab` would mask a "browse"
     *  selection as "local" while Inspector is active and trigger a
     *  spurious reset on the round-trip back. */
    codeMode: (): CodeTabView => activeState().codeMode,
    /** Switch to Inspector. `codeMode` is preserved so toggling back to Code
     *  restores the user's last sub-mode. */
    showInspector: () => mutateActive({ activeTab: "inspector" }),
    /** Switch to Code tab. When `mode` is omitted, the persisted `codeMode`
     *  is used — this is the round-trip case (Inspector→Code restores the
     *  last view). Pass `mode` explicitly to override. */
    showCode: (mode?: CodeTabView) =>
      mutateActive({
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
      const cur = activeState();
      if (cur.activeTab === "code" && cur.codeMode === mode) return;
      mutateActive({ activeTab: "code", codeMode: mode });
    },
    /** Change the sub-mode within the Code tab. */
    setCodeMode: (mode: CodeTabView) => mutateActive({ codeMode: mode }),

    /** Per-mode file selection — repo-relative path, or null when no file
     *  is selected in this mode. Keyed by `(activeTerminal, mode)` so each
     *  terminal remembers its own pick in each of local/branch/browse. */
    selectedFile: (mode: CodeTabView): string | null =>
      activeState().selectedFileByMode?.[mode] ?? null,
    setSelectedFile: (mode: CodeTabView, path: string | null) => {
      mutateActive((s) => {
        const cur = s.selectedFileByMode ?? {};
        if (path === null) {
          if (!(mode in cur)) return;
          const { [mode]: _, ...rest } = cur;
          s.selectedFileByMode =
            Object.keys(rest).length > 0 ? rest : undefined;
        } else {
          if (cur[mode] === path) return;
          s.selectedFileByMode = { ...cur, [mode]: path };
        }
      });
    },

    // ── Navigation history (back / forward) ──────────────────────────
    /** Record a visit to `loc` in the active terminal's history — the
     *  address-bar path. Idempotent on mode+path (re-recording the current
     *  location refreshes its `ref` in place rather than duplicating it), so
     *  it's safe to call from every navigation funnel — tree click, in-iframe
     *  link, resolved front-door open, and Pierre's echoed re-selects alike.
     *  Records only; `selectedFileByMode` stays the render truth. */
    recordNavigation: (loc: BrowserLocation) => {
      const id = store.activeId();
      if (id !== null) browserFor(id).navigate(loc);
    },
    /** Step back one entry, returning the now-current location to re-apply (or
     *  null when there's nowhere to go). Traversal, not a new visit — does NOT
     *  record. */
    navigateBack: (): BrowserLocation | null => {
      const id = store.activeId();
      return id === null ? null : browserFor(id).back();
    },
    /** Step forward one entry, returning the now-current location (or null). */
    navigateForward: (): BrowserLocation | null => {
      const id = store.activeId();
      return id === null ? null : browserFor(id).forward();
    },
    /** Reactive: is there an earlier entry to return to? Drives ◀ enablement. */
    canNavigateBack: (): boolean => {
      const id = store.activeId();
      return id === null ? false : browserFor(id).canBack();
    },
    /** Reactive: is there a later entry to advance to? Drives ▶ enablement. */
    canNavigateForward: (): boolean => {
      const id = store.activeId();
      return id === null ? false : browserFor(id).canForward();
    },
    /** Reconcile a terminal's history with the repo it currently sits in,
     *  dropping the stack only when *that terminal's own* repo has changed
     *  since the history was last touched.
     *
     *  The recorded locations are repo-relative paths (`{ mode, path }`) with
     *  no repo identity of their own, so they are only meaningful within the
     *  repo they were captured in. When a terminal `cd`s from repo A to repo B,
     *  re-applying an A-relative entry inside B would open the wrong same-named
     *  file (or a path B's membership effect then clears). Resetting on a
     *  genuine repo change keeps back/forward scoped to the repo currently
     *  shown; the next `recordNavigation` re-seeds the stack.
     *
     *  The decision is keyed PER TERMINAL (`history.get(id).lastRepo`), not
     *  against the previously active terminal: `CodeTab` is a singleton over the active
     *  terminal and only calls this for whichever terminal is active, but a
     *  terminal's repo can change while it is INACTIVE (a `cd` in its PTY
     *  updates server metadata unobserved). Tracking each terminal's last-seen
     *  repo independently catches that change the moment the terminal next
     *  becomes active — even if other terminals were active in between — without
     *  wiping a freshly-activated terminal's history just because the active
     *  repo shifted on a plain switch. The first call for a terminal records
     *  its repo without resetting, so a session-restored (seeded) stack
     *  survives the initial mount. */
    syncRepo: (id: TerminalId, repo: string | null) => {
      // `historyFor` resolves (creating if absent) the terminal's record, so a
      // `lastRepo` of `undefined` is the sole "no repo recorded yet" marker —
      // distinct from `null` ("recorded, terminal is in no repo").
      const h = historyFor(id);
      const prevRepo = h.lastRepo;
      h.lastRepo = repo;
      // First sight of this terminal (fresh mount or session restore): adopt
      // its repo as the baseline, leaving any seeded stack intact. A genuine
      // repo move on a terminal we've already seen drops the now-stale stack —
      // cleared in place so the toolbar stays subscribed to the live instance.
      if (prevRepo !== undefined && repo !== prevRepo) {
        h.browser.reset();
      }
    },

    // ── Session restore + lifecycle ──────────────────────────────────
    /** Seed per-terminal state from server data — no report-back to
     *  server. Called by `useSessionRestore` during hydration and after
     *  recreating a saved terminal. */
    seedPanel: (id: TerminalId, state: RightPanelPerTerminalState) => {
      setPerTerminal(id, state);
      // Seed the history with the restored location so back/forward have a
      // starting point matching what's shown — but only when a file was
      // actually selected; a restored-but-empty mode starts with no history.
      // `lastRepo: undefined` resets the repo baseline so the next `syncRepo`
      // re-adopts this terminal's current repo without resetting — the stack we
      // just seeded is the truth, and re-seeding is a "this is a fresh start"
      // event, same as first mount.
      const path = state.selectedFileByMode?.[state.codeMode] ?? null;
      const h = historyFor(id);
      h.browser.reset(
        path !== null ? { mode: state.codeMode, path } : undefined,
      );
      h.lastRepo = undefined;
    },
    /** Clean up state for a terminal that no longer exists. Mirrors
     *  `useSubPanel.removePanel`. */
    removePanel: (id: TerminalId) => {
      setPerTerminal(produce((s) => delete s[id]));
      history.delete(id);
    },
  } as const;
}
