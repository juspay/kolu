/** Which terminal your keyboard is actually in — the ONE derivation, for any
 *  terminal, top-level or split.
 *
 *  "The active tile" and "the terminal you are typing in" are different facts,
 *  and a split is where they come apart: focusing a split activates its PARENT
 *  tile and then moves focus into the pane, so the tile registry names the
 *  parent while your cursor is one level down. Every surface that wants to
 *  highlight where-you-are wants the second fact, and the tile registry only
 *  answers the first.
 *
 *  It is a derived SIGNAL rather than a boolean each row works out for itself.
 *  That distinction is the whole point: the dock's row attributes used to take
 *  `active` as a parameter, so every row computed it — and the split entry,
 *  the one row type that exists *because* its agent was invisible, passed a
 *  hardcoded `false` and stayed unlit when you clicked into it. A value a call
 *  site assembles is a value a call site can get wrong; a derivation everything
 *  reads cannot disagree with itself.
 *
 *  One consequence worth stating, because it is a deliberate behaviour change:
 *  at most ONE dock row is ever the focused row. With focus inside a split, the
 *  split's entry lights and its parent row does not — the parent tile is still
 *  active, but you are not typing in it, and two highlighted rows answer "where
 *  am I" with two different answers. */

import type { TerminalId } from "kolu-common/surface";
import { createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { useSubPanel } from "./useSubPanel";
import { useTileStore } from "../tile/useTileStore";

export const useFocusedTerminal = createSharedRoot(() => {
  const tileStore = useTileStore();
  const subPanel = useSubPanel();

  /** The terminal holding your focus, resolved through the sub-panel. */
  const focusedId = createMemo<TerminalId | null>(() =>
    resolveFocusedTerminal(tileStore.activeId(), (id) =>
      subPanel.getSubPanel(id),
    ),
  );

  return {
    focusedId,
    /** Is this terminal the one you are in? The only way to ask. */
    isFocused: (id: TerminalId): boolean => focusedId() === id,
  };
});

/** The resolution rule itself, pure over its two inputs — the active tile and
 *  that tile's sub-panel state. Separated from the memo so it is testable
 *  without a reactive root: the rule is the part that was wrong, and it is the
 *  part worth pinning. */
export function resolveFocusedTerminal(
  activeTileId: TerminalId | null,
  panelOf: (id: TerminalId) => {
    collapsed: boolean;
    activeSubTab: TerminalId | null;
    focusTarget: "main" | "sub";
  },
): TerminalId | null {
  if (activeTileId === null) return null;
  const panel = panelOf(activeTileId);
  // A collapsed panel has no visible pane to be focused in, and `focusTarget`
  // remembers a choice you made before collapsing it — so the tile itself is
  // where you are until it reopens.
  if (panel.collapsed || panel.focusTarget !== "sub") return activeTileId;
  return panel.activeSubTab ?? activeTileId;
}
