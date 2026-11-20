import type { TerminalId } from "kolu-common/surface";
import { nonEmpty } from "nonempty";
import { createStore, produce } from "solid-js/store";
import { activeScope } from "../hostScope/hostScopes";
import { type SplitPanelState, useSplitPanelState } from "./splitPanelState";

interface PaneChrome {
  activeSubTab: TerminalId | null;
  rememberedPane?: "main" | "sub";
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
      if (panel) setState(parentId, "rememberedPane", rememberedPane);
      else if (rememberedPane === "sub") {
        ensureState(parentId);
        setState(parentId, "rememberedPane", "sub");
      }
    }
    view.writeFocus({ id, tileHint: parentId });
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

  function focusExpandedPanel(parentId: TerminalId): void {
    const panel = state[parentId];
    writePaneFocus(parentId, panel?.activeSubTab ?? parentId);
  }

  const saveSplit = (parentId: TerminalId, next: Partial<SplitPanelState>) => {
    split.write(parentId, { ...split.state(parentId), ...next });
  };

  return {
    savedSplit: split.state,

    paneChrome(parentId: TerminalId): Readonly<PaneChrome> {
      return state[parentId] ?? DEFAULT_PANE_CHROME;
    },

    focusVisiblePane,

    clearFocus() {
      activeScope()?.view.writeFocus(null);
    },

    togglePanel(parentId: TerminalId) {
      const collapsing = !split.state(parentId).collapsed;
      saveSplit(parentId, { collapsed: collapsing });
      if (collapsing) writePaneFocus(parentId, parentId, false);
      else focusExpandedPanel(parentId);
    },

    expandPanel(parentId: TerminalId) {
      saveSplit(parentId, { collapsed: false });
    },

    expandAndFocusPanel(parentId: TerminalId) {
      saveSplit(parentId, { collapsed: false });
      focusExpandedPanel(parentId);
    },

    collapsePanelChrome(parentId: TerminalId) {
      saveSplit(parentId, { collapsed: true });
    },

    collapsePanel(parentId: TerminalId) {
      saveSplit(parentId, { collapsed: true });
      writePaneFocus(parentId, parentId, false);
    },

    setActiveSubTab(parentId: TerminalId, subId: TerminalId | null) {
      ensureState(parentId);
      setState(parentId, "activeSubTab", subId);
    },

    selectSubTab(parentId: TerminalId, subId: TerminalId | null) {
      ensureState(parentId);
      setState(parentId, "activeSubTab", subId);
      writePaneFocus(parentId, subId ?? parentId);
    },

    focusSubTab(parentId: TerminalId, subId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "activeSubTab", subId);
      saveSplit(parentId, { collapsed: false });
      writePaneFocus(parentId, subId);
    },

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

    setPanelSize(parentId: TerminalId, size: number) {
      saveSplit(parentId, { panelSize: size });
    },

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

    requestRefocus(parentId: TerminalId) {
      ensureState(parentId);
      setState(parentId, "refocusNonce", (n) => n + 1);
    },

    removePanel(parentId: TerminalId) {
      setState(produce((s) => delete s[parentId]));
      split.forget(parentId);
    },
  } as const;
}

export type TabStripRepairPorts = {
  collapsePanel: (parentId: TerminalId) => void;
  collapsePanelChrome: (parentId: TerminalId) => void;
  paneChrome: (parentId: TerminalId) => { activeSubTab: TerminalId | null };
  setActiveSubTab: (parentId: TerminalId, subId: TerminalId | null) => void;
  selectSubTab: (parentId: TerminalId, subId: TerminalId | null) => void;
};

export type EvictionSubPanelPorts = TabStripRepairPorts & {
  requestRefocus: (parentId: TerminalId) => void;
  removePanel: (parentId: TerminalId) => void;
};

export function repairTileTabs(
  panel: TabStripRepairPorts,
  tileId: TerminalId,
  remaining: readonly TerminalId[],
  leavingWasFocused: boolean,
): void {
  if (remaining.length === 0) {
    if (leavingWasFocused) panel.collapsePanel(tileId);
    else panel.collapsePanelChrome(tileId);
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
