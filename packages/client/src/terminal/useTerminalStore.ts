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
import { createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { useViewState } from "../useViewState";
import { terminalListSub } from "../wire";
import { useSubPanel } from "./useSubPanel";
import { useTerminalMetadata } from "./useTerminalMetadata";
import { admitWebglTiles, WEBGL_CONTEXT_CAP } from "./webglBudget";

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

  /** The tiles entitled to a WebGL context: the most-recently-active *live*
   *  tiles that fit under `WEBGL_CONTEXT_CAP`. Derived from the tile MRU
   *  (`mruOrder`) intersected with the live top-level tiles, so a closed tile is
   *  dropped rather than pinning a slot — no explicit remove-on-close needed.
   *  Reactive, so switching tiles loads/unloads WebGL only on the tiles that
   *  cross the cap boundary; when the whole working set fits, focus switches
   *  churn nothing (the #1399 fix). */
  const webglTileBudget = createMemo(() => {
    const live = new Set(metadata.terminalIds());
    const ordered = view.mruOrder().filter((id) => live.has(id));
    // A tile costs one context for its main pane, plus one for an expanded,
    // active split (mirrors holdsWebgl's split rule below), so the running count
    // is the true number of live WebGL contexts — admitting the full working set
    // churn-free (#1399) while staying under Chrome's per-tab limit (#575).
    return admitWebglTiles(
      ordered,
      (id) => {
        const panel = subPanel.getSubPanel(id);
        return 1 + (!panel.collapsed && panel.activeSubTab ? 1 : 0);
      },
      WEBGL_CONTEXT_CAP,
    );
  });

  /** Whether `id` should hold a WebGL renderer under the budget. A budgeted
   *  tile's slot covers its main pane AND its active split — the split inherits
   *  the tile's renderer, so focusing into it never swaps the main pane to DOM
   *  and the 7.7% divergence never appears side-by-side within one tile. A
   *  non-active split of a budgeted tile, and every tile outside the budget,
   *  fall back to xterm's DOM renderer. Sibling of `focusedId`: the one place
   *  that maps the tile-level budget down to individual terminals (main vs.
   *  split). Note this diverges from "is focused" — an unfocused budget tile
   *  keeps WebGL — so it is deliberately distinct from the `isFocused` gate
   *  that still drives zoom and `data-focused`. */
  function holdsWebgl(id: TerminalId): boolean {
    const budget = webglTileBudget();
    const parentId = metadata.getMetadata(id)?.parentId ?? null;
    if (parentId === null) return budget.includes(id);
    const panel = subPanel.getSubPanel(parentId);
    // A collapsed split is invisible — it must not hold a WebGL context.
    // Mirror focusedId's collapsed guard so holdsWebgl is self-contained and
    // any future consumer doesn't need to re-check props.visible externally.
    return (
      budget.includes(parentId) && !panel.collapsed && panel.activeSubTab === id
    );
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
    // WebGL budget: whether a terminal should hold a WebGL renderer (#1403).
    holdsWebgl,
    // Lifecycle (view-state only — list is server-driven)
    reset: view.reset,
  };
});

export type TerminalStore = ReturnType<typeof useTerminalStore>;
