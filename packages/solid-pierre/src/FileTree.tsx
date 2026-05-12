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

export type FileTreeProps = {
  paths: string[];
  gitStatus?: GitStatusEntry[];
  selectedPath?: string | null;
  onSelect?: (path: string | null) => void;
  /** Enable Pierre's built-in header search affordance. Default `true`.
   *  Set to `false` when the host renders its own search input and
   *  drives the tree by projecting `paths` directly. */
  search?: boolean;
  /** Directories the wrapper should keep expanded on top of whatever
   *  Pierre's own expansion logic decides. Re-applied whenever this
   *  prop or `paths` changes; never *collapses* a path that's no
   *  longer listed, so a user's manual collapse on an unrelated
   *  directory survives. Pierre's controller does not fight these
   *  expansions because there is no active `setSearch` to drive
   *  `#refreshActiveSearchState`. */
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

  // Pierre's `getItem` returns a `FileHandle | FolderHandle | undefined`
  // union; only folders expose `expand`/`isExpanded`. Structural narrowing
  // here is the typed access path — there is no exported guard.
  const expandIfFolder = (path: string) => {
    const item = tree?.getItem(path);
    if (
      item != null &&
      "expand" in item &&
      "isExpanded" in item &&
      !item.isExpanded()
    ) {
      try {
        item.expand();
      } catch (e) {
        props.onError(toError(e));
      }
    }
  };

  const applyExpansions = (paths: readonly string[] | undefined) => {
    if (paths == null || tree == null) return;
    for (const path of paths) expandIfFolder(path);
  };

  onMount(() => {
    try {
      tree = new FileTreeClass({
        paths: props.paths,
        initialExpansion: props.initialExpansion ?? "closed",
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
      applyExpansions(props.expandPaths);
    } catch (e) {
      props.onError(toError(e));
    }
  });

  // Pierre's `resetPaths` rebuilds the path projection; whether it
  // preserves expansion for surviving paths is an implementation detail
  // we don't depend on. The expansion effect below re-applies expansion
  // requests after every paths change, which is idempotent (no-op when
  // the dir is already open).
  createEffect(
    on(
      () => props.paths,
      (paths) => {
        try {
          tree?.resetPaths(paths);
        } catch (e) {
          props.onError(toError(e));
        }
      },
      { defer: true },
    ),
  );

  // Registration order matters: the paths effect above runs first when
  // both change in the same tick, so Pierre's tree is rebuilt before we
  // ask it to expand ancestors of the freshly projected paths.
  createEffect(
    on(
      [() => props.paths, () => props.expandPaths],
      ([, expandPaths]) => applyExpansions(expandPaths),
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
