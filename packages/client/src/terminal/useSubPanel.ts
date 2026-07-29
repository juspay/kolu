/** Sub-panel UI state — singleton module. Tracks collapsed, size, active tab, and remembered pane per parent terminal.
 *  Reported to server for session snapshots; seeded from server on restore. */

import type { TerminalId } from "kolu-common/surface";
import { nonEmpty } from "nonempty";
import { createStore, produce } from "solid-js/store";
import { toast } from "solid-sonner";
import { activeScope } from "../hostScope/hostScopes";
import { activePadiRpc } from "../wire";

interface SubPanelState {
  collapsed: boolean;
  /** Panel size as fraction (0–1). */
  panelSize: number;
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

const DEFAULT_PANEL_STATE: Readonly<SubPanelState> = Object.freeze({
  collapsed: false,
  panelSize: 0.3,
  activeSubTab: null,
  rememberedPane: "main",
  refocusNonce: 0,
});

const [state, setState] = createStore<Record<TerminalId, SubPanelState>>({});

function ensureState(parentId: TerminalId): SubPanelState {
  const existing = state[parentId];
  if (existing) return existing;
  const seeded: SubPanelState = { ...DEFAULT_PANEL_STATE };
  setState(parentId, seeded);
  return seeded;
}

/** Report sub-panel state to server for session persistence. */
function reportToServer(parentId: TerminalId) {
  const s = state[parentId];
  if (!s) return;
  void activePadiRpc.chrome
    .setSubPanel({
      id: parentId,
      collapsed: s.collapsed,
      panelSize: s.panelSize,
    })
    .catch((err: Error) =>
      // Mirror `useRightPanel.reportToServer`: a rejected `setSubPanel` means
      // the optimistic sub-panel state (collapsed / size) is NOT persisted and
      // silently reverts on the next session restore. The health pip reports
      // only TRANSPORT health, so an application-level rejection on an
      // otherwise-live padi would go unseen — surface it per the terminal-
      // mutation rule (toast with the server message). One STABLE id dedups the
      // failure so a downed padi collapses onto a single toast, not one per drag.
      toast.error(`Failed to save sub-panel state: ${err.message}`, {
        id: "sub-panel-report-failed",
      }),
    );
}

export function useSubPanel() {
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
    writePaneFocus(
      parentId,
      panel?.rememberedPane === "sub" && !panel.collapsed && panel.activeSubTab
        ? panel.activeSubTab
        : parentId,
    );
  }

  /** Expanding an existing split is not a tile landing: the newly visible
   *  active tab receives focus directly. `rememberedPane` is deliberately not
   *  read here; only top-level tile activation consults that landing chrome. */
  function focusExpandedPanel(parentId: TerminalId): void {
    const panel = state[parentId];
    writePaneFocus(parentId, panel?.activeSubTab ?? parentId);
  }

  return {
    /** Pure read: an absent entry returns the immutable defaults without
     *  seeding the store. */
    peekSubPanel(parentId: TerminalId): Readonly<SubPanelState> {
      return state[parentId] ?? DEFAULT_PANEL_STATE;
    },

    /** Focus a top-level tile's remembered pane. Both rememberedPane and the
     *  remembered tab are verb-only chrome: this verb resolves them immediately
     *  and writes the same one per-host focus fact as every other transition. */
    focusVisiblePane,

    togglePanel(parentId: TerminalId) {
      const panel = ensureState(parentId);
      const collapsing = !panel.collapsed;
      setState(parentId, "collapsed", collapsing);
      if (collapsing) writePaneFocus(parentId, parentId, false);
      else focusExpandedPanel(parentId);
      reportToServer(parentId);
    },

    expandPanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", false);
      reportToServer(parentId);
    },

    /** User-driven expansion: update the panel chrome and focus its visible
     *  active split. External split adoption uses the
     *  chrome-only `expandPanel` so an arrival never steals focus. */
    expandAndFocusPanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", false);
      focusExpandedPanel(parentId);
      reportToServer(parentId);
    },

    /** Chrome-only collapse for Corvu's generic controlled-state callback. */
    collapsePanelChrome(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", true);
      reportToServer(parentId);
    },

    collapsePanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", true);
      // Collapsing temporarily forces input to main; it must not erase the pane
      // to restore when the user reopens this same split.
      writePaneFocus(parentId, parentId, false);
      reportToServer(parentId);
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
      setState(parentId, "collapsed", false);
      reportToServer(parentId);
      writePaneFocus(parentId, subId);
    },

    /** Pane DOM focus may commit only a pane already made visible by chrome. */
    focusMainPane(parentId: TerminalId) {
      ensureState(parentId);
      writePaneFocus(parentId, parentId);
    },

    focusVisibleSubPane(parentId: TerminalId, subId: TerminalId) {
      const panel = ensureState(parentId);
      if (panel.collapsed || panel.activeSubTab !== subId) {
        throw new Error(
          `focusVisibleSubPane: ${subId} is not the visible split of ${parentId}`,
        );
      }
      writePaneFocus(parentId, subId);
    },

    setPanelSize(parentId: TerminalId, size: number) {
      ensureState(parentId);
      setState(parentId, "panelSize", size);
      reportToServer(parentId);
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

    /** Seed sub-panel state from server data — no report-back to server. */
    seedPanel(
      parentId: TerminalId,
      opts: { collapsed: boolean; panelSize: number },
    ) {
      setState(parentId, {
        collapsed: opts.collapsed,
        panelSize: opts.panelSize,
        activeSubTab:
          state[parentId]?.activeSubTab ?? DEFAULT_PANEL_STATE.activeSubTab,
        refocusNonce:
          state[parentId]?.refocusNonce ?? DEFAULT_PANEL_STATE.refocusNonce,
      });
    },

    /** Clean up state for a parent that no longer exists. */
    removePanel(parentId: TerminalId) {
      setState(produce((s) => delete s[parentId]));
    },
  } as const;
}
