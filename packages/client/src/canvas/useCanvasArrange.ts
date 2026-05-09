/** Repo-island arrange + per-create placement composition.
 *
 *  Glues the pure layout module (`repoIslands.ts`) against the live
 *  terminal store + viewport. Lives outside `App.tsx` per the
 *  "App.tsx is a thin layout shell" rule (`.claude/rules/solidjs.md`):
 *  placement is its own domain (store reads, git-race fallback, no-op
 *  skip on writes, post-arrange recenter), and that domain owns its
 *  `useXxx.ts` module like every other feature.
 *
 *  Two arrange concerns live here:
 *  - `placeNew(id, existing)` — per-create policy fed to TerminalCanvas.
 *  - `handleCanvasAutoArrange()` — the one-shot palette command. */

import type { TerminalId } from "kolu-common/surface";
import { getBucketFor, resolvePlacementBucket } from "./placementPolicy";
import {
  arrangeRepoIslands,
  repackBucket,
  type RepoIslandTile,
} from "./repoIslands";
import { layoutsEqual, type TileLayout } from "./TileLayout";
import { usePendingLayouts } from "./usePendingLayouts";
import type { useCanvasViewport } from "./viewport/useCanvasViewport";
import type { useTerminalCrud } from "../terminal/useTerminalCrud";
import type { TerminalStore } from "../terminal/useTerminalStore";

export function useCanvasArrange(deps: {
  store: TerminalStore;
  crud: ReturnType<typeof useTerminalCrud>;
  viewport: ReturnType<typeof useCanvasViewport>;
  isMobile: () => boolean;
}) {
  const { store, crud, viewport, isMobile } = deps;
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

  /** Apply a layout map: seed pending BEFORE the per-tile writes go
   *  out, then dispatch geometry for each entry whose layout actually
   *  changed. The seed-before-dispatch ordering is load-bearing — a
   *  follow-on `placeNew` reading `existing` from the canvas's pending
   *  store must see the just-applied layouts, not the still-saved
   *  pre-arrange ones. Skips no-op writes so a re-arrange of an
   *  already-arranged workspace doesn't fire N round-trip RPCs and
   *  trigger a session-dirty save. */
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

  /** Per-create policy fed to `TerminalCanvas`'s `placeNew` prop.
   *
   *  Repacks the bucket's island to include the new tile in a square-ish
   *  grid — without this, every new tile would land to the right of the
   *  existing rightmost sibling and a many-worktree cluster would grow
   *  into a 1×N row instead of staying square. Existing tiles' layouts
   *  are dispatched here via `applyLayoutBatch`; the new tile's layout
   *  is returned for the caller to write last (matching the prop's
   *  `TileLayout | undefined` contract). */
  function placeNew(
    id: TerminalId,
    existing: { id: TerminalId; layout: TileLayout }[],
  ): TileLayout | undefined {
    const bucket = resolvePlacementBucket(
      store,
      id,
      existing.map((e) => e.id),
    );
    if (!bucket) return undefined;
    const islands = existing.flatMap((e) => {
      const t = repoIslandTileFor(e.id, e.layout);
      return t ? [t] : [];
    });
    const repacked = repackBucket(bucket, islands, id);
    if (!repacked) return undefined;

    const siblings = new Map<TerminalId, TileLayout>();
    for (const [tileId, layout] of repacked) {
      if (tileId !== id) siblings.set(tileId, layout);
    }
    applyLayoutBatch(siblings);

    return repacked.get(id);
  }

  /** One-shot rearrange triggered from the command palette. */
  function handleCanvasAutoArrange() {
    if (isMobile()) return;
    const tiles = store.terminalIds().flatMap((id) => {
      const layout = store.getMetadata(id)?.canvasLayout;
      if (!layout) return [];
      const tile = repoIslandTileFor(id, layout);
      return tile ? [tile] : [];
    });
    const arranged = arrangeRepoIslands(tiles);
    applyLayoutBatch(arranged);
    // Recenter on the active tile's new position so a far-away active
    // tile doesn't end up off-screen after arrange.
    const activeId = store.activeId();
    const activeLayout = activeId ? arranged.get(activeId) : undefined;
    if (activeLayout) viewport.centerOnTile(activeLayout);
  }

  return { applyTileGeometry, placeNew, handleCanvasAutoArrange };
}
