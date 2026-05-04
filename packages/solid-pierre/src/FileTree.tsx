/** SolidJS wrapper over `@pierre/trees`' vanilla `FileTree` class.
 *
 *  Pierre's `FileTree` owns its DOM (shadow-root rendered). Mount once,
 *  push updates via the class's setters (`resetPaths`, `setGitStatus`,
 *  `setSearch`) inside reactive effects, and call `cleanUp()` on disposal.
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
  untrack,
} from "solid-js";
import { toError } from "./toError";

type FileTreeOptions = ConstructorParameters<typeof FileTreeClass>[0];
type Composition = NonNullable<FileTreeOptions["composition"]>;

/** Pierre's typed contextmenu hook surfaced as a single prop. The inner
 *  shape is Pierre's — `{ enabled, triggerMode, render }` — so consumers
 *  can lean on Pierre's docs/types directly without a stringly-keyed
 *  escape hatch. */
export type FileTreeContextMenu = NonNullable<Composition["contextMenu"]>;

export type FileTreeProps = {
  paths: string[];
  gitStatus?: GitStatusEntry[];
  selectedPath?: string | null;
  onSelect?: (path: string | null) => void;
  /** Enable Pierre's built-in header search affordance. Default `true`.
   *  Set to `false` when the host renders its own search input and drives
   *  the tree externally via `searchQuery`. */
  search?: boolean;
  /** External search query — when provided, forwarded to Pierre's
   *  `setSearch()`. Useful when search lives in the caller's chrome
   *  rather than the tree header. Pass empty string or `null` to clear. */
  searchQuery?: string | null;
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
      // Apply an initial searchQuery if it was already non-empty at mount —
      // the deferred effect below only fires on subsequent changes, so a
      // pre-mount value would otherwise be silently dropped.
      const initialQuery = untrack(() => props.searchQuery);
      if (initialQuery && initialQuery.length > 0) {
        tree.setSearch(initialQuery);
      }
    } catch (e) {
      props.onError(toError(e));
    }
  });

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

  createEffect(
    on(
      () => props.searchQuery,
      (q) => {
        try {
          tree?.setSearch(q && q.length > 0 ? q : null);
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
