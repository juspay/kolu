/** Land on a terminal — the ONE way any surface reaches one, wherever it lives.
 *
 *  A top-level terminal is one call. An agent living in a SPLIT is four:
 *  activate the parent tile, expand its sub-panel, select the split's tab, move
 *  focus into it. `activate(subId)` alone lands on nothing at all, because a
 *  split has no tile of its own — so a count that included a split and then
 *  jumped with a bare `activate` rendered a button that did nothing.
 *
 *  It resolves the parent ITSELF rather than taking one. That is the whole
 *  point: while the parent was a parameter, landing correctly depended on every
 *  caller remembering to look it up — and the host tab's violet capsule, added
 *  in the same change that fixed the dock's, did not. It counts an
 *  `awaiting_user` agent inside a split (padi's urgency folds every terminal
 *  record, splits included) and jumped to a terminal with no tile: the same
 *  dead button, one altitude up, in the same PR that closed it below. A caller
 *  cannot get this wrong any more, because there is nothing left to pass. */

import type { TerminalId } from "kolu-common/surface";
import { useSubPanel } from "../../terminal/useSubPanel";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useTileStore } from "../../tile/useTileStore";

export function useDockFocus(): (id: TerminalId) => void {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const subPanel = useSubPanel();
  return (id) => {
    // The same derivation `useTerminals` spells as `parentOf`: a split's own
    // metadata names the tile it lives in.
    const parentId = store.getMetadata(id)?.parentId ?? null;
    if (parentId === null) {
      tileStore.activate(id);
      return;
    }
    tileStore.activate(parentId);
    subPanel.expandPanel(parentId);
    subPanel.setActiveSubTab(parentId, id);
    subPanel.setFocusTarget(parentId, "sub");
  };
}
