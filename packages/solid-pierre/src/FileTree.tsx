import {
  FileTree as FileTreeClass,
  type FileTreeIconConfig,
  type FileTreeInitialExpansion,
  type GitStatusEntry,
} from "@pierre/trees";
import { createEventListener } from "@solid-primitives/event-listener";
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
import { toError } from "./toError";
import {
  ancestorDirectoryPaths,
  directoryRemovalOps,
  dropRedundantDirKeys,
  type FileTreeRemoveOperation,
  isDirectoryPath,
  pathDiffOperations,
} from "./pathReconcile";

type FileTreeOptions = ConstructorParameters<typeof FileTreeClass>[0];
type Composition = NonNullable<FileTreeOptions["composition"]>;
type FileTreeContextMenu = NonNullable<Composition["contextMenu"]>;

export type FileTreeProps = {
  /** The visible file inventory. A **trailing slash** marks an entry as a
   *  directory row that owns no children (the collapsed gitignored directories
   *  the Code tab overlays: one `node_modules/` row, never its contents).
   *  Pierre infers ordinary directories from path prefixes, so a slash-free
   *  entry is a file — the discriminator `onSelect` filters on, spelled once as
   *  `isDirectoryPath` in `@kolu/solid-pierre/paths`. A changed inventory is
   *  a NEW array (never one mutated in place): the tree answers `paths` and
   *  `expandPaths` by identity, so the same arrays handed again are not a
   *  change and re-open nothing. */
  paths: string[];
  gitStatus?: GitStatusEntry[];
  /** The host-owned selection to reflect in the tree. Writes here are
   *  effectively **one-way**: applied silently (marking `aria-selected`,
   *  scrolling the row into view), and the #1841 provenance gate normally
   *  suppresses their echo so they don't round-trip back through `onSelect`.
   *  The host is the source of this value, so it already knows what it wrote.
   *  (Not an absolute guarantee — see the gate's documented adjacency limit in
   *  the body, where a non-selecting gesture can let a single echo through.) */
  selectedPath?: string | null;
  /** Fires for a selection a real user gesture (click/keydown on the tree)
   *  caused — treat it as "the user picked a file," not a mirror of every
   *  selection. A programmatic write to `selectedPath` is normally suppressed
   *  by the one-shot gesture gate rather than echoed here, with one bounded
   *  exception documented on the gate (a non-selecting gesture can let a single
   *  adjacent echo through — never a loop). */
  onSelect?: (path: string | null) => void;
  /** Enable Pierre's built-in header search affordance. Default `true`.
   *  Set to `false` when the host renders its own search input and
   *  drives the tree by projecting `paths` directly. */
  search?: boolean;
  /** Directories Pierre should open whenever the path projection
   *  resets — forwarded as `initialExpandedPaths` to the constructor
   *  and to each `resetPaths` call. Pierre opens these atomically with
   *  the rebuild; expansion never falls out of sync with a path swap. The one
   *  exception is `lazyDirectories`: a load REPLACES the collapsed key,
   *  destroying the node that carried its expansion, so the wrapper keeps that
   *  one set of keys itself (`openLazyDirs`) and re-opens them after each
   *  rebuild. */
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
  /** Directory rows whose children are deliberately absent from `paths` — the
   *  host loads them on demand. Trailing-slash folder keys, like every other
   *  directory entry here. Pierre gives such a row a working chevron either
   *  way, so without this the user could open a folder onto nothing and the
   *  host would never hear about it (the Code tab's collapsed gitignored
   *  directories, #2091). **Reactive**: the current value is read on each
   *  expansion tick, so a directory revealed by a load becomes watchable
   *  itself. */
  lazyDirectories?: readonly string[];
  /** Fires when one of `lazyDirectories` goes from collapsed to expanded —
   *  the host's cue to fetch that level and fold it into `paths`. Only a
   *  TRANSITION fires, so an already-open row costs nothing, and a re-expand
   *  fires again so reopening a folder refetches it (the only refresh gesture
   *  available for paths nothing watches). Never fires for an ordinary
   *  directory, whose children `paths` already carries.
   *
   *  Return the load's promise to tell the wrapper the OUTCOME: on rejection it
   *  forgets the expansion AND collapses the row, so the next probe reports
   *  afresh and a retry costs one re-expand. Without that a transient read
   *  failure wedges the folder open-and-empty for the rest of the mount,
   *  indistinguishable on screen from a genuinely empty directory.
   *
   *  Only the NEWEST call for a directory owns that outcome. Start a second
   *  load for the same path and the first owns nothing — its rejection neither
   *  forgets nor collapses — so a host that aborts a superseded read (as the
   *  Code tab does) does not shut a folder whose contents are still coming. */
  onExpandLazyDirectory?: (path: string) => void | Promise<void>;
  /** Bump to declare every previously-reported expansion void — the host's
   *  loaded levels no longer describe this tree (a repo / host switch). The
   *  wrapper's record of which lazy directories are open is keyed by
   *  repo-relative path, and those collide across repos (`node_modules/`,
   *  `dist/`), so without this a switch leaves a key recorded, re-opened, and
   *  never re-reported — an open, empty folder with no fetch behind it.
   *
   *  A **changed value** is the signal, compared by `===` like every other
   *  reactive prop here — handing the same epoch again, however many times the
   *  host rebuilds the object carrying it, declares nothing. */
  lazyEpoch?: unknown;
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
   *  that contains a change (which Pierre only renders as a half-opacity dot),
   *  or dimming the Code tab's gitignored rows. Pierre owns its shadow DOM, so
   *  a host stylesheet can't reach inside; this is the ONE escape hatch —
   *  every host-side row decoration composes into this string rather than
   *  earning its own prop. **Reactive**: carried by a single constructable
   *  sheet adopted at mount (so Pierre's own row re-renders never wipe it) and
   *  rewritten in place on change, which touches no Pierre state — expansion,
   *  scroll and the git-change roll-up are undisturbed. The rule's selectors
   *  are Pierre's internal row anatomy, so the rule belongs to the host theme,
   *  not here. */
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

function findShadowRoot(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  for (const child of el.children) {
    const found = findShadowRoot(child);
    if (found) return found;
  }
  return null;
}

function adoptShadowSheet(container: HTMLElement): CSSStyleSheet | null {
  const shadowRoot = findShadowRoot(container);
  if (!shadowRoot) return null;
  const sheet = new CSSStyleSheet();
  shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
  return sheet;
}

function expandDirs(tree: FileTreeClass, keys: Iterable<string>): void {
  for (const key of keys) {
    const item = tree.getItem(key);
    if (item && "expand" in item) item.expand();
  }
}

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
  let hostSheet: CSSStyleSheet | undefined | null;
  let appliedPaths: readonly string[] = [];

  let userGesture = false;

  const openLazyDirs = new Set<string>();

  const newestLoad = new Map<string, object>();

  const propValue = {
    paths: createMemo(() => props.paths),
    expandPaths: createMemo(() => props.expandPaths),
    gitStatus: createMemo(() => props.gitStatus),
    selectedPath: createMemo(() => props.selectedPath ?? null),
    revealRequest: createMemo(() => props.revealRequest),
    lazyDirectories: createMemo(() => props.lazyDirectories),
    shadowCss: createMemo(() => props.shadowCss),
    lazyEpoch: createMemo(() => props.lazyEpoch),
  };

  const fileSet = createMemo(() => {
    const files = new Set<string>();
    for (const p of propValue.paths()) if (!isDirectoryPath(p)) files.add(p);
    return files;
  });

  let rebuilding = false;

  const reportLazyExpansions = (): void => {
    const t = tree;
    if (!t || rebuilding) return;
    for (const key of propValue.lazyDirectories() ?? []) {
      const item = t.getItem(key);
      if (!item || !("isExpanded" in item)) continue;
      if (!item.isExpanded()) {
        openLazyDirs.delete(key);
        continue;
      }
      if (openLazyDirs.has(key)) continue;
      openLazyDirs.add(key);
      const token = {};
      newestLoad.set(key, token);
      void Promise.resolve(props.onExpandLazyDirectory?.(key)).then(
        () => {
          if (newestLoad.get(key) === token) newestLoad.delete(key);
        },
        () => {
          if (newestLoad.get(key) !== token) return;
          newestLoad.delete(key);
          openLazyDirs.delete(key);
          safeApply(() => {
            const row = t.getItem(key);
            if (row && "collapse" in row) row.collapse();
          }, props.onError);
        },
      );
    }
  };

  const desiredExpandedPaths = (): string[] => [
    ...(props.expandPaths ?? []),
    ...(props.selectedPath ? ancestorDirectoryPaths(props.selectedPath) : []),
    ...(props.revealRequest
      ? [
          ...ancestorDirectoryPaths(props.revealRequest.path),
          props.revealRequest.path,
        ]
      : []),
    ...openLazyDirs,
  ];

  onMount(() => {
    const armGesture = () => {
      userGesture = true;
      requestAnimationFrame(() => {
        userGesture = false;
      });
    };
    createEventListener(container, ["click", "keydown"], armGesture, {
      capture: true,
    });

    const reveal = props.revealRequest;
    safeApply(() => {
      tree = new FileTreeClass({
        paths: props.paths,
        initialExpansion: props.initialExpansion ?? "closed",
        initialExpandedPaths: desiredExpandedPaths(),
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
          if (!userGesture) return;
          userGesture = false;
          const p = paths[0] ?? null;
          if (p !== null && !fileSet().has(p)) return;
          props.onSelect?.(p);
        },
      });
      tree.render({ containerWrapper: container });
      if (props.selectedPath) tree.scrollToPath(props.selectedPath);
      if (reveal) tree.scrollToPath(reveal.path, { offset: "center" });
      appliedPaths = dropRedundantDirKeys(props.paths);
      // Adopted empty; the (non-deferred) shadow-CSS effect below runs right
      // after this one in creation order and is what writes the content — one
      // call site for the rule, so the mount case can't drift from the change
      // case.
      hostSheet = adoptShadowSheet(container);
      onCleanup(
        tree.subscribe(() => safeApply(reportLazyExpansions, props.onError)),
      );
      reportLazyExpansions();
    }, props.onError);
    // Deliberately do NOT clear the request here: it stays standing so this
    // exact application repeats on every remount (the host clears it on a real
    // navigation). That re-application is what keeps the reveal alive across an
    // fsListAll-driven unmount/remount under load.
  });

  createEffect(
    on(
      [propValue.paths, propValue.expandPaths],
      ([paths]) => {
        const t = tree;
        if (!t) return;
        const toOpen = desiredExpandedPaths();
        const prev = dropRedundantDirKeys(appliedPaths);
        const next = dropRedundantDirKeys(paths);
        rebuilding = true;
        try {
          const pathOps = pathDiffOperations(prev, next).filter((op) => {
            if (
              op.type === "add" &&
              isDirectoryPath(op.path) &&
              t.getItem(op.path)
            ) {
              return false;
            }
            return true;
          });
          if (pathOps.length > 0) t.batch(pathOps);
          const dirOps: FileTreeRemoveOperation[] = [];
          for (const op of directoryRemovalOps(prev, next)) {
            if (t.getItem(op.path)) dirOps.push(op);
          }
          if (dirOps.length > 0) t.batch(dirOps);
          appliedPaths = next;
          expandDirs(t, toOpen);
        } catch (err) {
          try {
            t.resetPaths(next, { initialExpandedPaths: toOpen });
            appliedPaths = next;
            expandDirs(t, toOpen);
            console.error(
              "FileTree paths batch failed; recovered via resetPaths:",
              err,
            );
            return;
          } catch (recoverErr) {
            const recovered = toError(recoverErr);
            props.onError(
              recovered.cause == null
                ? new Error(recovered.message, { cause: err })
                : recovered,
            );
            return;
          }
        } finally {
          rebuilding = false;
          safeApply(reportLazyExpansions, props.onError);
        }
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      propValue.lazyDirectories,
      (lazy) => {
        const declared = new Set(lazy ?? []);
        for (const key of openLazyDirs) {
          if (!declared.has(key)) openLazyDirs.delete(key);
        }
        safeApply(reportLazyExpansions, props.onError);
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      propValue.lazyEpoch,
      () => {
        openLazyDirs.clear();
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      propValue.gitStatus,
      (g) => {
        safeApply(() => tree?.setGitStatus(g), props.onError);
      },
      { defer: true },
    ),
  );

  // The host's CSS is pure styling — rewriting the one adopted sheet touches no
  // Pierre state, so a change never disturbs expansion, scroll, or the
  // git-change roll-up. NOT deferred: this effect is created after `onMount`
  // above, so Solid runs it later in the same flush, with the sheet already
  // adopted — its first run IS the mount-time application, and there is no
  // second call site to keep in sync.
  createEffect(
    on(propValue.shadowCss, (css) => {
      safeApply(() => hostSheet?.replaceSync(css ?? ""), props.onError);
    }),
  );

  createEffect(
    on(
      [propValue.selectedPath, propValue.paths],
      ([path]) => {
        safeApply(() => {
          const current = tree?.getSelectedPaths()[0] ?? null;
          if (current === path) return;
          const deselectOthers = (keep: string | null) => {
            for (const p of tree?.getSelectedPaths() ?? []) {
              if (p !== keep) tree?.getItem(p)?.deselect();
            }
          };
          deselectOthers(path);
          if (path !== null) {
            if (tree) expandDirs(tree, ancestorDirectoryPaths(path));
            tree?.getItem(path)?.select();
            tree?.scrollToPath(path);
          }
        }, props.onError);
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      propValue.revealRequest,
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
