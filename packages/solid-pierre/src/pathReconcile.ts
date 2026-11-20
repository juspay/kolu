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

/** True when any path in `paths` other than `prefix` itself lives under the
 *  directory key `prefix` (trailing slash required — callers use
 *  `isDirectoryPath`). Shared by merge inventory and path-diff so the
 *  "tracked/next children under this dir" rule cannot drift. */
export function hasPathUnderPrefix(
  prefix: string,
  paths: readonly string[],
): boolean {
  for (const p of paths) {
    if (p !== prefix && p.startsWith(prefix)) return true;
  }
  return false;
}

/** Drop collapsed directory keys that still have a sibling path under them —
 *  those keys are redundant once any child is listed (the directory node is
 *  implied by the child). Normalizing both sides of a path-diff removes the
 *  need for a skip-remove branch and keeps `appliedPaths` a single meaning.
 *  Single pass: collect ancestor prefixes of every path, then drop any dir key
 *  that appears in that set — O(total path segments), not O(dirKeys × n). */
export function dropRedundantDirKeys(paths: readonly string[]): string[] {
  const coveredByChildren = new Set<string>();
  for (const p of paths) {
    for (const dir of ancestorDirectoryPaths(p)) coveredByChildren.add(dir);
  }
  return paths.filter((p) => !isDirectoryPath(p) || !coveredByChildren.has(p));
}

const SLASH = 47;

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

/** The add/remove operations that turn the `prev` inventory into `next`, as
 *  Pierre `batch` ops. Driving path changes through `batch` rather than
 *  `resetPaths` mutates the tree in place: Pierre keeps the expansion,
 *  selection, and scroll state of every node it doesn't touch, so
 *  live-watcher churn (a file added or removed) and filter changes no longer
 *  collapse hand-opened folders. Inventory entries may be files or collapsed
 *  directory keys (trailing slash); a remove of a directory key is marked
 *  `recursive` so Pierre does not throw when that node still has children.
 *  Removing a *file* does NOT delete its now-empty ancestor directories:
 *  Pierre `remove` promotes an emptied directory to an explicit empty folder
 *  so its row survives. The `FileTree.tsx` path-change effect runs
 *  `directoryRemovalOps` right after to prune those stranded rows. */
export function pathDiffOperations(
  prev: readonly string[],
  next: readonly string[],
): FileTreeBatchOperation[] {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const ops: FileTreeBatchOperation[] = [];
  for (const path of prev) {
    if (nextSet.has(path)) continue;
    ops.push(
      isDirectoryPath(path)
        ? { type: "remove", path, recursive: true }
        : { type: "remove", path },
    );
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
    if (isDirectoryPath(file)) nextDirs.add(file);
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
