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

import type { TerminalId } from "kolu-common/surface";
import { supportsSpatialCanvas } from "../capabilities";
import { useTerminalCrud } from "../terminal/useTerminalCrud";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { getBucketFor } from "./placementPolicy";
import { arrangeRepoIslands, type RepoIslandTile } from "./repoIslands";
import { layoutsEqual, type TileLayout } from "./TileLayout";
import { usePendingLayouts } from "./usePendingLayouts";

export function useCanvasArrange() {
  const store = useTerminalStore();
  const crud = useTerminalCrud();
  const pendingLayouts = usePendingLayouts();

  /** Apply a tile's geometry — drag-end, resize-end, default-place,
   *  and arrange all flow through this single point. The 500ms session
   *  auto-save throttle on the server collapses N writes into one save,
   *  so the per-tile RPC is fine for batch flows like arrange. */
  function applyTileGeometry(id: TerminalId, layout: TileLayout) {
    crud.setCanvasLayout(id, layout);
  }

  function repoIslandTileFor(
    id: TerminalId,
    layout: TileLayout,
  ): RepoIslandTile | undefined {
    const bucket = getBucketFor(store, id);
    return bucket ? { id, bucket, layout } : undefined;
  }

  /** Seed pending BEFORE dispatching writes so the canvas renders the
   *  arranged layout immediately, ahead of the metadata round-trip.
   *  Skips no-op writes so a re-arrange doesn't fire N round-trip RPCs. */
  function applyLayoutBatch(layouts: Map<TerminalId, TileLayout>) {
    if (layouts.size === 0) return;
    pendingLayouts.applyMany(layouts);
    for (const [id, layout] of layouts) {
      const prev = store.getMetadata(id)?.canvasLayout;
      if (!prev || !layoutsEqual(prev, layout)) {
        applyTileGeometry(id, layout);
      }
    }
  }

  /** One-shot rearrange triggered from the command palette. */
  function handleCanvasAutoArrange() {
    if (!supportsSpatialCanvas()) return;
    const tiles = store.terminalIds().flatMap((id) => {
      const layout = store.getMetadata(id)?.canvasLayout;
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
    const activeId = store.activeId();
    if (activeId && arranged.has(activeId)) store.activate(activeId);
  }

  /** Center the canvas on the active tile (the "Center on active tile" palette
   *  command). No-op off the spatial canvas (mobile / narrow) or at zero tiles.
   *  Moved out of App.tsx — sibling to `handleCanvasAutoArrange`, both
   *  canvas-spatial behavior over the same store. */
  function centerActive() {
    if (!supportsSpatialCanvas()) return;
    const id = store.activeId();
    if (id) store.activate(id);
  }

  return { applyTileGeometry, handleCanvasAutoArrange, centerActive };
}
