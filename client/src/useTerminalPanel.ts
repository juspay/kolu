/** Terminal panel UI state — singleton module. Tracks collapsed, size, active tab per workspace. */

import { createStore, produce } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId } from "kolu-common";

interface SubPanelState {
  collapsed: boolean;
  /** Panel size as fraction (0–1). */
  panelSize: number;
  activeSubTab: TerminalId | null;
  /** Which panel last had focus — restored when switching back to this terminal. */
  focusTarget: "main" | "sub";
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
      focusTarget: "sub",
    });
  }
  return state[parentId]!;
}

export function useTerminalPanel() {
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
      setState(parentId, "focusTarget", "sub");
    },

    collapsePanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", true);
      setState(parentId, "focusTarget", "main");
    },

    setActiveSubTab(parentId: TerminalId, subId: TerminalId | null) {
      ensureState(parentId);
      setState(parentId, "activeSubTab", subId);
    },

    setPanelSize(parentId: TerminalId, size: number) {
      ensureState(parentId);
      setState(parentId, "panelSize", size);
    },

    /** Cycle to the next/previous sub-tab within a parent's sub-panel. */
    cycleSubTab(parentId: TerminalId, subIds: TerminalId[], direction: 1 | -1) {
      if (subIds.length === 0) return;
      const panel = ensureState(parentId);
      const current = subIds.indexOf(panel.activeSubTab as string);
      const next = (current + direction + subIds.length) % subIds.length;
      setState(parentId, "activeSubTab", subIds[next]!);
    },

    setFocusTarget(parentId: TerminalId, target: "main" | "sub") {
      ensureState(parentId);
      setState(parentId, "focusTarget", target);
    },

    /** Clean up state for a parent that no longer exists. */
    removePanel(parentId: TerminalId) {
      setState(produce((s) => delete s[parentId]));
    },
  } as const;
}
