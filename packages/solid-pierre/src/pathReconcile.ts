import type { FileTree as FileTreeClass } from "@pierre/trees";

type FileTreeBatchOperation = Parameters<FileTreeClass["batch"]>[0][number];
export type FileTreeRemoveOperation = Extract<
  FileTreeBatchOperation,
  { type: "remove" }
>;

/** Pierre's directory marker is a trailing slash: folder keys carry it
 *  (`src/`), file entries never do. */
export function isDirectoryPath(path: string): boolean {
  return path.endsWith("/");
}

/** True when any path in `paths` other than `prefix` itself lives under the
 *  directory key `prefix` (trailing slash required — callers use
 *  `isDirectoryPath`). */
export function hasPathUnderPrefix(
  prefix: string,
  paths: readonly string[],
): boolean {
  for (const p of paths) {
    if (p !== prefix && p.startsWith(prefix)) return true;
  }
  return false;
}

/** Drop collapsed directory keys that still have a sibling path under them:
 *  such a key is redundant once any child is listed, because the child implies
 *  the directory node. */
export function dropRedundantDirKeys(paths: readonly string[]): string[] {
  const coveredByChildren = new Set<string>();
  for (const p of paths) {
    for (const dir of ancestorDirectoryPaths(p)) coveredByChildren.add(dir);
  }
  return paths.filter((p) => !isDirectoryPath(p) || !coveredByChildren.has(p));
}

const SLASH = 47;

function scanPastTrailingSlashes(path: string): number {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === SLASH) end--;
  return end;
}

/** Directory paths that contain `path`, formatted with the trailing slash
 *  Pierre uses for folder keys (`src/`, `src/right-panel/`). Tolerates an
 *  input that already carries a trailing slash. Mirrors the shape Pierre's
 *  internal `getAncestorDirectoryPaths` walks, so the result can be fed back
 *  as `initialExpandedPaths`. */
export function ancestorDirectoryPaths(path: string): string[] {
  const normalized = path.slice(0, scanPastTrailingSlashes(path));
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
 *  Pierre `batch` ops — an in-place mutation, so the expansion, selection and
 *  scroll state of every untouched node survives. Inventory entries may be
 *  files or collapsed directory keys (trailing slash); a remove of a directory
 *  key is marked `recursive` so Pierre does not throw when that node still has
 *  children. Removing a *file* does NOT delete its now-empty ancestor
 *  directories — pair with `directoryRemovalOps` to prune those rows. */
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
 *  change strands: Pierre's `remove` promotes each emptied directory to an
 *  explicit empty folder rather than deleting it. A directory survives iff it
 *  is still an ancestor of some `next` path; each op names the root of a
 *  maximal dead subtree and takes it whole. */
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
