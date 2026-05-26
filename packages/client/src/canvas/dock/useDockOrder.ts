/** Singleton memo: the canonical dock tree (rank → filter parked →
 *  group by repo). One reactive value across every consumer — the
 *  desktop dock, the mobile drawer, and `App.tsx`'s `dockOrderedIds`
 *  feed for the `Cmd+1..9` keyboard shortcut — so the three surfaces
 *  cannot drift on row order.
 *
 *  Wrapped in `createRoot` so the memo's reactive owner is the app
 *  itself, not whichever component happens to call `useDockOrder()`
 *  first. Without that, a fast-refresh or test teardown that disposed
 *  the first caller's owner would freeze the memo for every later
 *  consumer with no error to point at. */

import { type Accessor, createMemo, createRoot } from "solid-js";
import { useStaleCheck } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { rankDockRows } from "./dockRowRanking";
import { type DockTree, buildDockTree } from "./dockTree";

let cached: Accessor<DockTree> | null = null;

export function useDockOrder(): Accessor<DockTree> {
  if (cached !== null) return cached;
  cached = createRoot(() => {
    const store = useTerminalStore();
    const isStale = useStaleCheck();
    return createMemo(() =>
      buildDockTree(
        rankDockRows(store.terminalIds(), store.getMetadata, isStale),
        store.getDisplayInfo,
      ),
    );
  });
  return cached;
}
