/** Singleton memo: the canonical dock tree (rank → filter parked →
 *  group by repo). One reactive value across every consumer — the
 *  desktop dock, the mobile drawer, and `App.tsx`'s `dockOrderedIds`
 *  feed for the `Cmd+1..9` keyboard shortcut — so the three surfaces
 *  cannot drift on row order.
 *
 *  Lazy `createRoot` initialization (via `createSharedRoot`) so the
 *  memo's reactive owner is the app itself, not whichever component
 *  happens to call `useDockOrder()` first. Without that, a fast-
 *  refresh or test teardown that disposed the first caller's owner
 *  would freeze the memo for every later consumer with no error to
 *  point at. */

import { type Accessor, createMemo } from "solid-js";
import { useAttentionFacts } from "../../attention/useAttentionFacts";
import { createSharedRoot } from "../../createSharedRoot";
import { showSleeping } from "../../terminal/showSleeping";
import { useStaleCheck } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useTileStore } from "../../tile/useTileStore";
import { rankDockRows } from "./dockRowRanking";
import { buildDockTree, type DockTree } from "./dockTree";
import { encActiveHost } from "../../wire";

export const useDockOrder = createSharedRoot<Accessor<DockTree>>(() => {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const isStale = useStaleCheck();
  const facts = useAttentionFacts();
  // The dock ranks TILES (today every tile is a terminal, so the id set equals
  // terminalIds()); per-row metadata + display still come off the terminal,
  // its content. PR 2's sleeping tiles join `tileIds()` and become dock rows
  // through this same seam, not a separate section.
  //
  // `buildDockTree` is pure — it reads no signals — so the reactive filter
  // choices are read HERE (staleness threshold via `isStale`, sleeping
  // visibility via `showSleeping`) and threaded in as arguments, keeping the
  // tree builder a testable pure projection.
  //
  // Split across two memos so the ☾ toggle doesn't re-do the classification:
  // that pass is O(n) over the tiles and staleness, and is memoized on its own.
  // Flipping `showSleeping` invalidates only the outer `buildDockTree` grouping.
  // (There is no sort on either side any more — #2141 made row order structural,
  // so the cost this split protects is the classify pass, not a comparator.)
  //
  // A row's PAINT is its attention class — the same value its motion and every
  // count read — so the dock reads it from the mirror rather than re-deriving a
  // colour from metadata that arrives on a different subscription. `classOf`
  // deliberately does not read the live set: a row's COLOUR moves on agent
  // transitions, not on the ~1 s byte tick. Its POSITION moves on neither.
  const ranked = createMemo(() =>
    rankDockRows(
      tileStore.tileIds(),
      store.getMetadata,
      isStale,
      (id) => facts.classOf(encActiveHost(), id),
      // The store's pane index — the SAME fact the canvas flattens into its tab
      // strip, handed over nested so the dock can indent it. Never the raw
      // one-hop `getSubTerminalIds`: that is the eviction path's edge, and
      // walking it here is what left a split of a split with no dock row.
      store.getPaneTree,
    ),
  );
  return createMemo(() =>
    buildDockTree(ranked(), store.getDisplayInfo, !showSleeping()),
  );
});
