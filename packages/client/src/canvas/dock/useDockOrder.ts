import { type Accessor, createMemo } from "solid-js";
import { useAttentionFacts } from "../../attention/useAttentionFacts";
import { createSharedRoot } from "../../createSharedRoot";
import { dockOrder } from "../../terminal/dockOrderPref";
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
  const ranked = createMemo(() =>
    rankDockRows(
      tileStore.tileIds(),
      store.getMetadata,
      isStale,
      (id) => facts.classOf(encActiveHost(), id),
      store.getPaneTree,
    ),
  );
  return createMemo(() =>
    buildDockTree(ranked(), store.getDisplayInfo, !showSleeping(), dockOrder()),
  );
});
