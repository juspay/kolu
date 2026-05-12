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
type FileTreeContextMenu = NonNullable<Composition["contextMenu"]>;

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
  /** Notified when the wrapper's filter state has gone to null
   *  independently of the host's `searchQuery` prop, leaving the host's
   *  input out of sync with the tree. Today the only trigger is a
   *  folder-row click during an active query — Pierre's
   *  `hide-non-matches` mode auto-expands every ancestor of a match on
   *  each store event, so a collapse can only stick after the filter is
   *  released; the wrapper takes Pierre's own `closeSearch()` as the
   *  user's exit cue. Hosts should resync their search input (typically
   *  by clearing it) when this fires. Only invoked when `searchQuery`
   *  was non-empty at the time of clearing. */
  onSearchCleared?: () => void;
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

  // Pierre rejects `""` for setSearch (empty string ≠ "no filter"); collapse
  // empty/null/undefined to `null` so callers don't need to reproduce this.
  const normalizeSearchQuery = (q: string | null | undefined) =>
    q && q.length > 0 ? q : null;

  // Single funnel for "tell Pierre to (re)set its filter". Three callers —
  // initial mount, the deferred prop effect, and the row-click re-apply
  // below — all need identical normalization and the same `onError` route,
  // so they share one helper rather than three try/catch dances.
  const applySearchQuery = (q: string | null | undefined) => {
    try {
      tree?.setSearch(normalizeSearchQuery(q));
    } catch (e) {
      props.onError(toError(e));
    }
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

      // Pierre's `handleRowClick` (in
      // `node_modules/@pierre/trees/dist/render/FileTreeView.js`) clears its
      // internal search via `controller.closeSearch()` after every row
      // click — `closeSearch: isSearchOpen` is hardcoded in
      // `fileTreeRowClickPlan.js` with no opt-out. When the host drives
      // search externally via `searchQuery`, that prop is the source of
      // truth, so we restore it after Pierre's click handler returns.
      //
      // We hook the DOM `click` event rather than Pierre's
      // `onSelectionChange` callback because Pierre's selection-version
      // gate (`FileTreeController.js` `#applySelection` short-circuits
      // when the new selection equals the current one) suppresses the
      // callback on re-clicks of the already-selected row — but
      // `closeSearch()` still runs on every click, so an
      // `onSelectionChange`-based hook would silently miss the re-click
      // case while Pierre wipes the filter anyway.
      //
      // Detection uses the `data-item-path` and `aria-expanded`
      // attributes Pierre stamps on every row, read by walking
      // `event.composedPath()` to pierce the shadow root. File-vs-folder
      // discrimination reuses `fileSet` — the same Set that gates
      // `onSelectionChange`, since directories never appear in
      // `props.paths`. The listener runs in capture phase so reads happen
      // *before* Pierre's bubble-phase row handler mutates state — folder
      // rows need the pre-click expansion to reconstruct user intent.
      // Invariants this depends on:
      //   1. Pierre's row-click handler stays synchronous (so the
      //      microtask runs *after* `closeSearch` has fired, not before).
      //   2. Pierre keeps emitting `data-item-path` and `aria-expanded`
      //      on row elements.
      // Both are true today; both would silently break this re-apply if
      // Pierre changes them, so they're worth the comment.
      //
      // File rows: re-apply the host's search so the filter survives
      // Pierre's `closeSearch()`.
      //
      // Folder rows: `hide-non-matches` mode auto-expands every match
      // ancestor on each store event (FileTreeController `#subscribe` ->
      // `#refreshActiveSearchState`), so a `setSearch` re-apply would
      // immediately revert the user's collapse. Skip the re-apply and
      // hand the host an `onSearchCleared` signal so its input
      // clears to match the tree state. If the row was expanded
      // pre-click but Pierre's `closeSearch` left it expanded (happens
      // in `"open"` initial-expansion mode, where pre-search expanded
      // paths include the folder), force a collapse — now safe because
      // search is null and `#refreshActiveSearchState` won't fire.
      const findClickedRow = (path: readonly EventTarget[]) => {
        for (const target of path) {
          if (
            target instanceof HTMLElement &&
            target.dataset.itemPath !== undefined
          ) {
            return {
              path: target.dataset.itemPath,
              wasExpanded: target.getAttribute("aria-expanded") === "true",
            } as const;
          }
        }
        return null;
      };
      const handleTreeRowClick = (event: MouseEvent) => {
        const row = findClickedRow(event.composedPath());
        if (row === null) return;
        const isFolder = !fileSet().has(row.path);
        queueMicrotask(() => {
          const q = untrack(() => props.searchQuery);
          if (normalizeSearchQuery(q) === null) return;
          if (!isFolder) {
            applySearchQuery(q);
            return;
          }
          props.onSearchCleared?.();
          if (row.wasExpanded && tree != null) {
            const item = tree.getItem(row.path);
            if (
              item != null &&
              "isExpanded" in item &&
              "collapse" in item &&
              item.isExpanded()
            ) {
              try {
                item.collapse();
              } catch (e) {
                props.onError(toError(e));
              }
            }
          }
        });
      };
      container.addEventListener("click", handleTreeRowClick, {
        capture: true,
      });
      onCleanup(() =>
        container.removeEventListener("click", handleTreeRowClick, {
          capture: true,
        }),
      );

      // Apply an initial searchQuery if it was already non-empty at mount —
      // the deferred effect below only fires on subsequent changes, so a
      // pre-mount value would otherwise be silently dropped.
      applySearchQuery(untrack(() => props.searchQuery));
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

  createEffect(on(() => props.searchQuery, applySearchQuery, { defer: true }));

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
