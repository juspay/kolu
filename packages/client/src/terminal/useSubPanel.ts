/** Sub-panel UI state — singleton module. Tracks collapsed, size, active tab per parent terminal.
 *  Reported to server for session snapshots; seeded from server on restore. */

import type { TerminalId } from "kolu-common/surface";
import { nonEmpty } from "nonempty";
import { createStore, produce } from "solid-js/store";
import { toast } from "solid-sonner";
import { useViewState } from "../useViewState";
import { activePadiRpc } from "../wire";

interface SubPanelState {
  collapsed: boolean;
  /** Panel size as fraction (0–1). */
  panelSize: number;
  activeSubTab: TerminalId | null;
  /** Bumped to force the focus-target terminal to re-grab keyboard focus when
   *  the reactive `focused` state can't (it didn't change). Closing a sub-tab
   *  via its close button moves focus to that button; after the tab is removed
   *  the browser's focus-after-removal is non-deterministic, so we re-assert. */
  refocusNonce: number;
}

export const DEFAULT_PANEL_SIZE = 0.3;

const [state, setState] = createStore<Record<TerminalId, SubPanelState>>({});

function ensureState(parentId: TerminalId): SubPanelState {
  const existing = state[parentId];
  if (existing) return existing;
  const seeded: SubPanelState = {
    collapsed: false,
    panelSize: DEFAULT_PANEL_SIZE,
    activeSubTab: null,
    refocusNonce: 0,
  };
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
  const view = useViewState();

  function focusVisiblePane(parentId: TerminalId): void {
    const panel = state[parentId];
    view.focusTerminal(
      panel && !panel.collapsed && panel.activeSubTab
        ? panel.activeSubTab
        : parentId,
    );
  }

  return {
    /** Pure read: absence stays absent. Derivations never seed panel state. */
    peekSubPanel(parentId: TerminalId): SubPanelState | undefined {
      return state[parentId];
    },

    togglePanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", (v) => !v);
      focusVisiblePane(parentId);
      reportToServer(parentId);
    },

    expandPanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", false);
      focusVisiblePane(parentId);
      reportToServer(parentId);
    },

    collapsePanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", true);
      view.focusTerminal(parentId);
      reportToServer(parentId);
    },

    setActiveSubTab(parentId: TerminalId, subId: TerminalId | null) {
      const panel = ensureState(parentId);
      const focused = view.focusedTerminalId();
      const followedActiveTab =
        panel.activeSubTab !== null && focused === panel.activeSubTab;
      setState(parentId, "activeSubTab", subId);
      if (followedActiveTab) view.focusTerminal(subId ?? parentId);
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
      const followedActiveTab = view.focusedTerminalId() === panel.activeSubTab;
      setState(parentId, "activeSubTab", nextId);
      if (followedActiveTab) view.focusTerminal(nextId);
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
        activeSubTab: state[parentId]?.activeSubTab ?? null,
        refocusNonce: state[parentId]?.refocusNonce ?? 0,
      });
    },

    /** Clean up state for a parent that no longer exists. */
    removePanel(parentId: TerminalId) {
      setState(produce((s) => delete s[parentId]));
    },
  } as const;
}
