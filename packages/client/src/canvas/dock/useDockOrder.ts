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
import { createSharedRoot } from "../../createSharedRoot";
import { useStaleCheck } from "../../terminal/staleness";
import { useTileStore } from "../../tile/useTileStore";
import { rankDockRows } from "./dockRowRanking";
import { buildDockTree, type DockTree } from "./dockTree";

export const useDockOrder = createSharedRoot<Accessor<DockTree>>(() => {
  const tileStore = useTileStore();
  const isStale = useStaleCheck();
  // The dock ranks TILES through ONE seam: `tileStore.getMetadata` /
  // `getDisplayInfo` are tile-aware (a live terminal reads off the store, a
  // sleeping tile is synthesized from its record), so a sleeping tile becomes a
  // dock row grouped under its repo via the SAME rank → group → render pipeline
  // — not a separate section (the silo the re-plan killed).
  return createMemo(() =>
    buildDockTree(
      rankDockRows(
        tileStore.tileIds(),
        tileStore.getMetadata,
        isStale,
        (id) => tileStore.contentOf(id)?.kind === "sleeping",
      ),
      tileStore.getDisplayInfo,
    ),
  );
});
