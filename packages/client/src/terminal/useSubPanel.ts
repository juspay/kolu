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
import { createStore, produce } from "solid-js/store";
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

const [state, setState] = createStore<Record<TerminalId, PaneChrome>>({});

function ensureState(parentId: TerminalId): PaneChrome {
  const existing = state[parentId];
  if (existing) return existing;
  const seeded: PaneChrome = { ...DEFAULT_PANE_CHROME };
  setState(parentId, seeded);
  return seeded;
}

export function useSubPanel() {
  const split = useSplitPanelState();
  const focusedTerminalId = (): TerminalId | null =>
    activeScope()?.view.focusedTerminalId() ?? null;

  /** The raw fact write is deliberately trapped inside this panel boundary.
   *  Every exported caller below first establishes or checks the pane chrome
   *  invariant; the broad terminal/view facades never expose this operation.
   *  A missing active scope is the expected host-removal race and follows the
   *  active-host facade convention: the departing owner's write is a no-op. */
  function writePaneFocus(
    parentId: TerminalId,
    id: TerminalId,
    remember = true,
  ): void {
    const view = activeScope()?.view;
    if (!view) return;
    const repeatsCurrentPane = view.focusedTerminalId() === id;
    if (remember) {
      const rememberedPane = id === parentId ? "main" : "sub";
      const panel = state[parentId];
      // Preserve the implicit main default for a never-touched tile: landing on
      // it must not seed panel state merely to record the value it already has.
      if (panel) setState(parentId, "rememberedPane", rememberedPane);
      else if (rememberedPane === "sub") {
        ensureState(parentId);
        setState(parentId, "rememberedPane", "sub");
      }
    }
    view.writeFocus({ id, tileHint: parentId });
    // `focusedTerminalId` is a value memo, so an equal-id write correctly does
    // not notify its consumers. Selection may still need to restore DOM focus
    // after a dock row or close button took it; the existing nonce is the
    // edge-less DOM impulse, never another focus authority.
    if (repeatsCurrentPane) {
      ensureState(parentId);
      setState(parentId, "refocusNonce", (n) => n + 1);
    }
  }

  function focusVisiblePane(parentId: TerminalId): void {
    const panel = state[parentId];
    const open = !split.state(parentId).collapsed;
    writePaneFocus(
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

  /** Write a tile's saved split state — the ONE place these verbs reach the
   *  record, so every writer below is a gesture that passed through here. */
  const saveSplit = (parentId: TerminalId, next: Partial<SplitPanelState>) => {
    split.write(parentId, { ...split.state(parentId), ...next });
  };

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

    /** Clear selection through the same narrow focus boundary. No pane chrome
     *  exists to update when there is no focused terminal. */
    clearFocus() {
      activeScope()?.view.writeFocus(null);
    },

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

    collapsePanel(parentId: TerminalId) {
      saveSplit(parentId, { collapsed: true });
      // Collapsing temporarily forces input to main; it must not erase the pane
      // to restore when the user reopens this same split.
      writePaneFocus(parentId, parentId, false);
    },

    /** Chrome-only remembered-tab update for hydration, adoption, and landing
     *  orchestration. Explicit user selection uses `selectSubTab`. */
    setActiveSubTab(parentId: TerminalId, subId: TerminalId | null) {
      ensureState(parentId);
      setState(parentId, "activeSubTab", subId);
    },

    /** Explicit tab choice: update remembered chrome and focus exactly once. */
    selectSubTab(parentId: TerminalId, subId: TerminalId | null) {
      ensureState(parentId);
      setState(parentId, "activeSubTab", subId);
      writePaneFocus(parentId, subId ?? parentId);
    },

    /** Split landing: reveal the chosen tab without focus side effects, then
     *  commit the one focus fact exactly once. */
    focusSubTab(parentId: TerminalId, subId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "activeSubTab", subId);
      saveSplit(parentId, { collapsed: false });
      writePaneFocus(parentId, subId);
    },

    /** Pane DOM focus may commit only a pane already made visible by chrome. */
    focusMainPane(parentId: TerminalId) {
      ensureState(parentId);
      writePaneFocus(parentId, parentId);
    },

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
      setState(parentId, "activeSubTab", nextId);
      if (followedActiveTab) writePaneFocus(parentId, nextId);
    },

    /** Ask the current focus-target terminal to re-grab keyboard focus. Used
     *  after closing a sub-tab, where focus lands on the (about-to-be-removed)
     *  close button and the reactive `focused` state is unchanged, so the
     *  edge-triggered focus effect can't restore it on its own. */
    requestRefocus(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "refocusNonce", (n) => n + 1);
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
  collapsePanel: (parentId: TerminalId) => void;
  collapsePanelChrome: (parentId: TerminalId) => void;
  paneChrome: (parentId: TerminalId) => { activeSubTab: TerminalId | null };
  setActiveSubTab: (parentId: TerminalId, subId: TerminalId | null) => void;
  selectSubTab: (parentId: TerminalId, subId: TerminalId | null) => void;
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
 *  `focusVisiblePane`), so it gets one author rather than one per mutation. */
export function repairTileTabs(
  panel: TabStripRepairPorts,
  tileId: TerminalId,
  remaining: readonly TerminalId[],
  leavingWasFocused: boolean,
): void {
  if (remaining.length === 0) {
    if (leavingWasFocused) panel.collapsePanel(tileId);
    else panel.collapsePanelChrome(tileId);
    // Clear the active tab too: the tile's last split is gone, so `activeSubTab`
    // must not dangle at a departed sub.
    panel.setActiveSubTab(tileId, null);
    return;
  }
  const active = panel.paneChrome(tileId).activeSubTab;
  if (active !== null && !remaining.includes(active)) {
    const replacement = remaining[0] ?? null;
    if (leavingWasFocused) panel.selectSubTab(tileId, replacement);
    else panel.setActiveSubTab(tileId, replacement);
  }
}
