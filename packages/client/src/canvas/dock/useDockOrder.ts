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
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { rankDockRows } from "./dockRowRanking";
import { buildDockTree, type DockTree } from "./dockTree";

export const useDockOrder = createSharedRoot<Accessor<DockTree>>(() => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
  return createMemo(() =>
    buildDockTree(
      rankDockRows(store.terminalIds(), store.getMetadata, isStale),
      store.getDisplayInfo,
    ),
  );
});
