import { activeArm } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { createMemo, createSelector } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { terminalListSub } from "../hostScope/activeWire";
import { useViewState } from "../useViewState";
import { useSubPanel } from "./useSubPanel";
import { useTerminalMetadata } from "./useTerminalMetadata";
import {
  admitWebglTiles,
  isActiveSplit,
  tileWebglCost,
  WEBGL_CONTEXT_CAP,
} from "./webglBudget";

export const useTerminalStore = createSharedRoot(() => {
  const view = useViewState();
  const metadata = useTerminalMetadata({
    list: terminalListSub,
  });
  const subPanel = useSubPanel();

  function focusedId(): TerminalId | null {
    const resolved = view.focusedTerminalId();
    if (resolved === null) return null;
    return activeArm(metadata.getMetadata(resolved)) ? resolved : null;
  }

  const panelOf = (tile: TerminalId) => ({
    collapsed: subPanel.savedSplit(tile).collapsed,
    activeSubTab: subPanel.paneChrome(tile).activeSubTab,
  });

  const webglTileBudget = createMemo(
    () => {
      const live = new Set(
        metadata
          .terminalIds()
          .filter((id) => activeArm(metadata.getMetadata(id)) !== undefined),
      );
      const ordered = view.mruOrder().filter((id) => live.has(id));
      return admitWebglTiles(
        ordered,
        (id) => tileWebglCost(panelOf(id)),
        WEBGL_CONTEXT_CAP,
      );
    },
    undefined,
    {
      equals: (a, b) =>
        a.length === b.length && a.every((id) => b.includes(id)),
    },
  );
  const budgetContains = createSelector(
    webglTileBudget,
    (id: TerminalId, budget) => budget.includes(id),
  );

  function holdsWebgl(id: TerminalId): boolean {
    const tile = metadata.containingTile(id);
    if (tile === id) return budgetContains(id);
    const panel = panelOf(tile);
    return budgetContains(tile) && isActiveSplit(panel, id);
  }

  const active = createMemo(() => {
    const id = view.activeId();
    return {
      id,
      meta: id !== null ? (metadata.getMetadata(id) ?? null) : null,
    };
  });

  const focused = createMemo(() => {
    const id = view.focusedTerminalId();
    return {
      id,
      meta: id !== null ? (metadata.getMetadata(id) ?? null) : null,
    };
  });

  const activeMeta = () => active().meta;

  function isCanvasTile(id: TerminalId): boolean {
    const record = metadata.getMetadata(id);
    if (!record) return true;
    return metadata.containingTile(id) === id;
  }

  function setActiveSilently(id: TerminalId | null): void {
    if (id === null) {
      subPanel.clearFocus();
      return;
    }
    if (!isCanvasTile(id)) {
      throw new Error(
        `setActiveSilently: ${id} is a split; use focusTerminal instead`,
      );
    }
    subPanel.focusVisiblePane(id);
  }

  function activate(id: TerminalId | null): void {
    setActiveSilently(id);
    if (id !== null) view.requestCenterActive();
  }

  function focusMainTerminal(id: TerminalId): void {
    if (!isCanvasTile(id) && metadata.getMetadata(id) !== undefined) {
      throw new Error(`focusMainTerminal: ${id} is a split`);
    }
    subPanel.focusMainPane(id);
    view.requestCenterActive();
  }

  function focusTerminalSilently(id: TerminalId): void {
    const record = metadata.getMetadata(id);
    if (!record)
      throw new Error(`focusTerminalSilently: no terminal metadata for ${id}`);
    const tile = metadata.containingTile(id);
    if (tile === id) {
      subPanel.focusMainPane(id);
      return;
    }
    subPanel.focusSubTab(tile, id);
  }

  function focusTerminal(id: TerminalId): void {
    focusTerminalSilently(id);
    view.requestCenterActive();
  }

  return {
    listSub: terminalListSub,
    active,
    focused,
    activeMeta,
    ...view,
    ...metadata,
    activate,
    setActiveSilently,
    focusedId,
    focusTerminalSilently,
    focusTerminal,
    focusMainTerminal,
    holdsWebgl,
    reset: view.reset,
  };
});

export type TerminalStore = ReturnType<typeof useTerminalStore>;
