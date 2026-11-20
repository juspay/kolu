import { supportsSpatialCanvas } from "../capabilities";
import { useTerminalStore } from "../terminal/useTerminalStore";
import type { TileId } from "../tile/tileContent";
import { useTileStore } from "../tile/useTileStore";
import { getBucketFor } from "./placementPolicy";
import { arrangeRepoIslands, type RepoIslandTile } from "./repoIslands";
import { layoutsEqual, type TileLayout } from "./TileLayout";
import {
  DEFAULT_TILE_H,
  DEFAULT_TILE_W,
  findFreeTilePosition,
} from "./tilePlacement";
import { usePendingLayouts } from "./usePendingLayouts";
import { useCanvasViewport } from "./viewport/useCanvasViewport";

export function useCanvasArrange() {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const pendingLayouts = usePendingLayouts();
  const viewport = useCanvasViewport();

  function repoIslandTileFor(
    id: TileId,
    layout: TileLayout,
  ): RepoIslandTile | undefined {
    const bucket = getBucketFor(store, id);
    return bucket ? { id, bucket, layout } : undefined;
  }

  function applyLayoutBatch(layouts: Map<TileId, TileLayout>) {
    if (layouts.size === 0) return;
    pendingLayouts.applyMany(layouts);
    for (const [id, layout] of layouts) {
      const prev = tileStore.getLayout(id);
      if (!prev || !layoutsEqual(prev, layout)) {
        tileStore.setLayout(id, layout);
      }
    }
  }

  function handleCanvasAutoArrange() {
    if (!supportsSpatialCanvas()) return;
    const tiles = tileStore.tileIds().flatMap((id) => {
      const layout = tileStore.getLayout(id);
      if (!layout) return [];
      const tile = repoIslandTileFor(id, layout);
      return tile ? [tile] : [];
    });
    const arranged = arrangeRepoIslands(tiles);
    applyLayoutBatch(arranged);
    const activeId = tileStore.activeId();
    if (activeId && arranged.has(activeId))
      tileStore.activateVisiblePane(activeId);
  }

  function centerActive() {
    if (!supportsSpatialCanvas()) return;
    const id = tileStore.activeId();
    if (id) tileStore.activateVisiblePane(id);
  }

  function resetActiveTileSize() {
    if (!supportsSpatialCanvas()) return;
    const id = tileStore.activeId();
    if (!id) return;
    const center = viewport.viewportCenter();
    if (!center) return;
    const layout: TileLayout = {
      ...findFreeTilePosition(center.x, center.y, []),
      w: DEFAULT_TILE_W,
      h: DEFAULT_TILE_H,
    };
    pendingLayouts.setOne(id, layout);
    tileStore.setLayout(id, layout);
    tileStore.activateVisiblePane(id);
  }

  return { handleCanvasAutoArrange, centerActive, resetActiveTileSize };
}
