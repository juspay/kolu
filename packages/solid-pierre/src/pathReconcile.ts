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

/** Directory paths that contain `path`, formatted with the trailing
 *  slash Pierre uses for folder keys (`src/`, `src/right-panel/`).
 *  Tolerates an input that already carries a trailing slash (folder
 *  path) by stripping it before splitting. Mirrors the shape Pierre's
 *  internal `getAncestorDirectoryPaths` walks so the result can be
 *  fed back as `initialExpandedPaths` without surprises. */
export function ancestorDirectoryPaths(path: string): string[] {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  if (normalized.length === 0) return [];
  const segments = normalized.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < segments.length; i += 1) {
    out.push(`${segments.slice(0, i).join("/")}/`);
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
 *  sync, and an empty `next` (a cleared filter) yields no removals because its
 *  ancestor set then covers every surviving directory. For each dropped file
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
