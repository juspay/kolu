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
 *    repair runs here (`planTileTabsRepair`) rather than a second spelling of
 *    the rule. A terminal that left being a TILE altogether (it became a split) has
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
 *  released by the landing's settle OR by the refusal, so it cannot outlive its
 *  write; the plain `spent` marker beside it is what keeps the landing a
 *  ONE-SHOT across the step between the two (see the effect). */

import type { TerminalId } from "kolu-common/surface";
import { createEffect, createSignal, onSettled, untrack } from "solid-js";
import { createSharedRoot } from "../../createSharedRoot";
import { planTileTabsRepair, useSubPanel } from "../../terminal/useSubPanel";
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
    /** The intent whose landing has already fired. Plain state, not a signal:
     *  the effect below must not write what its own compute reads (an effect
     *  that re-arms its own input re-runs for its own write), and nothing
     *  renders this — it only says "this slot's follow-up has gone". */
    let spent: Pending | null = null;
    /** Let the slot go, once this flush has settled. Deferred because an effect
     *  must not write what its own compute reads: a write to `pending` from the
     *  callback below would re-run the effect for its own write. */
    const release = (p: Pending) =>
      onSettled(() => {
        setPending((cur) => (cur === p ? null : cur));
      });

    createEffect(
      () => {
        const p = pending();
        if (!p || p === spent) return null;
        return {
          p,
          edge: store.parentEdge(p.id),
          // Untracked: the repair below wants the pane list AT THE LANDING,
          // and a pane list that moves on its own is not a reason to re-run
          // the landing (the Solid 1 effect never acted on it either — it
          // bailed on `pending` long before reaching this read).
          panes: untrack(() => store.getSplitPaneIds(p.fromTile)),
        };
      },
      (landing) => {
        if (!landing) return;
        const { p, edge, panes } = landing;
        // The terminal left the census while the write was in flight — nothing
        // left to reconcile and nothing to focus.
        if (edge === undefined) {
          spent = p;
          release(p);
          return;
        }
        if (edge !== p.parentId) return; // not landed yet
        // The landing is ONE-SHOT from here: the slot is released in the settle
        // below, and a re-run before that settle must not fire it twice.
        spent = p;
        release(p);
        // The follow-up READS app state — the tile's tab strip
        // (`planTileTabsRepair` consults its `activeSubTab`) and the landing
        // verb's metadata and containing tile — and an effect callback is a
        // strict-read window, so it runs in the settle right after this flush
        // instead (the same deferral `showTipOnce` makes for the same reason).
        // One settle later costs this path nothing: it has already waited on a
        // server round-trip, and the reads then see the committed tree it
        // waited for.
        onSettled(() => {
          if (p.fromTile === p.id) {
            // The row WAS a tile: it is a split now, so the panel chrome keyed
            // on its old tile identity is stale (the eviction path drops the
            // same state when a tile departs) — and so is the per-host VISIT
            // TRAIL, a list of TILES that `Ctrl+Tab`/`Alt+Tab` walks straight
            // into `activate`, which throws on a split. Same prune the eviction
            // path performs for a departing tile, for the same reason: this
            // terminal is no longer a tile, which is exactly what that trail
            // lists.
            subPanel.removePanel(p.id);
            store.forgetFromMru(p.id);
          } else {
            // The row left a tile that survives: repair that tile's tab strip so
            // its `activeSubTab` cannot dangle at a pane that is no longer under
            // it. The panes are handed over UNFILTERED — a same-tile move (a
            // split dropped on its own sibling) still has the moved terminal
            // under this tile, and `planTileTabsRepair`'s membership test then
            // correctly finds nothing to repair. Focus is about to move to the
            // dragged terminal anyway, so the repair never carries the focus
            // fact. The planner's own reads happen here, in the settle, and
            // its returned writes run straight after.
            planTileTabsRepair(subPanel, p.fromTile, panes, false)();
          }
          focus(p.id);
        });
      },
    );

    return (id, parentId) => {
      // The tile the row is leaving, read while the graph is still live. It is
      // also what a promote hands over (see below), so it is read once.
      const fromTile = store.containingTile(id);
      setPending({ id, parentId, fromTile });
      // Refused (the server said no, and the toast already said why): disarm
      // the intent, or the effect waits for an edge that will never arrive.
      const settle = (applied: boolean) => {
        if (!applied) setPending((cur) => (cur?.id === id ? null : cur));
      };
      // Handing the row its own tile (`parentId: null`) is a promote, not a
      // re-home: it is the one write that also hands over panel posture, so it
      // goes through the SAME verb the eviction reconcile's promote uses —
      // one home for the inheritance, one timing (before the write).
      if (parentId === null) {
        crud.promoteToTopLevel(id, fromTile, settle);
        return;
      }
      void crud.reparent(id, parentId).then(settle);
    };
  },
);
