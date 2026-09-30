/** The dock's re-home write, and the reconcile that lands it.
 *
 *  Dropping a row on another row nests the dragged terminal under the target as
 *  a SPLIT; dropping a split's row on its repo card's header hands it back its
 *  own TILE (`parentId: null`). The write itself is one `chrome.setParent` (via
 *  crud's `reparent`), and everything else here exists because that write is
 *  FIRE AND FORGET while its consequences are not:
 *
 *  · The server's metadata PUSH and this RPC's reply are two independent
 *    deliveries over the same socket — either can land first — so the drop does
 *    not chain its follow-up work onto the call. It records an INTENT, and the
 *    effect below runs when the parent EDGE it asked for is the edge it sees.
 *    Waiting on the edge (rather than on the reply) is also what keeps the
 *    follow-up honest about its inputs: the old tile's tab strip and the focus
 *    landing are read AFTER the tree moved, so neither can act on a
 *    half-applied reparent. The reply still matters in the other direction: a
 *    REFUSED write disarms the intent (`reparent` resolves `false`), or the
 *    effect would wait forever and then fire its follow-up on some later,
 *    unrelated edge change.
 *  · A terminal that LEFT a tile can leave that tile's tab strip dangling: the
 *    eviction reconcile's invariant ("`activeSubTab` is null or a LIVE sub of
 *    this tile") is read by consumers that trust a plain null-check, so the same
 *    repair runs here (`repairTileTabs`) rather than a second spelling of the
 *    rule. A terminal that left being a TILE altogether (it became a split) has
 *    stale tile chrome of its own, dropped the same way the eviction path drops
 *    it.
 *  · Focus follows the drop: the user put the terminal there, so the tile's
 *    panel opens on it and the keyboard lands in it — `useDockFocus`, which
 *    resolves a split to its tab.
 *
 *  ONE intent slot, deliberately. A drop's landing window is the metadata
 *  round-trip, and the only writer is a drag — one pointer, one gesture at a
 *  time — so a second drop inside that window is not reachable; a map keyed by
 *  terminal would be machinery for a race the input cannot produce. The slot is
 *  cleared by the landing OR by the refusal, so it cannot outlive its write. */

import type { TerminalId } from "kolu-common/surface";
import { createEffect, createSignal } from "solid-js";
import { createSharedRoot } from "../../createSharedRoot";
import { repairTileTabs } from "../../terminal/useActiveReconcile";
import { subPanelRepairPorts, useSubPanel } from "../../terminal/useSubPanel";
import { useTerminalCrud } from "../../terminal/useTerminalCrud";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useDockFocus } from "./useDockFocus";

type Pending = {
  id: TerminalId;
  /** The parent we asked the server for — the edge that says "it landed". */
  parentId: TerminalId | null;
  /** The tile the row belonged to BEFORE the drop. Captured at drop time
   *  because after the landing it is no longer derivable: it is the tile whose
   *  tab strip needs repairing when the row left one. */
  fromTile: TerminalId;
};

/** The drop write. Returns a function so the dock's event plumbing stays
 *  plumbing: `drop(id, parentId)` and nothing else. */
export const useDockReparent = createSharedRoot(
  (): ((id: TerminalId, parentId: TerminalId | null) => void) => {
    const crud = useTerminalCrud();
    const store = useTerminalStore();
    const subPanel = useSubPanel();
    const focus = useDockFocus();
    const [pending, setPending] = createSignal<Pending | null>(null);

    createEffect(() => {
      const p = pending();
      if (!p) return;
      const edge = store.parentEdge(p.id);
      // The terminal left the census while the write was in flight — nothing
      // left to reconcile and nothing to focus.
      if (edge === undefined) {
        setPending(null);
        return;
      }
      if (edge !== p.parentId) return; // not landed yet
      setPending(null);
      if (p.fromTile === p.id) {
        // The row WAS a tile: it is a split now, so the panel chrome keyed on
        // its old tile identity is stale (the eviction path drops the same
        // state when a tile departs).
        subPanel.removePanel(p.id);
      } else {
        // The row left a tile that survives: repair that tile's tab strip so
        // its `activeSubTab` cannot dangle at a pane that is no longer under
        // it. The panes are handed over UNFILTERED — a same-tile move (a split
        // dropped on its own sibling) still has the moved terminal under this
        // tile, and `repairTileTabs`'s membership test then correctly finds
        // nothing to repair. Focus is about to move to the dragged terminal
        // anyway, so the repair never carries the focus fact.
        repairTileTabs(
          subPanelRepairPorts(subPanel),
          p.fromTile,
          store.getSplitPaneIds(p.fromTile),
          false,
        );
      }
      focus(p.id);
    });

    return (id, parentId) => {
      setPending({ id, parentId, fromTile: store.containingTile(id) });
      void crud.reparent(id, parentId).then((applied) => {
        // Refused (the server said no, and the toast already said why): disarm
        // the intent, or the effect waits for an edge that will never arrive.
        if (!applied) setPending((cur) => (cur?.id === id ? null : cur));
      });
    };
  },
);
