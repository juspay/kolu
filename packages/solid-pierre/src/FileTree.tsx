/** SolidJS wrapper over `@pierre/trees`' vanilla `FileTree` class.
 *
 *  Pierre's `FileTree` owns its DOM (shadow-root rendered). Mount once,
 *  push updates via the class's setters (`resetPaths`, `setGitStatus`)
 *  inside reactive effects, and call `cleanUp()` on disposal.
 *  Construction throws are routed to the `onError` prop so consumers can
 *  show a fallback panel instead of letting the exception escape Solid's
 *  `<ErrorBoundary>` (which only catches errors during *Solid* render). */

import {
  FileTree as FileTreeClass,
  type FileTreeIconConfig,
  type FileTreeInitialExpansion,
  type GitStatusEntry,
} from "@pierre/trees";
import {
  type Component,
  createEffect,
  createMemo,
  type JSX,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { safeApply } from "./safeApply";

type FileTreeOptions = ConstructorParameters<typeof FileTreeClass>[0];
type Composition = NonNullable<FileTreeOptions["composition"]>;
type FileTreeContextMenu = NonNullable<Composition["contextMenu"]>;

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

type FileTreeBatchOperation = Parameters<FileTreeClass["batch"]>[0][number];
type FileTreeRemoveOperation = Extract<
  FileTreeBatchOperation,
  { type: "remove" }
>;

/** The add/remove operations that turn the `prev` file inventory into
 *  `next`, as Pierre `batch` ops. Driving path changes through `batch`
 *  rather than `resetPaths` mutates the tree in place: Pierre keeps the
 *  expansion, selection, and scroll state of every node it doesn't touch,
 *  so live-watcher churn (a file added or removed) and filter changes no
 *  longer collapse hand-opened folders. Removing a file does NOT delete its
 *  now-empty ancestor directories: Pierre `remove` promotes an emptied
 *  directory to an explicit empty folder so its row survives. The same
 *  path-change effect runs `directoryRemovalOps` right after to prune those
 *  stranded rows; this function only diffs files. */
function pathDiffOperations(
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

export type FileTreeProps = {
  paths: string[];
  gitStatus?: GitStatusEntry[];
  selectedPath?: string | null;
  onSelect?: (path: string | null) => void;
  /** Enable Pierre's built-in header search affordance. Default `true`.
   *  Set to `false` when the host renders its own search input and
   *  drives the tree by projecting `paths` directly. */
  search?: boolean;
  /** Directories Pierre should open whenever the path projection
   *  resets — forwarded as `initialExpandedPaths` to the constructor
   *  and to each `resetPaths` call. Pierre opens these atomically with
   *  the rebuild; expansion never falls out of sync with a path swap,
   *  and the wrapper holds no separate per-path expansion state. */
  expandPaths?: readonly string[];
  /** Initial folder expansion — captured at construction and **not
   *  reactive**. Pierre takes this once in its constructor; later prop
   *  changes are silently ignored. Re-mount the component (e.g. by
   *  toggling its parent `<Show when>`) to apply a new value. Defaults to
   *  `"closed"`. */
  initialExpansion?: FileTreeInitialExpansion;
  /** Collapse single-child directory chains (e.g. `packages/client/src` →
   *  one row). Default `true`. */
  flattenEmptyDirectories?: boolean;
  /** Row density — a Pierre preset (`compact` 24px / `default` 30px /
   *  `relaxed` 36px rows) or a numeric scale factor. Drives both the CSS row
   *  height and the virtualizer's row math, so it's the correct lever for
   *  touch-friendly rows (a CSS-only `--trees-item-height` override would
   *  desync the virtualizer). Snapshot at construction — **not reactive**;
   *  re-mount to change it (matches `initialExpansion`). Defaults to
   *  Pierre's `default`. */
  density?: FileTreeOptions["density"];
  /** Pin parent directory headers to the top of the scroll viewport.
   *  Default `true`. */
  stickyFolders?: boolean;
  /** Pierre's icon configuration — pass `{ set: "complete", ... }` plus
   *  any custom sprites. */
  icons?: FileTreeIconConfig;
  /** Pierre's typed contextmenu hook. */
  contextMenu?: FileTreeContextMenu;
  /** Surface construction or render throws to the host. Required because
   *  silent failure produces a blank pane indistinguishable from "no
   *  files" — bad UX, hard to debug. */
  onError: (err: Error) => void;
  /** Forwarded to the container `<div>`. */
  class?: string;
  /** Forwarded to the container `<div>` — host theming lives here. */
  style?: JSX.CSSProperties;
};

export const FileTree: Component<FileTreeProps> = (props) => {
  let container!: HTMLDivElement;
  let tree: FileTreeClass | undefined;
  // The path inventory Pierre's tree currently holds. Seeded at mount and
  // updated after every `batch`, so the next path change can be applied as
  // an in-place delta. Tracked here rather than via `on`'s `prevInput`
  // because that arg is `undefined` on the first post-`defer` run — which
  // would drop the very first delta's removals.
  let appliedPaths: readonly string[] = [];

  // Pierre fires `onSelectionChange` for directory clicks too, which would
  // produce an EISDIR if the consumer reads the path as a file. Directories
  // don't appear in `paths` (Pierre infers them from path prefixes), so
  // membership in this set is a reliable file-vs-folder discriminator.
  const fileSet = createMemo(() => new Set(props.paths));

  onMount(() => {
    safeApply(() => {
      // Snapshot read of `props.selectedPath` for `initialExpandedPaths`.
      // The deferred resetPaths effect below reads it reactively for
      // subsequent changes — Pierre doesn't expose a hook to re-feed
      // `initialExpandedPaths` after the constructor, so initial and
      // reactive paths are unavoidably two sites.
      const selectedAncestors = props.selectedPath
        ? ancestorDirectoryPaths(props.selectedPath)
        : [];
      tree = new FileTreeClass({
        paths: props.paths,
        initialExpansion: props.initialExpansion ?? "closed",
        initialExpandedPaths: [
          ...(props.expandPaths ?? []),
          ...selectedAncestors,
        ],
        flattenEmptyDirectories: props.flattenEmptyDirectories ?? true,
        density: props.density,
        stickyFolders: props.stickyFolders ?? true,
        icons: props.icons,
        search: props.search ?? true,
        gitStatus: props.gitStatus,
        initialSelectedPaths: props.selectedPath ? [props.selectedPath] : [],
        composition: props.contextMenu
          ? { contextMenu: props.contextMenu }
          : undefined,
        onSelectionChange: (paths) => {
          // Pierre fires with all selected paths; we model single-select.
          const p = paths[0] ?? null;
          if (p !== null && !fileSet().has(p)) return;
          props.onSelect?.(p);
        },
      });
      tree.render({ containerWrapper: container });
      // Mirror the reactive selection effect: pin the "selected row is
      // visible" invariant to this wrapper at both write sites instead
      // of relying on Pierre's mount-time auto-scroll
      // (`initialFocusedScrollAppliedRef`) to cover the constructor
      // path. Idempotent — Pierre's view processes the explicit scroll
      // request in the same render tick as its own first-mount scroll.
      if (props.selectedPath) tree.scrollToPath(props.selectedPath);
      appliedPaths = props.paths;
    }, props.onError);
  });

  // Push path-inventory changes into Pierre as in-place mutations, not a
  // `resetPaths` rebuild. `resetPaths` throws the tree's store away and
  // reopens only the directories it's handed, so it can't preserve the
  // folders the user expanded by hand; `batch(add/remove)` touches only the
  // changed nodes and leaves every other node's expansion/selection/scroll
  // intact. We diff the new inventory against `appliedPaths` (what the tree
  // currently holds), apply the delta, then record the new inventory. After
  // the delta we additively open the directories the projection wants
  // visible: the search-projected ancestors (`expandPaths`) and the selected
  // file's ancestors, so a freshly-added nested file or a filter match is
  // revealed. Expanding an already-open folder is a no-op, so this never
  // collapses anything.
  //
  // `selectedPath` is deliberately *not* a dependency — routing selection
  // through here would re-run on every file click. The selection effect
  // below reveals the picked row imperatively instead; we read `selectedPath`
  // untracked only so a genuine paths/expandPaths change reveals the current
  // selection.
  createEffect(
    on(
      [() => props.paths, () => props.expandPaths],
      ([paths, expandPaths]) => {
        safeApply(() => {
          if (!tree) return;
          const fileOps = pathDiffOperations(appliedPaths, paths);
          if (fileOps.length > 0) tree.batch(fileOps);
          // Pierre's `remove` promotes an emptied directory to an explicit
          // empty folder instead of deleting it (see `directoryRemovalOps`),
          // so the file removals above would otherwise strand a filter's
          // emptied directories as hollow rows. Prune them in one batch,
          // mirroring the file pass: the ops are disjoint maximal subtrees,
          // each removed recursively. The `getItem` guard is defensive — every
          // root still resolves after the file batch — and pruning never
          // touches a surviving directory's expansion, so a hand-collapsed
          // match folder stays collapsed.
          const dirOps: FileTreeRemoveOperation[] = [];
          for (const op of directoryRemovalOps(appliedPaths, paths)) {
            if (tree.getItem(op.path)) dirOps.push(op);
          }
          if (dirOps.length > 0) tree.batch(dirOps);
          appliedPaths = paths;
          const selectedPath = props.selectedPath ?? null;
          const toOpen = [
            ...(expandPaths ?? []),
            ...(selectedPath ? ancestorDirectoryPaths(selectedPath) : []),
          ];
          for (const dir of toOpen) {
            const item = tree.getItem(dir);
            if (item && "expand" in item) item.expand();
          }
        }, props.onError);
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.gitStatus,
      (g) => {
        safeApply(() => tree?.setGitStatus(g), props.onError);
      },
      { defer: true },
    ),
  );

  // Push post-mount `props.selectedPath` changes into Pierre's
  // selection state. Pierre's `initialSelectedPaths` is snapshot-only
  // at construction; reactive prop changes after mount must be applied
  // via `getItem(path)?.select()` / `deselect()` to mark
  // `aria-selected="true"`. Without this, a host that drives selection
  // through a reactive accessor (e.g. CodeTab's per-(repoRoot,view)
  // slot map) leaves the tree out of sync whenever selection arrives
  // after FileTree mount — the `Open path:N` flow from a diff is the
  // canonical case. `onSelectionChange` re-fires when we call
  // `select()`, so the host's `onSelect` handler must be idempotent on
  // same-value writes (which it already is, as a SolidJS reactive
  // setter on an equal value is a no-op).
  createEffect(
    on(
      () => props.selectedPath ?? null,
      (path) => {
        safeApply(() => {
          const current = tree?.getSelectedPaths()[0] ?? null;
          if (current === path) return;
          // Drop every selected row except `keep` (pass null to clear
          // all). Pierre's `select()` is additive — it never clears the
          // prior pick — so a switch must deselect the old row first or
          // the tree holds both, fires `onSelectionChange` with the stale
          // path at `paths[0]`, and the host reads that back as a
          // selection revert (the "first click after a file is already
          // open does nothing, second click works" bug).
          const deselectOthers = (keep: string | null) => {
            for (const p of tree?.getSelectedPaths() ?? []) {
              if (p !== keep) tree?.getItem(p)?.deselect();
            }
          };
          deselectOthers(path);
          if (path !== null) {
            // Open the picked file's ancestors so the row is visible —
            // an external caller can drive selection into a collapsed
            // subtree (e.g. a terminal `path:line` click resolving into a
            // nested file). Expanding each directory handle in place
            // preserves every other open folder; routing this through
            // `resetPaths` would rebuild the tree and collapse the user's
            // hand-expanded siblings. `getItem` returns a directory-or-file
            // handle union: `"expand" in item` is the narrowing — Pierre's
            // `isDirectory()` returns a `true`/`false` literal but isn't a
            // `this is` predicate, so it can't narrow, whereas the `in`
            // check both compiles and probes for the exact capability we're
            // about to call. Re-expanding an open folder is a no-op; a file
            // or a missing path narrows away and is skipped.
            for (const ancestor of ancestorDirectoryPaths(path)) {
              const item = tree?.getItem(ancestor);
              if (item && "expand" in item) item.expand();
            }
            tree?.getItem(path)?.select();
            // `select()` marks aria-selected but doesn't move the
            // virtualizer; deep paths in large worktrees would stay
            // off-screen until the user scrolled. `scrollToPath`
            // reveals the row.
            tree?.scrollToPath(path);
          }
        }, props.onError);
      },
      { defer: true },
    ),
  );

  onCleanup(() => tree?.cleanUp());

  return (
    <div
      ref={container}
      class={props.class}
      style={props.style}
      data-testid="pierre-file-tree"
    />
  );
};
