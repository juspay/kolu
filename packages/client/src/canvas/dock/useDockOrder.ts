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

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { createSharedRoot } from "../../createSharedRoot";
import { useStaleCheck } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { sleepingContent } from "../../tile/tileContent";
import { useTileStore } from "../../tile/useTileStore";
import { rankDockRows } from "./dockRowRanking";
import { buildDockTree, type DockTree } from "./dockTree";
import { type DockRowData, sleepingDockRowData } from "./sleepingDockRow";

export const useDockOrder = createSharedRoot<Accessor<DockTree>>(() => {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const isStale = useStaleCheck();
  // The dock ranks TILES through one seam: live terminals read their {meta,
  // display} off the terminal store; sleeping tiles join `tileIds()` and get
  // theirs synthesized from the record — so a sleeping tile becomes a dock row
  // grouped under its repo via the SAME rank → group → render pipeline, not a
  // separate section (the silo the re-plan killed).
  return createMemo(() => {
    const ids = tileStore.tileIds();
    // Synthesize each sleeping tile's row data once per render (live wins for a
    // shared id during the sleep window — only ids absent from the live store).
    const sleeping = new Map<TerminalId, DockRowData>();
    for (const id of ids) {
      if (store.getMetadata(id)) continue;
      const record = sleepingContent(tileStore.contentOf(id))?.record;
      if (!record) continue;
      const data = sleepingDockRowData(record);
      if (data) sleeping.set(id, data);
    }
    const getMeta = (id: TerminalId) =>
      store.getMetadata(id) ?? sleeping.get(id)?.meta;
    const getInfo = (id: TerminalId) =>
      store.getDisplayInfo(id) ?? sleeping.get(id)?.info;
    return buildDockTree(
      rankDockRows(ids, getMeta, isStale, (id) => sleeping.has(id)),
      getInfo,
    );
  });
});
