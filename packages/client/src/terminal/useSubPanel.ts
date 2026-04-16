/** Sub-panel UI state — singleton module. Tracks collapsed, size, active tab per parent terminal. */

import { createStore, produce } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId } from "kolu-common";
import { client } from "../rpc/rpc";

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

/** Report sub-panel state to server for session persistence. */
function reportToServer(parentId: TerminalId) {
  const s = state[parentId];
  if (!s) return;
  void client.terminal
    .setSubPanel({
      id: parentId,
      collapsed: s.collapsed,
      panelSize: s.panelSize,
    })
    .catch(() => {});
}

export function useSubPanel() {
  return {
    getSubPanel(parentId: TerminalId): SubPanelState {
      return ensureState(parentId);
    },

    togglePanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", (v) => !v);
      reportToServer(parentId);
    },

    expandPanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", false);
      setState(parentId, "focusTarget", "sub");
      reportToServer(parentId);
    },

    collapsePanel(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "collapsed", true);
      setState(parentId, "focusTarget", "main");
      reportToServer(parentId);
    },

    setActiveSubTab(parentId: TerminalId, subId: TerminalId | null) {
      ensureState(parentId);
      setState(parentId, "activeSubTab", subId);
    },

    setPanelSize(parentId: TerminalId, size: number) {
      ensureState(parentId);
      setState(parentId, "panelSize", size);
      reportToServer(parentId);
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
