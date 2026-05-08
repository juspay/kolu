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
import {
  arrangeRepoIslands,
  placeNextToBucket,
  type RepoIslandTile,
} from "./repoIslands";
import { layoutsEqual, type TileLayout } from "./TileLayout";
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

  /** Apply a tile's geometry — drag-end, resize-end, default-place,
   *  and arrange all flow through this single point. The 500ms session
   *  auto-save throttle on the server collapses N writes into one save,
   *  so the per-tile RPC is fine for batch flows like arrange. */
  function applyTileGeometry(id: TerminalId, layout: TileLayout) {
    crud.setCanvasLayout(id, layout);
  }

  /** Bucket key used by repo-island layout — `key.group` from
   *  `terminalKey(meta)`. Single site so a future rule change (e.g.
   *  sub-terminals share parent's bucket) doesn't have to track down
   *  every projection. */
  function getBucketFor(id: TerminalId): string | undefined {
    return store.getDisplayInfo(id)?.key.group;
  }

  function repoIslandTileFor(
    id: TerminalId,
    layout: TileLayout,
  ): RepoIslandTile | undefined {
    const bucket = getBucketFor(id);
    return bucket ? { id, bucket, layout } : undefined;
  }

  /** Resolve a placement bucket for a tile whose git may not have been
   *  resolved yet. Tries `key.group` first; if that doesn't match any
   *  candidate bucket, walks `candidateIds` for a sibling whose git
   *  repo contains this tile's cwd and returns its bucket. The fallback
   *  covers the common race: a fresh terminal's metadata yields with
   *  `cwd` set but `git` still null, so its basename-derived `key.group`
   *  doesn't match a sibling whose git is fully resolved. */
  function resolvePlacementBucket(
    id: TerminalId,
    candidateIds: TerminalId[],
  ): string | undefined {
    const ownBucket = getBucketFor(id);
    if (ownBucket && candidateIds.some((c) => getBucketFor(c) === ownBucket)) {
      return ownBucket;
    }
    const cwd = store.getMetadata(id)?.cwd;
    if (!cwd) return ownBucket;
    // Prefer the most-specific (longest) repo root so a terminal in a
    // nested repo lands in the child repo's island, not the parent's —
    // matches what the user would expect when they cd into a submodule.
    let best: { bucket: string; rootLength: number } | undefined;
    for (const candidate of candidateIds) {
      const root = store.getMetadata(candidate)?.git?.repoRoot;
      if (!root) continue;
      if (cwd === root || cwd.startsWith(`${root}/`)) {
        const bucket = getBucketFor(candidate);
        if (!bucket) continue;
        if (!best || root.length > best.rootLength) {
          best = { bucket, rootLength: root.length };
        }
      }
    }
    return best?.bucket ?? ownBucket;
  }

  /** Per-create policy fed to `TerminalCanvas`'s `placeNew` prop. */
  function placeNew(
    id: TerminalId,
    existing: { id: TerminalId; layout: TileLayout }[],
  ): TileLayout | undefined {
    const bucket = resolvePlacementBucket(
      id,
      existing.map((e) => e.id),
    );
    if (!bucket) return undefined;
    const islands = existing.flatMap((e) => {
      const t = repoIslandTileFor(e.id, e.layout);
      return t ? [t] : [];
    });
    return placeNextToBucket(bucket, islands);
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
    // Skip no-op writes: a re-arrange of an already-arranged workspace
    // shouldn't fire N round-trip RPCs and trigger a session-dirty save.
    for (const [id, layout] of arranged) {
      const prev = store.getMetadata(id)?.canvasLayout;
      if (!prev || !layoutsEqual(prev, layout)) {
        applyTileGeometry(id, layout);
      }
    }
    // Recenter on the active tile's new position so a far-away active
    // tile doesn't end up off-screen after arrange.
    const activeId = store.activeId();
    const activeLayout = activeId ? arranged.get(activeId) : undefined;
    if (activeLayout) viewport.centerOnTile(activeLayout);
  }

  return { applyTileGeometry, placeNew, handleCanvasAutoArrange };
}
