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
      // reactive paths are unavoidably two sites. The constructor site
      // also can't snapshot prior expansion from Pierre (the tree
      // object doesn't exist yet); the createEffect site runs
      // post-mount and CAN interrogate `tree.getItem(dir)?.isExpanded()`.
      // Don't try to merge these two sites — they are different
      // moments in the lifecycle with different available state.
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
    }, props.onError);
  });

  // `resetPaths` takes the new path inventory and the directories to
  // open in one call (Pierre's `FileTreeResetOptions.initialExpandedPaths`).
  // Tracking the inputs in the same effect means a paths-and-ancestors
  // swap lands atomically — no second effect, no ordering invariant
  // between "rebuild tree" and "open ancestors". The selected path's
  // ancestors are merged in too: when an external caller drives selection
  // (e.g. a terminal `path:line` click resolving into a nested file),
  // the parents must be expanded for the row to be visible. Pierre's
  // public surface doesn't expose `expandDirectory` directly, so the
  // expand-on-select is routed through this same `resetPaths` call.
  //
  // Pierre's `resetPaths` builds a brand-new `PathStore` whose only open
  // directories are those passed via `initialExpandedPaths`. Without
  // explicitly carrying the user's current expansion state forward, every
  // working-tree watcher tick (rm/touch/mv) would collapse every folder
  // the user had manually opened. Snapshot the directories Pierre
  // currently considers expanded — derived from the previous paths set —
  // and merge them into `initialExpandedPaths` so user-toggled state
  // survives the rebuild.
  createEffect(
    on(
      [
        () => props.paths,
        () => props.expandPaths,
        () => props.selectedPath ?? null,
      ],
      ([paths, expandPaths, selectedPath], prev) => {
        safeApply(() => {
          // Snapshot Pierre's currently-expanded directories so they
          // survive `resetPaths`'s fresh-PathStore rebuild. Iterate both
          // the previous and new paths' ancestor sets to cover dirs that
          // exist on either side of the swap. On the first deferred fire
          // (after mount) `prev` is undefined per SolidJS `on(defer:true)`
          // semantics; in that case the new paths alone still hold every
          // directory Pierre currently indexes (the constructor seeded
          // from the same `props.paths` source).
          const previouslyExpanded: string[] = [];
          if (tree) {
            const seenDirs = new Set<string>();
            const candidatePaths = [...(prev?.[0] ?? []), ...paths];
            for (const p of candidatePaths) {
              for (const dir of ancestorDirectoryPaths(p)) {
                if (seenDirs.has(dir)) continue;
                seenDirs.add(dir);
                const item = tree.getItem(dir);
                if (item && "isExpanded" in item && item.isExpanded()) {
                  previouslyExpanded.push(dir);
                }
              }
            }
          }
          const ancestors = selectedPath
            ? ancestorDirectoryPaths(selectedPath)
            : [];
          const expanded = [
            ...previouslyExpanded,
            ...(expandPaths ?? []),
            ...ancestors,
          ];
          tree?.resetPaths(paths, { initialExpandedPaths: expanded });
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
          if (path === null) {
            for (const p of tree?.getSelectedPaths() ?? []) {
              tree?.getItem(p)?.deselect();
            }
          } else {
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
