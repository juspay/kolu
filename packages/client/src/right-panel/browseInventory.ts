import {
  ancestorDirectoryPaths,
  hasPathUnderPrefix,
  isDirectoryPath,
} from "@kolu/solid-pierre/paths";

export interface BrowseInventory {
  paths: string[];
  ignored: string[];
  lazyDirs: string[];
  pending: boolean;
}

export function mergeBrowseInventory(
  tracked: readonly string[] | undefined,
  ignored: readonly string[] | undefined,
  loadedChildren: ReadonlyMap<string, readonly string[]> | undefined,
  readiness: {
    trackedPending: boolean;
    ignoredPending: boolean;
    showIgnored: boolean;
  },
): BrowseInventory {
  const pending =
    readiness.trackedPending ||
    (readiness.showIgnored && readiness.ignoredPending);
  if (!tracked) return { paths: [], ignored: [], lazyDirs: [], pending };
  if (!ignored?.length)
    return { paths: [...tracked], ignored: [], lazyDirs: [], pending };
  const trackedAuthority = new Set(tracked);
  const overlay = dropTrackedOverlaps(ignored, tracked, trackedAuthority);
  const walk = substituteLoadedLevels(
    overlay,
    loadedChildren,
    trackedAuthority,
  );

  return {
    paths: [...tracked, ...walk.renderedRows],
    ignored: [...walk.renderedRows, ...walk.replacedDirs],
    lazyDirs: walk.lazyDirs,
    pending,
  };
}

function dropTrackedOverlaps(
  ignored: readonly string[],
  tracked: readonly string[],
  trackedAuthority: ReadonlySet<string>,
): string[] {
  return ignored.filter((p) => {
    if (trackedAuthority.has(p)) return false;
    if (isDirectoryPath(p) && hasPathUnderPrefix(p, tracked)) return false;
    return true;
  });
}

interface LazyWalk {
  renderedRows: string[];
  lazyDirs: string[];
  replacedDirs: string[];
}

type LoadedLevel =
  | { readonly kind: "absent" }
  | { readonly kind: "empty" }
  | { readonly kind: "entries"; readonly entries: readonly string[] };

function loadedLevel(
  loadedChildren: ReadonlyMap<string, readonly string[]> | undefined,
  dir: string,
): LoadedLevel {
  const children = loadedChildren?.get(dir);
  if (children === undefined) return { kind: "absent" };
  return children.length === 0
    ? { kind: "empty" }
    : { kind: "entries", entries: children };
}

function substituteLoadedLevels(
  entries: readonly string[],
  loadedChildren: ReadonlyMap<string, readonly string[]> | undefined,
  claimed?: ReadonlySet<string>,
): LazyWalk {
  const renderedRows: string[] = [];
  const lazyDirs: string[] = [];
  const replacedDirs: string[] = [];
  const visited = new Set<string>();
  const emit = (entry: string): void => {
    if (claimed?.has(entry)) return;
    if (!isDirectoryPath(entry)) {
      renderedRows.push(entry);
      return;
    }
    if (visited.has(entry)) return;
    visited.add(entry);
    lazyDirs.push(entry);
    const level = loadedLevel(loadedChildren, entry);
    if (level.kind !== "entries") {
      renderedRows.push(entry);
      return;
    }
    replacedDirs.push(entry);
    for (const child of level.entries) emit(child);
  };
  for (const entry of entries) emit(entry);
  return { renderedRows, lazyDirs, replacedDirs };
}

export function diskInventory(
  rootLevel: readonly string[] | undefined,
  loadedChildren: ReadonlyMap<string, readonly string[]> | undefined,
  pending: boolean,
): BrowseInventory {
  if (!rootLevel) return { paths: [], ignored: [], lazyDirs: [], pending };
  const walk = substituteLoadedLevels(rootLevel, loadedChildren);
  return {
    paths: walk.renderedRows,
    ignored: [],
    lazyDirs: walk.lazyDirs,
    pending,
  };
}

export function foldTypeChanges(paths: string[]): string[] {
  const filePaths = new Set(paths);
  const withoutShadowedDirs = paths.filter(
    (p) =>
      !ancestorDirectoryPaths(p).some((dir) => filePaths.has(dir.slice(0, -1))),
  );
  const collided = withoutShadowedDirs.length !== paths.length;
  return collided ? withoutShadowedDirs : paths;
}

export function diffInventory(
  paths: string[],
  pending: boolean,
): BrowseInventory {
  return { paths: foldTypeChanges(paths), ignored: [], lazyDirs: [], pending };
}
