/** A tile's PANE CHROME — which split tab is showing, which pane a landing
 *  returns to, and the DOM-focus nonce. Singleton module, browser-only by
 *  construction: none of it is persisted, and none of it decides a pane's box.
 *
 *  What is NOT here any more is the split's SAVED state (collapsed, divider
 *  position). That lives on the terminal's record and is read through
 *  `splitPanelState.ts` — see its header for why a second copy of it was a
 *  defect rather than a cache. The verbs below still read and write it,
 *  because collapsing a split is one gesture that moves both facts; they just
 *  no longer own half of it. */

import type { TerminalId } from "kolu-common/surface";
import { nonEmpty } from "nonempty";
import { createStore, produce } from "solid-js";
import { activeScope } from "../hostScope/hostScopes";
import { type SplitPanelState, useSplitPanelState } from "./splitPanelState";

interface PaneChrome {
  activeSubTab: TerminalId | null;
  /** Landing chrome only: verbs remember which pane to choose when this tile
   *  is selected again. Focus derivations never read it. Optional so session
   *  chrome hydration does not seed a focus preference; absence means main. */
  rememberedPane?: "main" | "sub";
  /** Bumped to force the focus-target terminal to re-grab keyboard focus when
   *  the reactive `focused` state can't (it didn't change). Closing a sub-tab
   *  via its close button moves focus to that button; after the tab is removed
   *  the browser's focus-after-removal is non-deterministic, so we re-assert. */
  refocusNonce: number;
}

const DEFAULT_PANE_CHROME: Readonly<PaneChrome> = Object.freeze({
  activeSubTab: null,
  rememberedPane: "main",
  refocusNonce: 0,
});

/** The actor a `plan…` verb hands back when its reads decided there is
 *  nothing to write (no active host, a value already saved). One shared
 *  no-op rather than a fresh closure per plan. */
const NOTHING_TO_WRITE = (): void => {};

const [state, setState] = createStore<Record<TerminalId, PaneChrome>>({});

function ensureState(parentId: TerminalId): PaneChrome {
  const existing = state[parentId];
  if (existing) return existing;
  const seeded: PaneChrome = { ...DEFAULT_PANE_CHROME };
  setState(
    produce((all) => {
      all[parentId] = seeded;
    }),
  );
  return seeded;
}

/** Write one tile's pane chrome in place, seeding it from the defaults first
 *  when the tile has none yet. */
function editChrome(
  parentId: TerminalId,
  write: (panel: PaneChrome) => void,
): void {
  setState(
    produce((all) => {
      const held = all[parentId];
      const panel = held ?? { ...DEFAULT_PANE_CHROME };
      write(panel);
      if (!held) all[parentId] = panel;
    }),
  );
}

export function useSubPanel() {
  const split = useSplitPanelState();
  const focusedTerminalId = (): TerminalId | null =>
    activeScope()?.view.focusedTerminalId() ?? null;

  /** THE READER HALF of the raw fact write, deliberately trapped inside this
   *  panel boundary. Every exported caller below first establishes or checks
   *  the pane chrome invariant; the broad terminal/view facades never expose
   *  this operation.
   *
   *  A `plan…` verb does ALL the reactive reads (the active scope, the focused
   *  pane, this tile's chrome) and hands back the WRITES as a function. That
   *  split is what lets a Solid effect drive these verbs: an effect callback is
   *  a strict-read window, so the plan runs in the effect's COMPUTE and the
   *  returned actor — writes only — runs in the effect. An event handler, which
   *  may read freely, calls the eager verb beside it and pays nothing.
   *
   *  Hoisting the reads ahead of the writes changes no answer: a write is
   *  staged, so a read after it in the same synchronous run already returned
   *  the pre-write value.
   *
   *  A missing active scope is the expected host-removal race and follows the
   *  active-host facade convention: the departing owner's write is a no-op. */
  function planPaneFocus(
    parentId: TerminalId,
    id: TerminalId,
    remember = true,
  ): () => void {
    const view = activeScope()?.view;
    if (!view) return NOTHING_TO_WRITE;
    const repeatsCurrentPane = view.focusedTerminalId() === id;
    const rememberedPane = id === parentId ? "main" : "sub";
    // Preserve the implicit main default for a never-touched tile: landing on
    // it must not seed panel state merely to record the value it already has.
    const recordsPane =
      remember && (state[parentId] !== undefined || rememberedPane === "sub");
    return () => {
      if (recordsPane)
        editChrome(parentId, (p) => {
          p.rememberedPane = rememberedPane;
        });
      view.writeFocus({ id, tileHint: parentId });
      // `focusedTerminalId` is a value memo, so an equal-id write correctly does
      // not notify its consumers. Selection may still need to restore DOM focus
      // after a dock row or close button took it; the existing nonce is the
      // edge-less DOM impulse, never another focus authority.
      if (repeatsCurrentPane) {
        editChrome(parentId, (p) => {
          p.refocusNonce += 1;
        });
      }
    };
  }

  function writePaneFocus(
    parentId: TerminalId,
    id: TerminalId,
    remember = true,
  ): void {
    planPaneFocus(parentId, id, remember)();
  }

  function planFocusVisiblePane(parentId: TerminalId): () => void {
    const panel = state[parentId];
    const open = !split.state(parentId).collapsed;
    return planPaneFocus(
      parentId,
      panel?.rememberedPane === "sub" && open && panel.activeSubTab
        ? panel.activeSubTab
        : parentId,
      false,
    );
  }

  /** Expanding an existing split is not a tile landing: the newly visible
   *  active tab receives focus directly. `rememberedPane` is deliberately not
   *  read here; only top-level tile activation consults that landing chrome. */
  function focusExpandedPanel(parentId: TerminalId): void {
    const panel = state[parentId];
    writePaneFocus(parentId, panel?.activeSubTab ?? parentId);
  }

  /** Seed a tile's chrome if it has none — the reader half of `ensureState`:
   *  the presence check is the read, the seeding is the write. */
  function planEnsureState(parentId: TerminalId): () => void {
    if (state[parentId]) return NOTHING_TO_WRITE;
    return () => {
      editChrome(parentId, () => {});
    };
  }

  /** Write a tile's saved split state — the ONE place these verbs reach the
   *  record, so every writer below is a gesture that passed through here. */
  const planSaveSplit = (
    parentId: TerminalId,
    next: Partial<SplitPanelState>,
  ): (() => void) =>
    split.planWrite(parentId, { ...split.state(parentId), ...next });
  const saveSplit = (parentId: TerminalId, next: Partial<SplitPanelState>) => {
    planSaveSplit(parentId, next)();
  };

  function planClearFocus(): () => void {
    const view = activeScope()?.view;
    if (!view) return NOTHING_TO_WRITE;
    return () => view.writeFocus(null);
  }

  function planCollapsePanel(parentId: TerminalId): () => void {
    const collapse = planSaveSplit(parentId, { collapsed: true });
    // Collapsing temporarily forces input to main; it must not erase the pane
    // to restore when the user reopens this same split.
    const land = planPaneFocus(parentId, parentId, false);
    return () => {
      collapse();
      land();
    };
  }

  function planSelectSubTab(
    parentId: TerminalId,
    subId: TerminalId | null,
  ): () => void {
    const land = planPaneFocus(parentId, subId ?? parentId);
    return () => {
      editChrome(parentId, (p) => {
        p.activeSubTab = subId;
      });
      land();
    };
  }

  function planFocusSubTab(
    parentId: TerminalId,
    subId: TerminalId,
  ): () => void {
    const reveal = planSaveSplit(parentId, { collapsed: false });
    const land = planPaneFocus(parentId, subId);
    return () => {
      editChrome(parentId, (p) => {
        p.activeSubTab = subId;
      });
      reveal();
      land();
    };
  }

  function planFocusMainPane(parentId: TerminalId): () => void {
    const seed = planEnsureState(parentId);
    const land = planPaneFocus(parentId, parentId);
    return () => {
      seed();
      land();
    };
  }

  return {
    /** A tile's SAVED split state, off the record. */
    savedSplit: split.state,

    /** Pure read of the browser-only pane chrome: an absent entry returns the
     *  immutable defaults without seeding the store. */
    paneChrome(parentId: TerminalId): Readonly<PaneChrome> {
      return state[parentId] ?? DEFAULT_PANE_CHROME;
    },

    /** Focus a top-level tile's remembered pane. Both rememberedPane and the
     *  remembered tab are verb-only chrome: this verb resolves them immediately
     *  and writes the same one per-host focus fact as every other transition. */
    focusVisiblePane,
    /** Reader half of {@link focusVisiblePane}, for a caller inside an effect:
     *  run it in the compute, run what it returns in the effect. */
    planFocusVisiblePane,

    /** Clear selection through the same narrow focus boundary. No pane chrome
     *  exists to update when there is no focused terminal. */
    clearFocus() {
      planClearFocus()();
    },
    /** Reader half of `clearFocus` — the active scope is the read. */
    planClearFocus,

    /** The user asked for the split to open or shut — a gesture, so it writes
     *  the saved state. */
    togglePanel(parentId: TerminalId) {
      const collapsing = !split.state(parentId).collapsed;
      saveSplit(parentId, { collapsed: collapsing });
      if (collapsing) writePaneFocus(parentId, parentId, false);
      else focusExpandedPanel(parentId);
    },

    /** A split ARRIVED (created here, or by an agent through MCP) and the tile
     *  opens to show it — a real change of what the user is looking at, so it
     *  is saved. It takes no focus; `expandAndFocusPanel` is the gesture. */
    expandPanel(parentId: TerminalId) {
      saveSplit(parentId, { collapsed: false });
    },
    /** Reader half of `expandPanel` — the tile's current saved split is the
     *  read, so a split ARRIVING on the metadata stream (an effect) can open
     *  the tile. */
    planExpandPanel(parentId: TerminalId) {
      return planSaveSplit(parentId, { collapsed: false });
    },

    /** User-driven expansion: open the split and focus its visible active
     *  split. External split adoption uses the chrome-only `expandPanel` so an
     *  arrival never steals focus. */
    expandAndFocusPanel(parentId: TerminalId) {
      saveSplit(parentId, { collapsed: false });
      focusExpandedPanel(parentId);
    },

    /** Collapse with no focus move — the tab strip's own shut button. */
    collapsePanelChrome(parentId: TerminalId) {
      saveSplit(parentId, { collapsed: true });
    },
    planCollapsePanelChrome(parentId: TerminalId) {
      return planSaveSplit(parentId, { collapsed: true });
    },

    collapsePanel(parentId: TerminalId) {
      planCollapsePanel(parentId)();
    },
    planCollapsePanel,

    /** Chrome-only remembered-tab update for hydration, adoption, and landing
     *  orchestration. Explicit user selection uses `selectSubTab`. Writes only,
     *  so an effect may call it directly. */
    setActiveSubTab(parentId: TerminalId, subId: TerminalId | null) {
      editChrome(parentId, (p) => {
        p.activeSubTab = subId;
      });
    },

    /** Explicit tab choice: update remembered chrome and focus exactly once. */
    selectSubTab(parentId: TerminalId, subId: TerminalId | null) {
      planSelectSubTab(parentId, subId)();
    },
    planSelectSubTab,

    /** Split landing: reveal the chosen tab without focus side effects, then
     *  commit the one focus fact exactly once. */
    focusSubTab(parentId: TerminalId, subId: TerminalId) {
      planFocusSubTab(parentId, subId)();
    },
    planFocusSubTab,

    /** Pane DOM focus may commit only a pane already made visible by chrome. */
    focusMainPane(parentId: TerminalId) {
      planFocusMainPane(parentId)();
    },
    planFocusMainPane,

    focusVisibleSubPane(parentId: TerminalId, subId: TerminalId) {
      const panel = ensureState(parentId);
      if (split.state(parentId).collapsed || panel.activeSubTab !== subId) {
        throw new Error(
          `focusVisibleSubPane: ${subId} is not the visible split of ${parentId}`,
        );
      }
      writePaneFocus(parentId, subId);
    },

    /** The user dragged the divider — the one gesture that moves it. */
    setPanelSize(parentId: TerminalId, size: number) {
      saveSplit(parentId, { panelSize: size });
    },

    /** Cycle to the next/previous sub-tab within a parent's sub-panel. */
    cycleSubTab(parentId: TerminalId, subIds: TerminalId[], direction: 1 | -1) {
      const ne = nonEmpty(subIds);
      if (!ne) return;
      const panel = ensureState(parentId);
      const current = ne.indexOf(panel.activeSubTab as string);
      const next = (current + direction + ne.length) % ne.length;
      const nextId = ne[next] ?? ne[0];
      const followedActiveTab = focusedTerminalId() === panel.activeSubTab;
      editChrome(parentId, (p) => {
        p.activeSubTab = nextId;
      });
      if (followedActiveTab) writePaneFocus(parentId, nextId);
    },

    /** Ask the current focus-target terminal to re-grab keyboard focus. Used
     *  after closing a sub-tab, where focus lands on the (about-to-be-removed)
     *  close button and the reactive `focused` state is unchanged, so the
     *  edge-triggered focus effect can't restore it on its own. */
    requestRefocus(parentId: TerminalId) {
      editChrome(parentId, (p) => {
        p.refocusNonce += 1;
      });
    },

    /** Clean up state for a parent that no longer exists — the browser-only
     *  chrome here, and any in-flight split write it left behind. */
    removePanel(parentId: TerminalId) {
      setState(produce((s) => delete s[parentId]));
      split.forget(parentId);
    },
  } as const;
}

/** The panel verbs a TAB-STRIP REPAIR drives. Named here, with the rule that
 *  uses them, because the invariant being restored is the PANEL's: a tile's
 *  `activeSubTab` is null or a LIVE pane of that tile. The repair deliberately
 *  cannot reach the panel's destructive or focus-carrying verbs — it may not
 *  drop a panel, and it does not decide focus — so its seam is this, not the
 *  panel's whole surface. */
export type TabStripRepairPorts = {
  planCollapsePanel: (parentId: TerminalId) => () => void;
  planCollapsePanelChrome: (parentId: TerminalId) => () => void;
  paneChrome: (parentId: TerminalId) => { activeSubTab: TerminalId | null };
  setActiveSubTab: (parentId: TerminalId, subId: TerminalId | null) => void;
  planSelectSubTab: (
    parentId: TerminalId,
    subId: TerminalId | null,
  ) => () => void;
};

/** What the EVICTION reconcile drives beyond a repair: the DOM-focus nonce (a
 *  close button took the focus) and the outright drop of a departed tile's
 *  panel state. */
export type EvictionSubPanelPorts = TabStripRepairPorts & {
  requestRefocus: (parentId: TerminalId) => void;
  removePanel: (parentId: TerminalId) => void;
};

/** Repair a tile's tab strip once its panes are no longer the ones it had:
 *  clear an `activeSubTab` that no longer names a pane of this tile (or collapse
 *  the panel when nothing remains under it), and pick a successor.
 *
 *  The test is MEMBERSHIP IN `remaining`, not "is it the pane that left". A pane
 *  can take its own splits with it — drag a split that has a split under it and
 *  the tile's active tab may name the GRANDCHILD, which the leaving id alone
 *  would miss, leaving exactly the dangling tab this repair exists to forbid.
 *
 *  `remaining` is every pane still belonging to the tile, in order; a `null`
 *  active tab stays null (nothing to repair). `leavingWasFocused` picks whether
 *  the successor verb also carries the focus fact. TWO callers, one rule: the
 *  eviction reconcile (panes departed the census) and the Dock's drag re-home (a
 *  pane left its tile but is still alive). The invariant they both restore —
 *  "`activeSubTab` is null or a LIVE sub of this tile" — has consumers that
 *  trust a plain null-check for "no active split" (the adopt don't-steal guard,
 *  `focusVisiblePane`), so it gets one author rather than one per mutation.
 *
 *  Both callers run inside a Solid effect, where a reactive read is forbidden,
 *  so this is a PLANNER: the reads (the tile's active tab, the saved split each
 *  collapse supersedes) happen when it is called — from the effect's compute —
 *  and the writes ride the function it returns. */
export function planTileTabsRepair(
  panel: TabStripRepairPorts,
  tileId: TerminalId,
  remaining: readonly TerminalId[],
  leavingWasFocused: boolean,
): () => void {
  if (remaining.length === 0) {
    const collapse = leavingWasFocused
      ? panel.planCollapsePanel(tileId)
      : panel.planCollapsePanelChrome(tileId);
    return () => {
      collapse();
      // Clear the active tab too: the tile's last split is gone, so
      // `activeSubTab` must not dangle at a departed sub.
      panel.setActiveSubTab(tileId, null);
    };
  }
  const active = panel.paneChrome(tileId).activeSubTab;
  if (active === null || remaining.includes(active)) return () => {};
  const replacement = remaining[0] ?? null;
  if (!leavingWasFocused) return () => panel.setActiveSubTab(tileId, replacement);
  return panel.planSelectSubTab(tileId, replacement);
}
