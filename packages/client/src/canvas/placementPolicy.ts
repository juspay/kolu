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

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import type { TerminalStore } from "../terminal/useTerminalStore";

/** The minimal tile-data surface placement needs — `getDisplayInfo` (bucket
 *  group) and `getMetadata` (cwd / git roots). Satisfied by BOTH the terminal
 *  store and the TILE registry, so arrange can run over the tile union: a
 *  SLEEPING tile resolves its bucket from synthesized data and clusters with its
 *  repo like a live tile, instead of arranging to an undefined bucket. */
export type PlacementStore = Pick<
  TerminalStore,
  "getDisplayInfo" | "getMetadata"
>;

/** Bucket key for a terminal — `key.group` from `terminalKey(meta)`.
 *  Single grep-able home so a future rule change (sub-terminals share
 *  parent's bucket; namespaced groups; …) updates one site. */
export function getBucketFor(
  store: PlacementStore,
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
  store: PlacementStore,
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
  return resolveByContainment(store, cwd, candidateIds) ?? ownBucket;
}

/** Containment fallback for `resolvePlacementBucket`: walk every
 *  candidate's git roots, return the bucket whose root MOST
 *  SPECIFICALLY contains `cwd`.
 *
 *  Specificity = path length. Two intuitions ride on the same length
 *  comparison and happen to agree under git's worktree layout:
 *  - **Nested-repo precedence**: a submodule's working tree at
 *    `/repo/sub` outranks the parent at `/repo`.
 *  - **Same-worktree-over-parent precedence**: a worktree's own
 *    `repoRoot` (e.g. `/repo/.worktrees/wt0`) outranks its
 *    `mainRepoRoot` (`/repo`). When the user opens a new terminal
 *    inside `/repo/.worktrees/wt0`, the existing wt0 tile wins over
 *    a parent-repo tile — that's the user's mental model.
 *
 *  Both intuitions are captured by "longest matched root wins". If
 *  a future workspace concept (monorepo, common-dir for stacked
 *  worktrees, …) breaks the path-length proxy, this is the site to
 *  split the comparator. */
function resolveByContainment(
  store: PlacementStore,
  cwd: string,
  candidateIds: TerminalId[],
): string | undefined {
  let best: { bucket: string; rootLength: number } | undefined;
  for (const candidate of candidateIds) {
    const bucket = getBucketFor(store, candidate);
    if (!bucket) continue;
    for (const root of candidateRootsFor(store.getMetadata(candidate))) {
      if (cwd !== root && !cwd.startsWith(`${root}/`)) continue;
      if (!best || root.length > best.rootLength) {
        best = { bucket, rootLength: root.length };
      }
    }
  }
  return best?.bucket;
}

/** The git roots that count for placement-containment matching. For a
 *  non-worktree tile both fields equal the same path, so we dedupe; for
 *  a worktree, `repoRoot` is the worktree's own working dir and
 *  `mainRepoRoot` is the shared parent — both can legitimately contain
 *  another tile's cwd. Adding a future root field (e.g. monorepo
 *  workspace, git's `commondir` for stacked worktrees) is one update
 *  here, not at every walk site. */
function candidateRootsFor(
  meta: TerminalMetadata | undefined,
): readonly string[] {
  const git = meta?.git;
  if (!git) return [];
  const roots = new Set<string>();
  if (git.repoRoot) roots.add(git.repoRoot);
  if (git.mainRepoRoot) roots.add(git.mainRepoRoot);
  return [...roots];
}
