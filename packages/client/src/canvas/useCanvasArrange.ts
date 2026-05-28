/** Repo-island arrange + per-create placement composition.
 *
 *  Glues the pure layout module (`repoIslands.ts`) against the live
 *  terminal store. Lives outside `App.tsx` per the "App.tsx is a thin
 *  layout shell" rule (`.claude/rules/solidjs.md`): placement is its
 *  own domain (store reads, git-race fallback, no-op skip on writes,
 *  post-arrange recenter), and that domain owns its `useXxx.ts` module
 *  like every other feature.
 *
 *  Two arrange concerns live here:
 *  - `placeNew(id, existing)` — per-create policy fed to TerminalCanvas.
 *  - `handleCanvasAutoArrange()` — the one-shot palette command. */

import {
  arrangeRepoIslands,
  type RepoIslandTile,
  repackBucket,
} from "@kolu/canvas-layout";
import type { TerminalId } from "kolu-common/surface";
import type { useTerminalCrud } from "../terminal/useTerminalCrud";
import type { TerminalStore } from "../terminal/useTerminalStore";
import { getBucketFor, resolvePlacementBucket } from "./placementPolicy";
import { layoutsEqual, type TileLayout } from "./TileLayout";
import { usePendingLayouts } from "./usePendingLayouts";

export function useCanvasArrange(deps: {
  store: TerminalStore;
  crud: ReturnType<typeof useTerminalCrud>;
  isMobile: () => boolean;
}) {
  const { store, crud, isMobile } = deps;
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

  /** Seed pending BEFORE dispatching writes — a follow-on `placeNew`
   *  reading `existing` from the canvas's pending store must see the
   *  just-applied layouts, not the still-saved ones. Skips no-op
   *  writes so a re-arrange doesn't fire N round-trip RPCs. */
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
   *  Sibling layouts dispatched via `applyLayoutBatch`; the new tile's
   *  layout is returned for the caller to write last. */
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
    // tile doesn't end up off-screen after arrange. `activate` re-bumps
    // the centering signal even though active hasn't changed (the canvas
    // resolves the just-applied pending layout via `layoutOf`), so this
    // shares the create/close path.
    const activeId = store.activeId();
    if (activeId && arranged.has(activeId)) store.activate(activeId);
  }

  return { applyTileGeometry, placeNew, handleCanvasAutoArrange };
}
