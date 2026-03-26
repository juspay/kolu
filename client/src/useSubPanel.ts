/** Sub-panel UI state — singleton module. Tracks collapsed, size, active tab per parent terminal. */

import { createStore, produce } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId } from "kolu-common";

interface SubPanelState {
  collapsed: boolean;
  /** Panel size as fraction (0–1). */
  panelSize: number;
  activeSubTab: TerminalId | null;
}

const DEFAULT_PANEL_SIZE = 0.3;

const [state, setState] = makePersisted(
  createStore<Record<TerminalId, SubPanelState>>({}),
  { name: "kolu-sub-panels" },
);

function ensureState(parentId: TerminalId): SubPanelState {
  if (!state[parentId]) {
    setState(parentId, {
      collapsed: false,
      panelSize: DEFAULT_PANEL_SIZE,
      activeSubTab: null,
    });
  }
  return state[parentId]!;
}

export function useSubPanel() {
  return {
    getSubPanel(parentId: TerminalId): SubPanelState {
      return ensureState(parentId);
    },

    togglePanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", (v) => !v);
    },

    expandPanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", false);
    },

    collapsePanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", true);
    },

    setActiveSubTab(parentId: TerminalId, subId: TerminalId | null) {
      ensureState(parentId);
      setState(parentId, "activeSubTab", subId);
    },

    setPanelSize(parentId: TerminalId, size: number) {
      ensureState(parentId);
      setState(parentId, "panelSize", size);
    },

    /** Clean up state for a parent that no longer exists. */
    removePanel(parentId: TerminalId) {
      setState(produce((s) => delete s[parentId]));
    },
  } as const;
}
