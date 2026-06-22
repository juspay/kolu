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
import {
  ancestorDirectoryPaths,
  directoryRemovalOps,
  type FileTreeRemoveOperation,
  pathDiffOperations,
} from "./pathReconcile";

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
  /** A **standing** request to reveal a directory: open it and its ancestors
   *  so the row exists and its children show, then scroll it into view. Unlike
   *  `selectedPath` this changes no selection — it's the terminal folder-link
   *  front door bringing a folder on-screen. The `path` is a trailing-slash
   *  folder key (`packages/client/`). Re-applied at **every mount** (via
   *  `initialExpandedPaths`, like `selectedPath`'s ancestors) and on each
   *  request-object change, so it **survives a tree remount** — the live
   *  `fsListAll` stream resubscribes and briefly empties `paths`, which
   *  unmounts/remounts this tree under load; a consume-once request would be
   *  lost in that window and the folder would come back collapsed. The host
   *  keeps the request alive until the user navigates elsewhere (a file pick or
   *  a view switch) and clears it then, so the reveal is robust without
   *  re-scrolling to a stale folder forever. A fresh object re-reveals the same
   *  folder on a repeat click. Null when no reveal is pending. */
  revealRequest?: { path: string } | null;
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
  /** Extra CSS injected into Pierre's shadow root, for styling Pierre
   *  exposes no `--trees-*` theme variable for — e.g. tinting a directory
   *  that contains a change, which Pierre only renders as a half-opacity dot.
   *  Pierre owns its shadow DOM, so a host stylesheet can't reach inside;
   *  this is the escape hatch. Snapshot at mount via a constructable sheet
   *  appended to the shadow root's `adoptedStyleSheets` (so Pierre's own row
   *  re-renders never wipe it) — **not reactive**, re-mount to change it. The
   *  rule's selectors are Pierre's internal row anatomy, so the rule belongs
   *  to the host theme, not here. */
  shadowCss?: string;
  /** Surface construction or render throws to the host. Required because
   *  silent failure produces a blank pane indistinguishable from "no
   *  files" — bad UX, hard to debug. */
  onError: (err: Error) => void;
  /** Forwarded to the container `<div>`. */
  class?: string;
  /** Forwarded to the container `<div>` — host theming lives here. */
  style?: JSX.CSSProperties;
};

/** Pierre renders its rows under an open shadow root nested somewhere in the
 *  host container. Find the first shadow root in that subtree so the host can
 *  reach Pierre's internal styles. */
function findShadowRoot(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  for (const child of el.children) {
    const found = findShadowRoot(child);
    if (found) return found;
  }
  return null;
}

/** Append `css` to Pierre's shadow root as a constructable stylesheet —
 *  `adoptedStyleSheets` survives Pierre's row re-renders (a `<style>` child
 *  could be cleared by a virtualizer pass) and stacks after Pierre's own
 *  sheet, so the host rule wins on equal specificity. No-op if the shadow
 *  root isn't found (defensive — Pierre always mounts one). */
function injectShadowCss(container: HTMLElement, css: string): void {
  const shadowRoot = findShadowRoot(container);
  if (!shadowRoot) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
}

/** Expand each resolvable directory row named by `keys`, leaving files and
 *  missing paths untouched. `getItem` returns a directory-or-file handle union:
 *  `"expand" in item` is the narrowing — Pierre's `isDirectory()` returns a
 *  `true`/`false` literal but isn't a `this is` predicate, so it can't narrow,
 *  whereas the `in` check both compiles and probes for the exact capability
 *  we're about to call. Re-expanding an open folder is a no-op; a file or a
 *  missing path narrows away and is skipped. The single place this file knows
 *  how to make a row's ancestors visible. */
function expandDirs(tree: FileTreeClass, keys: Iterable<string>): void {
  for (const key of keys) {
    const item = tree.getItem(key);
    if (item && "expand" in item) item.expand();
  }
}

/** Reveal a directory row in a mounted tree: open its ancestors and itself so
 *  the row exists and its children show, then scroll it to centre. A flattened
 *  single-child chain may have no discrete node for `dirKey` (`getItem` returns
 *  null); we then open whatever ancestors do resolve and skip the scroll,
 *  degrading gracefully rather than scrolling to a phantom. */
function revealDirectory(tree: FileTreeClass, dirKey: string): void {
  expandDirs(tree, ancestorDirectoryPaths(dirKey));
  const item = tree.getItem(dirKey);
  if (!item || !("expand" in item)) return;
  item.expand();
  tree.scrollToPath(dirKey, { offset: "center" });
}

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
    // A directory reveal can be standing when this tree mounts — both for a
    // folder clicked from a diff view (mounts us with the request already set)
    // and, crucially, for *every remount* the live fsListAll stream triggers
    // under load (it briefly empties `paths`, unmounting then remounting us).
    // Apply it through the constructor (expand it + its ancestors via
    // `initialExpandedPaths`, the reliable path that mirrors selectedPath's
    // ancestors) rather than a post-render `expand()`, which races Pierre's
    // first paint and dropped the reveal intermittently. Because the host keeps
    // the request standing (clearing it only on a real navigation), this
    // re-application is what makes the reveal survive a remount.
    const reveal = props.revealRequest;
    safeApply(() => {
      // Snapshot read of `props.selectedPath` for `initialExpandedPaths`.
      // The deferred resetPaths effect below reads it reactively for
      // subsequent changes — Pierre doesn't expose a hook to re-feed
      // `initialExpandedPaths` after the constructor, so initial and
      // reactive paths are unavoidably two sites.
      const selectedAncestors = props.selectedPath
        ? ancestorDirectoryPaths(props.selectedPath)
        : [];
      const revealExpanded = reveal
        ? [...ancestorDirectoryPaths(reveal.path), reveal.path]
        : [];
      tree = new FileTreeClass({
        paths: props.paths,
        initialExpansion: props.initialExpansion ?? "closed",
        initialExpandedPaths: [
          ...(props.expandPaths ?? []),
          ...selectedAncestors,
          ...revealExpanded,
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
      // Scroll the revealed folder into view after the selected file (a folder
      // reveal usually carries no selection, so this is normally the only
      // scroll). The folder is already expanded via `initialExpandedPaths`.
      if (reveal) tree.scrollToPath(reveal.path, { offset: "center" });
      appliedPaths = props.paths;
      if (props.shadowCss) injectShadowCss(container, props.shadowCss);
    }, props.onError);
    // Deliberately do NOT clear the request here: it stays standing so this
    // exact application repeats on every remount (the host clears it on a real
    // navigation). That re-application is what keeps the reveal alive across an
    // fsListAll-driven unmount/remount under load.
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
          expandDirs(tree, toOpen);
          // Force the Preact view to reconcile from the controller's *current*
          // model after a content change. Pierre re-renders its view off a
          // `controller.subscribe` callback that SWALLOWS the first emit after
          // every (re)subscribe as an "initial snapshot"; its view re-subscribes
          // whenever its layout deps change (`initialViewportHeight`, …), which
          // the surrounding fs/git churn triggers, so a `batch`'s emit lands in
          // that window and is dropped — the model updates but the row lingers in
          // the DOM (R8's change-pulse delivery hit this; master's value-bearing
          // stream dodged it via a full remount). `render` reconciles into the
          // same wrapper off the live controller state, so the DOM always matches
          // the batch while expansion/selection/scroll (controller-held) survive.
          if (fileOps.length > 0 || dirOps.length > 0) {
            tree.render({ containerWrapper: container });
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
            // hand-expanded siblings.
            if (tree) expandDirs(tree, ancestorDirectoryPaths(path));
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

  // Apply a directory reveal that *changes* after mount (the folder-link front
  // door clicked while already in this view, or a fresh request for the same
  // folder). Deferred — the at-mount and remount cases are handled by `onMount`
  // re-applying the standing request; here the tree is live, so
  // `getItem().expand()` + `scrollToPath` is safe, the same mechanism the
  // post-mount selection effect uses. The request is left standing (not
  // consumed) so `onMount` can replay it across an fsListAll-driven remount.
  createEffect(
    on(
      () => props.revealRequest,
      (req) => {
        if (!req) return;
        safeApply(() => {
          if (!tree) return;
          revealDirectory(tree, req.path);
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
