/** Terminal store — composes view state and metadata.
 *
 *  Server-derived state streams through the surface client bundle's
 *  module-level subscriptions in `wire.ts` (`terminalListSub`); client view
 *  state (activeId, attention, mruOrder) lives in local signals.
 *
 *  Singleton via `createSharedRoot`: every consumer (WorkspaceSwitcher,
 *  ChromeBar, TerminalCanvas, mobile sheet, tile theme) reads the same
 *  store, so derivations like `getDisplayInfo` and `getMetadata` flow
 *  without prop-drilling lookup functions through layout components. */

import type { TerminalId } from "kolu-common/surface";
import { createSharedRoot } from "../createSharedRoot";
import { useViewState } from "../useViewState";
import { terminalListSub } from "../wire";
import { useSubPanel } from "./useSubPanel";
import { useTerminalMetadata } from "./useTerminalMetadata";

export const useTerminalStore = createSharedRoot(() => {
  const view = useViewState();
  const metadata = useTerminalMetadata({
    list: terminalListSub,
    activeId: view.activeId,
  });
  const subPanel = useSubPanel();

  /** The terminal currently receiving input — the active sub-tab when the
   *  active tile's split is expanded and focused, otherwise the active tile
   *  itself. `activeId` names the focused *tile* (workspace root); but any
   *  caller that routes input (the mobile key bar, copy-pane-text,
   *  run-in-active-terminal) must target the focused *terminal*, which
   *  diverges from the tile whenever a split has focus. This is the one place
   *  that resolution lives, so a new input-routing site can't silently target
   *  the parent instead. */
  function focusedId(): TerminalId | null {
    const parentId = view.activeId();
    if (parentId === null) return null;
    const panel = subPanel.getSubPanel(parentId);
    return !panel.collapsed && panel.focusTarget === "sub" && panel.activeSubTab
      ? panel.activeSubTab
      : parentId;
  }

  return {
    // Live terminal list from server (Subscription<TerminalInfo[]>).
    listSub: terminalListSub,
    // View state
    ...view,
    // Server metadata + activity + derived ordering
    ...metadata,
    // The input-routing target (tile root, or its focused split).
    focusedId,
    // Lifecycle (view-state only — list is server-driven)
    reset: view.reset,
  };
});

export type TerminalStore = ReturnType<typeof useTerminalStore>;
