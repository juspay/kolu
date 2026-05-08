/** Placement-bucket resolution — the impure, store-aware half of the
 *  placement domain. Lives separately from `repoIslands.ts` (which is
 *  pure / deterministic / opaque to git) so the two volatility axes
 *  don't fight each other:
 *
 *  - `repoIslands.ts` — packing algorithm. Changes when the spatial
 *    rule changes (cluster shape, tile gap, anchor).
 *  - `placementPolicy.ts` (this file) — bucketing rule. Changes when
 *    "what counts as the same group" changes (today: `terminalKey().group`
 *    with a sibling-cwd fallback; tomorrow: workspaces, sub-terminal
 *    parent inheritance, pinned regions).
 *
 *  Both axes evolve independently of canvas orchestration in
 *  `useCanvasArrange.ts` (write coordination, recenter, mobile gate).
 *
 *  Future tiling modes that need git-aware per-create placement can
 *  reuse `getBucketFor` and `resolvePlacementBucket` directly — the
 *  module is the shared seam Lowy flagged in the PR #844 fourth-pass
 *  review. */

import type { TerminalId } from "kolu-common/surface";
import type { TerminalStore } from "../terminal/useTerminalStore";

/** Bucket key for a terminal — `key.group` from `terminalKey(meta)`.
 *  Single grep-able home so a future rule change (sub-terminals share
 *  parent's bucket; namespaced groups; …) updates one site. */
export function getBucketFor(
  store: TerminalStore,
  id: TerminalId,
): string | undefined {
  return store.getDisplayInfo(id)?.key.group;
}

/** Resolve a placement bucket for a tile whose git may not have
 *  resolved yet. Tries `key.group` first; if that doesn't match any
 *  candidate, walks `candidateIds` for a sibling whose git repo
 *  contains this tile's cwd and returns its bucket.
 *
 *  Covers the common race: a fresh terminal's metadata yields with
 *  `cwd` set but `git` still null, so its basename-derived `key.group`
 *  doesn't match a sibling whose git is fully resolved. */
export function resolvePlacementBucket(
  store: TerminalStore,
  id: TerminalId,
  candidateIds: TerminalId[],
): string | undefined {
  const ownBucket = getBucketFor(store, id);
  if (
    ownBucket &&
    candidateIds.some((c) => getBucketFor(store, c) === ownBucket)
  ) {
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
      const bucket = getBucketFor(store, candidate);
      if (!bucket) continue;
      if (!best || root.length > best.rootLength) {
        best = { bucket, rootLength: root.length };
      }
    }
  }
  return best?.bucket ?? ownBucket;
}
