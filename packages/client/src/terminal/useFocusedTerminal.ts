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
 *  The two facts NEST rather than compete, and the dock shows both: the parent
 *  row is lit because its tile is the active one, and the split's entry is lit
 *  because that is where the keyboard is — a selected file inside a selected
 *  folder. Treating them as exclusive (lighting only the split) was a real
 *  regression: it took the highlight off every terminal that held a split, which
 *  is both what a user reported and what the e2e contract
 *  `[data-testid="dock-row"][data-active]` has always meant. */

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
    // `peekSubPanel`, never `getSubPanel`: the latter SEEDS state on first
    // touch, so a derivation that used it would both write during a read and
    // manufacture its own answer (the seed says `focusTarget: "sub"`).
    resolveFocusedTerminal(tileStore.activeId(), (id) =>
      subPanel.peekSubPanel(id),
    ),
  );

  return {
    focusedId,
    /** Is this terminal the one your keyboard is in? True for a split you are
     *  typing in, and for a tile whose sub-panel is not where focus sits. */
    isFocused: (id: TerminalId): boolean => focusedId() === id,
    /** Is this the active TILE — the canvas selection? A split is never a tile,
     *  so this is false for every sub-entry, and stays TRUE for a parent whose
     *  focus has moved into one of its splits. */
    isActiveTile: (id: TerminalId): boolean => tileStore.activeId() === id,
  };
});

/** The resolution rule itself, pure over its two inputs — the active tile and
 *  that tile's sub-panel state. Separated from the memo so it is testable
 *  without a reactive root: the rule is the part that was wrong, and it is the
 *  part worth pinning. */
export function resolveFocusedTerminal(
  activeTileId: TerminalId | null,
  panelOf: (id: TerminalId) =>
    | {
        collapsed: boolean;
        activeSubTab: TerminalId | null;
        focusTarget: "main" | "sub";
      }
    | undefined,
): TerminalId | null {
  if (activeTileId === null) return null;
  const panel = panelOf(activeTileId);
  // NO panel state means nobody has ever opened or focused this terminal's
  // sub-panel, so you are in the terminal itself. This arm is the whole second
  // bug: the store's seeded default is `focusTarget: "sub"`, so treating
  // absence as "read the default" claimed the split for every terminal that
  // merely HAD one, and the parent row went dark the moment a terminal grew a
  // split.
  if (panel === undefined) return activeTileId;
  // A collapsed panel has no visible pane to be focused in, and `focusTarget`
  // remembers a choice you made before collapsing it — so the tile itself is
  // where you are until it reopens.
  if (panel.collapsed || panel.focusTarget !== "sub") return activeTileId;
  return panel.activeSubTab ?? activeTileId;
}
