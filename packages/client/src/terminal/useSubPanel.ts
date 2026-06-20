/** Sub-panel UI state — singleton module. Tracks collapsed, size, active tab per parent terminal.
 *  Reported to server for session snapshots; seeded from server on restore. */

import type { TerminalId } from "kolu-common/surface";
import { nonEmpty } from "nonempty";
import { createStore, produce } from "solid-js/store";
import { client } from "../wire";

interface SubPanelState {
  collapsed: boolean;
  /** Panel size as fraction (0–1). */
  panelSize: number;
  activeSubTab: TerminalId | null;
  /** Which panel last had focus — restored when switching back to this terminal. */
  focusTarget: "main" | "sub";
  /** Bumped to force the focus-target terminal to re-grab keyboard focus when
   *  the reactive `focused` state can't (it didn't change). Closing a sub-tab
   *  via its close button moves focus to that button; after the tab is removed
   *  the browser's focus-after-removal is non-deterministic, so we re-assert. */
  refocusNonce: number;
}

const DEFAULT_PANEL_SIZE = 0.3;

const [state, setState] = createStore<Record<TerminalId, SubPanelState>>({});

function ensureState(parentId: TerminalId): SubPanelState {
  const existing = state[parentId];
  if (existing) return existing;
  const seeded: SubPanelState = {
    collapsed: false,
    panelSize: DEFAULT_PANEL_SIZE,
    activeSubTab: null,
    focusTarget: "sub",
    refocusNonce: 0,
  };
  setState(parentId, seeded);
  return seeded;
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
      const ne = nonEmpty(subIds);
      if (!ne) return;
      const panel = ensureState(parentId);
      const current = ne.indexOf(panel.activeSubTab as string);
      const next = (current + direction + ne.length) % ne.length;
      setState(parentId, "activeSubTab", ne[next] ?? ne[0]);
    },

    setFocusTarget(parentId: TerminalId, target: "main" | "sub") {
      ensureState(parentId);
      setState(parentId, "focusTarget", target);
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
        focusTarget: opts.collapsed ? "main" : "sub",
        refocusNonce: state[parentId]?.refocusNonce ?? 0,
      });
    },

    /** Clean up state for a parent that no longer exists. */
    removePanel(parentId: TerminalId) {
      setState(produce((s) => delete s[parentId]));
    },
  } as const;
}
