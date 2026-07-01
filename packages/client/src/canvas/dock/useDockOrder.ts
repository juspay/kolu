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
import { showSleeping } from "../../terminal/showSleeping";
import { useStaleCheck } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useTileStore } from "../../tile/useTileStore";
import { rankDockRows } from "./dockRowRanking";
import { buildDockTree, type DockTree } from "./dockTree";

export const useDockOrder = createSharedRoot<Accessor<DockTree>>(() => {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const isStale = useStaleCheck();
  // The dock ranks TILES (today every tile is a terminal, so the id set equals
  // terminalIds()); per-row metadata + display still come off the terminal,
  // its content. PR 2's sleeping tiles join `tileIds()` and become dock rows
  // through this same seam, not a separate section.
  //
  // `buildDockTree` is pure — it reads no signals — so the reactive filter
  // choices are read HERE (staleness threshold via `isStale`, sleeping
  // visibility via `showSleeping`) and threaded in as arguments, keeping the
  // tree builder a testable pure projection.
  return createMemo(() =>
    buildDockTree(
      rankDockRows(tileStore.tileIds(), store.getMetadata, isStale),
      store.getDisplayInfo,
      !showSleeping(),
    ),
  );
});
