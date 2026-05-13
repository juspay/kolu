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
  type FileTreeRowDecorationRenderer,
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
  /** Per-row decoration callback — Pierre invokes this on every visible
   *  row to ask for a tiny text/icon badge (e.g. a bullet for "this
   *  file has comments"). Pierre captures the function at construction
   *  and has no `setRenderRowDecoration` mutator, so we route prop
   *  identity changes through a stable wrapper that reads a mutable
   *  ref, and nudge Pierre to re-render by calling `setGitStatus`
   *  with the current value (the only public mutator that triggers a
   *  full row re-render — see `render/FileTree.js`'s `setGitStatus`,
   *  which delegates to `renderFileTreeRoot`). */
  renderRowDecoration?: FileTreeRowDecorationRenderer;
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

  // Stable indirection for the decoration renderer — Pierre captures
  // its `renderRowDecoration` at construction, but we want the prop to
  // remain reactive (so the caller can flip "is this file commented?"
  // without rebuilding the whole tree). The wrapper reads the latest
  // prop on each invocation; an effect below nudges Pierre to re-render
  // when the prop's identity changes.
  const stableDecorationRenderer: FileTreeRowDecorationRenderer = (ctx) =>
    props.renderRowDecoration?.(ctx) ?? null;

  onMount(() => {
    try {
      tree = new FileTreeClass({
        paths: props.paths,
        initialExpansion: props.initialExpansion ?? "closed",
        initialExpandedPaths: props.expandPaths,
        flattenEmptyDirectories: props.flattenEmptyDirectories ?? true,
        stickyFolders: props.stickyFolders ?? true,
        icons: props.icons,
        search: props.search ?? true,
        gitStatus: props.gitStatus,
        initialSelectedPaths: props.selectedPath ? [props.selectedPath] : [],
        composition: props.contextMenu
          ? { contextMenu: props.contextMenu }
          : undefined,
        renderRowDecoration: props.renderRowDecoration
          ? stableDecorationRenderer
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
  // Tracking both inputs in the same effect means a paths-and-ancestors
  // swap lands atomically — no second effect, no ordering invariant
  // between "rebuild tree" and "open ancestors".
  createEffect(
    on(
      [() => props.paths, () => props.expandPaths],
      ([paths, expandPaths]) => {
        try {
          tree?.resetPaths(paths, { initialExpandedPaths: expandPaths });
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

  // Pierre exposes no `setRenderRowDecoration` mutator; the captured
  // wrapper reads `props.renderRowDecoration` every call, but Pierre
  // only re-invokes it when something else triggers a row re-render.
  // Piggyback on `setGitStatus(currentValue)` — its implementation
  // unconditionally re-renders the tree root — so a decoration data
  // change (caller swaps the prop's function identity) immediately
  // reflects in the UI without forcing a `resetPaths` rebuild.
  createEffect(
    on(
      () => props.renderRowDecoration,
      () => {
        try {
          tree?.setGitStatus(props.gitStatus);
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
