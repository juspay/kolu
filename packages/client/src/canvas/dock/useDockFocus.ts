/** Land on a dock target — the ONE way any dock surface reaches a terminal.
 *
 *  A top-level row is one call. An agent living in a SPLIT is four: activate
 *  the parent tile, expand its sub-panel, select the split's tab, move focus
 *  into it. `activate(subId)` alone lands on nothing at all, because a split
 *  has no tile of its own — so a section capsule that counted a split and then
 *  jumped with a bare `activate` rendered a button that did nothing. The
 *  sub-entry's own click and the capsule's jump go through here, so a count's
 *  click can never reach less than the row click beside it. */

import type { TerminalId } from "kolu-common/surface";
import { useSubPanel } from "../../terminal/useSubPanel";
import { useTileStore } from "../../tile/useTileStore";

export function useDockFocus(): (
  id: TerminalId,
  parentId?: TerminalId,
) => void {
  const tileStore = useTileStore();
  const subPanel = useSubPanel();
  return (id, parentId) => {
    if (parentId === undefined) {
      tileStore.activate(id);
      return;
    }
    tileStore.activate(parentId);
    subPanel.expandPanel(parentId);
    subPanel.setActiveSubTab(parentId, id);
    subPanel.setFocusTarget(parentId, "sub");
  };
}
