/** Pure path-set reconciliation for the `<FileTree>` wrapper — the logic that
 *  turns a new file inventory into the `@pierre/trees` `batch` ops that bring
 *  Pierre's tree to match it. Kept free of Solid and JSX so it stays a plain,
 *  directly-testable leaf; `FileTree.tsx` owns the imperative lifecycle that
 *  applies these ops. */

import type { FileTree as FileTreeClass } from "@pierre/trees";

type FileTreeBatchOperation = Parameters<FileTreeClass["batch"]>[0][number];
export type FileTreeRemoveOperation = Extract<
  FileTreeBatchOperation,
  { type: "remove" }
>;

/** Pierre's directory marker is a trailing slash: folder keys carry it
 *  (`src/`), file entries never do. The ONE place that fact is spelled — every
 *  site asking "is this row a directory?" reads it here, so the predicate
 *  can't drift into another ad-hoc `endsWith` at the next call site. */
export function isDirectoryPath(path: string): boolean {
  return path.endsWith("/");
}

/** `"/"`, as a char code — compared numerically in the scan below so the loop
 *  does no per-character string allocation. */
const SLASH = 47;

/** Strip Pierre's directory marker. Idempotent, and tolerates a repeated
 *  separator so a caller never has to know how many slashes arrived. Module
 *  private: `isDirectoryPath` is the marker's public face (every consumer asks
 *  whether a path IS a directory, never to un-mark one), so exporting this too
 *  would publish surface with no caller.
 *
 *  A scan rather than the obvious `/\/+$/` replace: that pattern backtracks
 *  quadratically on a path ending in many slashes (`js/polynomial-redos` — the
 *  engine retries `\/+$` from each slash in turn, and each retry rescans the
 *  run before failing the anchor). Paths reach this from `git ls-files`, i.e.
 *  from disk rather than from us, so their shape is not ours to bound. Walking
 *  back from the end touches each trailing slash once. */
function stripDirectoryMarker(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === SLASH) end--;
  return end === path.length ? path : path.slice(0, end);
}

/** Directory paths that contain `path`, formatted with the trailing
 *  slash Pierre uses for folder keys (`src/`, `src/right-panel/`).
 *  Tolerates an input that already carries a trailing slash (folder
 *  path) by stripping it before splitting. Mirrors the shape Pierre's
 *  internal `getAncestorDirectoryPaths` walks so the result can be
 *  fed back as `initialExpandedPaths` without surprises. */
export function ancestorDirectoryPaths(path: string): string[] {
  const normalized = stripDirectoryMarker(path);
  if (normalized.length === 0) return [];
  const segments = normalized.split("/").filter(Boolean);
  const out: string[] = [];
  let prefix = "";
  for (let i = 0; i < segments.length - 1; i++) {
    prefix += `${segments[i]}/`;
    out.push(prefix);
  }
  return out;
}

/** The add/remove operations that turn the `prev` file inventory into
 *  `next`, as Pierre `batch` ops. Driving path changes through `batch`
 *  rather than `resetPaths` mutates the tree in place: Pierre keeps the
 *  expansion, selection, and scroll state of every node it doesn't touch,
 *  so live-watcher churn (a file added or removed) and filter changes no
 *  longer collapse hand-opened folders. Removing a file does NOT delete its
 *  now-empty ancestor directories: Pierre `remove` promotes an emptied
 *  directory to an explicit empty folder so its row survives. The
 *  `FileTree.tsx` path-change effect runs `directoryRemovalOps` right after
 *  to prune those stranded rows; this function only diffs files. */
export function pathDiffOperations(
  prev: readonly string[],
  next: readonly string[],
): FileTreeBatchOperation[] {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const ops: FileTreeBatchOperation[] = [];
  for (const path of prev) {
    if (!nextSet.has(path)) ops.push({ type: "remove", path });
  }
  for (const path of next) {
    if (!prevSet.has(path)) ops.push({ type: "add", path });
  }
  return ops;
}

/** Recursive-remove ops that prune the directories the `prev`→`next` file
 *  change strands. `pathDiffOperations` removes files, but Pierre's `remove`
 *  promotes each emptied directory to an explicit empty folder rather than
 *  deleting it — so narrowing a filter to a handful of matches would leave
 *  the rest of the tree behind as hollow rows. A directory survives iff it is
 *  still an ancestor of some `next` file; the rest are pruned. Derived purely
 *  from the two file inventories — no separate directory state to drift out of
 *  sync, and a full-inventory `next` (a cleared search filter, which projects
 *  the whole inventory — not an empty list) yields no removals: its ancestor
 *  set then covers every directory that was in `prev`. For each dropped file
 *  we take its shallowest now-orphaned ancestor (the first absent from
 *  `next`'s ancestor set). That set is upward-closed, so the chosen ancestor
 *  is the root of a maximal dead subtree and the roots are pairwise disjoint;
 *  one `recursive` remove takes each whole subtree — emptied child directories
 *  and all — in a single op. */
export function directoryRemovalOps(
  prev: readonly string[],
  next: readonly string[],
): FileTreeRemoveOperation[] {
  const nextDirs = new Set<string>();
  for (const file of next) {
    for (const dir of ancestorDirectoryPaths(file)) nextDirs.add(dir);
  }
  const roots = new Set<string>();
  for (const file of prev) {
    for (const dir of ancestorDirectoryPaths(file)) {
      if (!nextDirs.has(dir)) {
        roots.add(dir);
        break;
      }
    }
  }
  return [...roots].map(
    (path): FileTreeRemoveOperation => ({
      type: "remove",
      path,
      recursive: true,
    }),
  );
}
