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
import { toError } from "./toError";

type FileTreeOptions = ConstructorParameters<typeof FileTreeClass>[0];
type Composition = NonNullable<FileTreeOptions["composition"]>;
type FileTreeContextMenu = NonNullable<Composition["contextMenu"]>;

/** Directory paths that contain `path`, formatted with the trailing
 *  slash Pierre uses for folder keys (`src/`, `src/right-panel/`). The
 *  list is leaf-first → root, which is the order Pierre's
 *  `initialExpandedPaths` walks. */
function ancestorsOf(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(`${parts.slice(0, i).join("/")}/`);
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
    try {
      const selectedAncestors = props.selectedPath
        ? ancestorsOf(props.selectedPath)
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
    } catch (e) {
      props.onError(toError(e));
    }
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
  createEffect(
    on(
      [
        () => props.paths,
        () => props.expandPaths,
        () => props.selectedPath ?? null,
      ],
      ([paths, expandPaths, selectedPath]) => {
        try {
          const ancestors = selectedPath ? ancestorsOf(selectedPath) : [];
          const expanded = [...(expandPaths ?? []), ...ancestors];
          tree?.resetPaths(paths, { initialExpandedPaths: expanded });
        } catch (e) {
          props.onError(toError(e));
        }
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.gitStatus,
      (g) => {
        try {
          tree?.setGitStatus(g);
        } catch (e) {
          props.onError(toError(e));
        }
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
