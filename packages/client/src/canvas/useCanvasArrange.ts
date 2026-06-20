/** Repo-island arrange — glues the pure layout module (`repoIslands.ts`)
 *  against the live terminal store. Lives outside `App.tsx` per the
 *  "App.tsx is a thin layout shell" rule (`.claude/rules/solidjs.md`):
 *  arrange is its own domain (store reads, no-op skip on writes,
 *  post-arrange recenter), and that domain owns its `useXxx.ts` module.
 *
 *  Repo-island clustering is a one-shot, user-invoked action only —
 *  `handleCanvasAutoArrange()` (the "Arrange canvas by repo" palette
 *  command / minimap button). Creating a terminal deliberately does NOT
 *  arrange: a new tile opens at the canvas's default cascade and no
 *  existing tile moves. */

import { supportsSpatialCanvas } from "../capabilities";
import { useTerminalStore } from "../terminal/useTerminalStore";
import type { TileId } from "../tile/tileContent";
import { useTileStore } from "../tile/useTileStore";
import { getBucketFor } from "./placementPolicy";
import { arrangeRepoIslands, type RepoIslandTile } from "./repoIslands";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";
import { layoutsEqual, type TileLayout } from "./TileLayout";
import { usePendingLayouts } from "./usePendingLayouts";
import { snapToGrid } from "./viewport/transforms";
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

  /** Seed pending BEFORE dispatching writes so the canvas renders the
   *  arranged layout immediately, ahead of the metadata round-trip.
   *  Skips no-op writes so a re-arrange doesn't fire N round-trip RPCs.
   *  Writes flow through `tileStore.setLayout` — the single tile-layout
   *  write seam — so the registry, not arrange, owns where layout lands. */
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

  /** One-shot rearrange triggered from the command palette. */
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
    // Recenter on the active tile's new position so a far-away active
    // tile doesn't end up off-screen after arrange. `activate` re-bumps
    // the centering signal even though active hasn't changed (the canvas
    // resolves the just-applied pending layout via `layoutOf`), so this
    // shares the create/close path.
    const activeId = tileStore.activeId();
    if (activeId && arranged.has(activeId)) tileStore.activate(activeId);
  }

  /** Center the canvas on the active tile (the "Center on active tile" palette
   *  command). No-op off the spatial canvas (mobile / narrow) or at zero tiles.
   *  Moved out of App.tsx — sibling to `handleCanvasAutoArrange`, both
   *  canvas-spatial behavior over the tile registry. */
  function centerActive() {
    if (!supportsSpatialCanvas()) return;
    const id = tileStore.activeId();
    if (id) tileStore.activate(id);
  }

  /** Reset the active tile to the default width/height and drop it back at the
   *  viewport center — the "Reset terminal size" Debug palette command for a
   *  tile dragged or resized into an awkward state. Seeds pending for instant
   *  feedback (same path as drag/resize/arrange), persists via the tile-store
   *  write seam, and recenters via `activate`. No-op off the spatial canvas
   *  (mobile / narrow) or at zero tiles. */
  function resetActiveTileSize() {
    if (!supportsSpatialCanvas()) return;
    const id = tileStore.activeId();
    if (!id) return;
    // Canvas-space coordinate at the viewport center — same math the
    // default-placement effect uses to drop a freshly created tile.
    const { width, height } = viewport.viewportSize();
    const zoom = viewport.zoom();
    const cx = viewport.panX() + width / (2 * zoom);
    const cy = viewport.panY() + height / (2 * zoom);
    const layout: TileLayout = {
      x: snapToGrid(cx - DEFAULT_TILE_W / 2),
      y: snapToGrid(cy - DEFAULT_TILE_H / 2),
      w: DEFAULT_TILE_W,
      h: DEFAULT_TILE_H,
    };
    pendingLayouts.setOne(id, layout);
    tileStore.setLayout(id, layout);
    tileStore.activate(id);
  }

  return { handleCanvasAutoArrange, centerActive, resetActiveTileSize };
}
