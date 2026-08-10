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
   *  `isDirectoryPath` in `@kolu/solid-pierre/paths`. */
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
   *  Return the load's promise to tell the wrapper the OUTCOME — and the outcome
   *  is TOTAL, three states with three spellings, because the third one caused a
   *  production bug in every host that had to re-invent it:
   *
   *    - **resolve** — the level landed and is folded into `paths`.
   *    - **reject** — the load FAILED; the wrapper forgets the expansion AND
   *      collapses the row, so the next probe reports afresh and a retry costs
   *      one re-expand. Without that a transient read failure wedges the folder
   *      open-and-empty for the rest of the mount, indistinguishable on screen
   *      from a genuinely empty directory.
   *    - **`signal` aborted** — the load was SUPERSEDED (the same key was
   *      re-reported, the row collapsed, the key left `lazyDirectories`, or
   *      `lazyEpoch` bumped). Supersession is NOT a verdict: the wrapper
   *      ignores whatever the promise does next and never collapses the row for
   *      it. Hosts must NOT hand-roll this — a host that rejected on its own
   *      cancellation had `<FileTree>` read supersession as failure and shut the
   *      folder the user had just opened (#2138). Wire the signal into the read
   *      (an `AbortController`, an interrupted fiber) and let it reject freely. */
  onExpandLazyDirectory?: (
    path: string,
    signal: AbortSignal,
  ) => void | Promise<void>;
  /** Fires when a reported lazy directory stops being open — the row went
   *  expanded → collapsed, or the key left `lazyDirectories` (its directory
   *  left the listing, the host stopped declaring it). Either way it is the
   *  host's cue to RETIRE whatever it spun up for that level: a watch, a
   *  standing subscription, a cached level.
   *
   *  Without this edge the contract named only `open`, so a host's registry was
   *  monotone for the lifetime of a mount — browsing `~` and collapsing every
   *  folder left one server-side handle and one stream subscription per folder
   *  the user had EVER opened, which is a different and unbounded promise from
   *  the "N expanded folders cost N handles" the design is sold on. */
  onCollapseLazyDirectory?: (path: string) => void;
  /** Bump to declare every previously-reported expansion void — the host's
   *  loaded levels no longer describe this tree (a repo / host switch). The
   *  wrapper's record of which lazy directories are open is keyed by
   *  repo-relative path, and those collide across repos (`node_modules/`,
   *  `dist/`), so without this a switch leaves a key recorded, re-opened, and
   *  never re-reported — an open, empty folder with no fetch behind it. */
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

/** Adopt ONE constructable stylesheet into Pierre's shadow root and hand it
 *  back so the host's CSS can be rewritten in place (`replaceSync`) as it
 *  changes. `adoptedStyleSheets` survives Pierre's row re-renders (a `<style>`
 *  child could be cleared by a virtualizer pass) and stacks after Pierre's own
 *  sheet, so the host rule wins on equal specificity. ONE sheet per mount —
 *  adopting a fresh one per change would stack sheets and leak. No-op if the
 *  shadow root isn't found (defensive — Pierre always mounts one). */
function adoptShadowSheet(container: HTMLElement): CSSStyleSheet | null {
  const shadowRoot = findShadowRoot(container);
  if (!shadowRoot) return null;
  const sheet = new CSSStyleSheet();
  shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
  return sheet;
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
  // The one adopted sheet carrying the host's CSS, rewritten in place whenever
  // `shadowCss` changes. Dies with the shadow root on cleanup.
  let hostSheet: CSSStyleSheet | undefined | null;
  // The last normalized inventory Pierre was left matching (`dropRedundantDirKeys`
  // of the host paths, after a successful apply or recover). Seeded at mount
  // and updated only when Pierre is left matching this list — so the next path
  // change can be applied as an in-place delta against a known-good prev.
  // Tracked here rather than via `on`'s `prevInput` because that arg is
  // `undefined` on the first post-`defer` run — which would drop the very
  // first delta's removals.
  let appliedPaths: readonly string[] = [];

  // Provenance gate for `onSelectionChange` (juspay/kolu#1841). Pierre is a
  // CONTROLLED component: the host drives its selection via `props.selectedPath`
  // (the effect below calls `getItem(path).select()`), and Pierre calls
  // `onSelectionChange` back. The catch is Pierre fires that callback for BOTH a
  // real user click AND its own programmatic re-selection — so during agent
  // activity, when Pierre re-emits selection on its own (an autonomous echo, no
  // user input), forwarding it to the host closes a feedback loop: host writes
  // the echoed path → the selection effect re-applies it into Pierre → Pierre
  // re-emits → host writes again. The selection ping-pongs between two adjacent
  // files at ~60-120Hz until the terminal is switched (verified from a live
  // `setSelectedFile` stack capture during the loop: every write was
  // `onSelectionChange → onSelect`, never a click handler). Cutting the loop needs
  // PROVENANCE — forward only a selection a genuine USER GESTURE caused. So
  // `userGesture` is armed for exactly one emit by a real pointer/keyboard event
  // on the tree (capture phase, so it is set before Pierre's row handler runs) and
  // is consumed by the first emit that follows; a safety disarm on the next
  // animation frame clears it if a click selects an already-selected row (no
  // emit), so no stale token survives for a later echo to consume.
  //
  // Known limitation: the token authorizes by interaction-*adjacency*, not
  // selection-*causation*. It records only THAT a user touched the tree, not
  // WHICH selection they meant. An interaction that arms the token but emits no
  // selection of its own to consume it — a dead-space/scrollbar click, a
  // non-selecting keydown, or (only when `search` is true) a Pierre search-box
  // keystroke — can, during agent churn, leave the token armed for the *next
  // autonomous echo*, which is then forwarded to the host as ONE adjacent file
  // the user never picked. A file OR folder click is NOT such a leak: it emits
  // its own path and self-consumes the token at the `userGesture = false` line
  // below before the fileSet filter runs, so it can't leak into a later echo.
  // Single-use consumption bounds the leak to a single self-correcting jump —
  // never a loop. Adjacency is chosen over the causal alternative (suppress
  // echoes around the wrapper's OWN `batch()`/`select()`/`deselect()` writes)
  // deliberately, NOT for lack of a second consumer: the causal flag would be an
  // in-place change here, but it must survive Pierre's deferred-microtask emit
  // the same way this gesture window does AND would misclassify the hard case a
  // gesture token gets right — a genuine user click that interleaves with one of
  // the wrapper's own deferred writes during churn. Separately, lifting this
  // token into a shared provenance primitive is deferred to population-two
  // (prove-then-extract, dovetailing with the solidjs.md graduation candidate) —
  // that deferral is about extraction, not about the adjacency-vs-causal choice.
  let userGesture = false;

  // Which watched directories are currently open, so only a genuine
  // collapsed → expanded TRANSITION reaches the host. Pierre exposes no
  // expansion callback and maps expand/collapse to no mutation event (they are
  // `FileTreeStoreIgnoredSemanticEvent`s, which `toTreesMutationEvent` drops),
  // so the transition is read off its store subscription — which fires for a
  // programmatic `expand()` and for a real row click alike.
  //
  // Pierre's own path-store already implements this feature one layer down —
  // `markDirectoryUnloaded` / `beginChildLoad` / `applyChildPatch` /
  // `completeChildLoad`, and `dist/model/mutationEvents.d.ts` even PUBLISHES
  // the matching `'begin-child-load' | 'apply-child-patch' | …` event names.
  // But at `@pierre/trees@1.0.0-beta.6` the methods that drive them appear in
  // no `.d.ts` and on no public class (the render `FileTree` exposes only
  // `subscribe`), so the vocabulary is public while the driver is not. Reaching
  // into `path-store/src/store.js` to get at it would bind us to unversioned
  // internals. Re-check on the next Pierre bump: if those methods graduate to
  // the public surface, this Set, `reportLazyExpansions`, and the two props
  // below all delete in favour of the native API.
  const openLazyDirs = new Set<string>();

  // The in-flight load per open lazy directory, so SUPERSESSION lives here —
  // with the record it is superseding — instead of being re-derived by every
  // host. Aborted when the key is re-reported, collapses, leaves
  // `lazyDirectories`, when the epoch bumps, or on dispose; an aborted load's
  // outcome is then ignored (see `onExpandLazyDirectory`'s three states).
  const lazyLoads = new Map<string, AbortController>();
  const abortLazyLoad = (key: string): void => {
    const ctl = lazyLoads.get(key);
    if (!ctl) return;
    lazyLoads.delete(key);
    ctl.abort();
  };

  // While the wrapper is APPLYING ITS OWN WRITES — reconciling a path change and
  // re-opening the lazy directories it knows are meant to be open, revealing a
  // selected file's ancestors, applying a reveal request — the store ticks it
  // causes describe construction states, not user intent. Without this guard a
  // probe fired by the batch's own tick saw the recreated folder COLLAPSED
  // (the remove destroyed the node carrying the expansion, the add rebuilt it
  // closed) while still recorded, retired the record, then mistook the
  // effect's own re-expand for a fresh user expansion and re-fired the load —
  // whose superseding abort of its predecessor then collapsed the row for
  // good (#2138's plain-directory e2e: load resolves OK, folder ends shut).
  //
  // ONE flag around EVERY wrapper-initiated expansion, not just the paths
  // effect: the selection effect and `revealDirectory` expand rows too, and a
  // rule enforced at one of three mutation sites is a rule that rots. Each site
  // runs inside `withOwnWrites`, which drops the flag and then fires ONE
  // deliberate probe — so a row left genuinely open-and-childless by the write
  // still reports, which is how a revealed lazy folder gets its level.
  let applyingOwnWrites = false;
  const withOwnWrites = (fn: () => void): void => {
    applyingOwnWrites = true;
    try {
      fn();
    } finally {
      applyingOwnWrites = false;
      safeApply(reportLazyExpansions, props.onError);
    }
  };

  // Pierre fires `onSelectionChange` for directory clicks too, which would
  // produce an EISDIR if the consumer reads the path as a file. Directories
  // mostly don't appear in `paths` (Pierre infers them from path prefixes) —
  // but a host MAY pass explicit trailing-slash directory entries (the Code
  // tab's collapsed gitignored dirs, `node_modules/`), and Pierre reports a
  // click on such a row with the slash intact. Exclude them so membership
  // stays a reliable file-vs-folder discriminator.
  // Built in one pass, no intermediate array: this recomputes on every `paths`
  // change (each search keystroke, each file add/remove) but is read only
  // inside `onSelectionChange`, i.e. on a click.
  const fileSet = createMemo(() => {
    const files = new Set<string>();
    for (const p of props.paths) if (!isDirectoryPath(p)) files.add(p);
    return files;
  });

  /** Probe the host's watched directories and report any that just opened.
   *
   *  Only the declared keys are probed — a handful of collapsed gitignored
   *  directories — never the whole visible projection, which matters because
   *  the store subscription this rides also fires for selection, focus and
   *  every path mutation. Scanning `getVisibleRows` here would put a
   *  whole-tree walk on that path for a fact about a few rows.
   *
   *  Reporting is edge-triggered against `openLazyDirs`, so the host's own
   *  answer — folding the fetched level into `paths`, which ticks the store
   *  again — cannot re-enter: the directory is still open and still recorded,
   *  so the next probe stays silent. */
  const reportLazyExpansions = (): void => {
    const t = tree;
    if (!t) return;
    if (applyingOwnWrites) return; // our own writes are not user intent
    for (const key of props.lazyDirectories ?? []) {
      const item = t.getItem(key);
      // No row for this key right now — a search projection hid it (the host
      // filters `paths` but not `lazyDirectories`), or it has yet to render.
      // A row that does not exist holds no expansion state to read, and that is
      // NOT the user closing the folder: the recorded intent survives, and only
      // an EXISTING, collapsed row retires it. Erasing it here made a single
      // filter keystroke wipe the user's expansion for the rest of the mount.
      if (!item || !("isExpanded" in item)) continue;
      if (!item.isExpanded()) {
        // The CLOSE edge — reported, not swallowed, so the host can retire the
        // level's watch/subscription. Guarded on the record so only a genuine
        // open → closed transition fires it.
        if (openLazyDirs.delete(key)) retireLazyDir(key);
        continue;
      }
      if (openLazyDirs.has(key)) continue;
      openLazyDirs.add(key);
      // This key's own supersession token. Aborting any predecessor first keeps
      // ONE writer per key: a rapid collapse → expand → collapse cannot leave
      // two loads racing to answer for one row.
      abortLazyLoad(key);
      const ctl = new AbortController();
      lazyLoads.set(key, ctl);
      // A rejected load must not leave an open, empty folder on screen: the
      // ROW's own expansion state (`item.isExpanded()`) is untouched by a load
      // failure, so merely forgetting the key here — without also collapsing
      // the row — left the two out of sync. The very next probe, fired by ANY
      // unrelated store tick (a click elsewhere, an unconnected path
      // mutation), then read "expanded, not recorded" and mistook it for a
      // fresh user expansion, re-firing the same failing load forever. Calling
      // `collapse()` closes the row so its visible state agrees with the
      // bookkeeping — the user sees the folder shut instead of a silent retry
      // storm, and a deliberate re-open is what re-arms the probe.
      void Promise.resolve(props.onExpandLazyDirectory?.(key, ctl.signal))
        .then(() => {
          if (lazyLoads.get(key) === ctl) lazyLoads.delete(key);
        })
        .catch(() => {
          // Supersession is not a verdict — the aborter owns the row's fate, so
          // an aborted load neither retires the record nor shuts the row. ONE
          // spelling of that rule, here, where the record lives: every host
          // that had to invent its own got it different (#2138).
          if (ctl.signal.aborted) return;
          if (lazyLoads.get(key) === ctl) lazyLoads.delete(key);
          openLazyDirs.delete(key);
          safeApply(() => {
            const row = t.getItem(key);
            if (row && "collapse" in row) row.collapse();
          }, props.onError);
        });
    }
  };

  /** This level is no longer open: drop the wrapper's record's in-flight load
   *  and tell the host to retire whatever it spun up. */
  const retireLazyDir = (key: string): void => {
    abortLazyLoad(key);
    safeApply(() => props.onCollapseLazyDirectory?.(key), props.onError);
  };

  /** Every key that should be open, from every source that has an opinion — the
   *  search projection, the selected file's ancestors, a standing reveal, and
   *  the lazy directories the user opened by hand. Spelled ONCE so the
   *  constructor and the post-mount rebuild cannot disagree about the set;
   *  whoever adds a fifth source adds it here and both sites get it. Read
   *  untracked at both call sites (inside `onMount`, and inside an `on`
   *  callback, which Solid untracks). */
  const desiredExpandedPaths = (): string[] => [
    ...(props.expandPaths ?? []),
    ...(props.selectedPath ? ancestorDirectoryPaths(props.selectedPath) : []),
    ...(props.revealRequest
      ? [
          ...ancestorDirectoryPaths(props.revealRequest.path),
          props.revealRequest.path,
        ]
      : []),
    // Re-open the lazy directories the user has open. Loading a level REPLACES
    // the collapsed key with its children, and Pierre's remove destroys that
    // directory node — the one carrying the expansion — so the node rebuilt
    // from the children arrives closed. Without this the folder would snap shut
    // at the exact moment its contents arrived, which reads as the click having
    // done nothing. Re-expanding is also what keeps the reporting
    // edge-triggered: the directory stays open and stays recorded, so the load
    // cannot re-enter as a fresh expansion.
    ...openLazyDirs,
  ];

  onMount(() => {
    // Arm the provenance gate on real user input. Capture phase so it is set
    // before Pierre's own row `click`/`keydown` handler runs; the events are
    // `composed`, so they cross Pierre's shadow root to this host container.
    // `click` (not `pointerdown`) matches the event Pierre selects on and also
    // covers touch taps.
    //
    // Disarm on the NEXT ANIMATION FRAME, not a microtask. Pierre's emit timing
    // is ENVIRONMENT-DEPENDENT: driven directly (a synchronous `dispatchEvent`
    // in a happy-dom unit test), `onSelectionChange` fires synchronously inside
    // the click dispatch (its `#emit` is a plain synchronous `for` loop). But in
    // the REAL app — Preact rendering Pierre into a shadow root, a real browser
    // click — it lands DEFERRED, after this handler's own microtask (measured on
    // the live running app: the emit fires before the next frame but after
    // `queueMicrotask`). We know the deferred case is the one that ships because
    // a `queueMicrotask` disarm shipped in #1846 and dropped EVERY genuine click
    // in production (it ran before the deferred emit) — reverted before merge.
    // `requestAnimationFrame` is the disarm that survives BOTH timings (it clears
    // after either emit but before the next frame), whereas `queueMicrotask`
    // survives only the synchronous case. Single-use consumption in
    // `onSelectionChange` still kills the echo loop after one forward, so the
    // wider window costs nothing beyond the documented one-adjacent-echo leak.
    // `createEventListener` disposes both listeners on this owner's cleanup.
    const armGesture = () => {
      userGesture = true;
      requestAnimationFrame(() => {
        userGesture = false;
      });
    };
    createEventListener(container, ["click", "keydown"], armGesture, {
      capture: true,
    });

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
      // Snapshot read for `initialExpandedPaths`. The deferred resetPaths
      // effect below reads the same rule reactively for subsequent changes —
      // Pierre doesn't expose a hook to re-feed `initialExpandedPaths` after
      // the constructor, so initial and reactive paths are unavoidably two call
      // sites; `desiredExpandedPaths` is why they can't be two RULES.
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
          // Only a user-gesture-originated selection reaches the host; an
          // autonomous re-emit during churn is dropped, so it can't drive the
          // store↔Pierre loop (#1841). The gesture arms this for one emit.
          if (!userGesture) return;
          userGesture = false;
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
      appliedPaths = dropRedundantDirKeys(props.paths);
      // Adopted empty; the (non-deferred) shadow-CSS effect below runs right
      // after this one in creation order and is what writes the content — one
      // call site for the rule, so the mount case can't drift from the change
      // case.
      hostSheet = adoptShadowSheet(container);
      // Watch for lazy-directory expansions, then probe once by hand.
      // Pierre's `subscribe` does NOT replay at registration (measured), so a
      // row that mounts ALREADY open — `initialExpansion: "open"`, or an
      // `initialExpandedPaths` reveal replayed across one of the remounts the
      // live path stream causes — would sit there open and childless with no
      // tick ever coming. The explicit call covers it, and reports the same
      // fact an expansion does: an open, empty folder in front of the user.
      // Guarded like every other entry into wrapper code: a throw here — from
      // `getItem`, or from the host's `onExpandLazyDirectory` — would otherwise
      // escape into Pierre's own emit loop, taking every other subscriber of
      // that store tick with it and never reaching `props.onError`.
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
  // On a throw: Pierre's `batch` has no rollback, so partial ops can leave
  // the store half-applied while `appliedPaths` still names the old inventory
  // — every later change re-diffs against that stale bookkeeping and freezes
  // the tree forever (the Code-tab host-switch toast). Recover by rebuilding
  // via `resetPaths` to the normalized desired inventory and recording it.
  // onError fires only when recovery itself fails (successful recover must
  // not toast "render failed"); the original throw is logged for visibility.
  //
  // `selectedPath` is deliberately *not* a dependency — routing selection
  // through here would re-run on every file click. The selection effect
  // below reveals the picked row imperatively instead; we read `selectedPath`
  // untracked only so a genuine paths/expandPaths change reveals the current
  // selection.
  createEffect(
    on(
      [() => props.paths, () => props.expandPaths],
      ([paths]) => {
        // Capture once so closures (pathOps filter) keep a narrowed FileTree
        // handle — mutable `let tree` does not flow into arrow callbacks.
        const t = tree;
        if (!t) return;
        const toOpen = desiredExpandedPaths();
        // Normalize both sides so a collapsed dir key never coexists with
        // inventory children — pathDiff can then always recursive-remove
        // orphaned directory keys without a skip branch. Shared by the happy
        // path and the recovery rebuild so mixed keys never re-enter Pierre.
        const prev = dropRedundantDirKeys(appliedPaths);
        const next = dropRedundantDirKeys(paths);
        // Hold expansion probes for the whole reconcile (batch + reopen), then
        // probe once deliberately — see `withOwnWrites`'s note. It covers every
        // exit, including the recovery branch's returns.
        withOwnWrites(() => {
          try {
            const pathOps = pathDiffOperations(prev, next).filter((op) => {
              // Pierre promotes an emptied directory to an explicit empty-folder
              // node on file remove — so files→collapsed-dir can try to `add` a
              // dir key that already exists. Skip those adds (mirrors getItem
              // guard on dirOps).
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
              // Recovered — tree matches desired inventory. Log the original
              // throw so recurrence is visible; do not toast as render failure.
              console.error(
                "FileTree paths batch failed; recovered via resetPaths:",
                err,
              );
            } catch (recoverErr) {
              // Recovery failed — bookkeeping may still be desynced; surface
              // loudly and leave appliedPaths so a later inventory can retry.
              const recovered = toError(recoverErr);
              props.onError(
                recovered.cause == null
                  ? new Error(recovered.message, { cause: err })
                  : recovered,
              );
            }
          }
        });
      },
      { defer: true },
    ),
  );

  // A directory can become watchable AFTER the row is already on screen and
  // open — the overlay listing that names it lands a tick later than the tree,
  // and a load reveals nested directories that are lazy in their own turn.
  // Pierre's store does not tick for a change to a host prop, so the
  // subscription alone would never probe those keys; re-probe when the watched
  // set itself changes.
  createEffect(
    on(
      () => props.lazyDirectories,
      (lazy) => {
        // A key the host no longer calls lazy — the overlay toggled off, the
        // directory left the listing — is no longer ours to hold open or to
        // dedupe against. Retiring it is what makes its next appearance report
        // AFRESH: without this an eye-toggle round trip showed an arbitrarily
        // old cached level with the documented collapse-and-reopen refresh
        // unavailable, because the probe saw the key already recorded. The host
        // hears the same close edge a collapse gives it, because it means the
        // same thing: this level is no longer open, retire what feeds it (a
        // query left polling a directory that has left the listing is exactly
        // the leak the close edge exists to close).
        const declared = new Set(lazy ?? []);
        for (const key of openLazyDirs) {
          if (!declared.has(key)) {
            openLazyDirs.delete(key);
            retireLazyDir(key);
          }
        }
        safeApply(reportLazyExpansions, props.onError);
      },
      { defer: true },
    ),
  );

  // The host's loaded levels no longer describe this tree (a repo / host
  // switch). Repo-relative keys collide across repos, so a key open in BOTH
  // would otherwise stay recorded, be force-opened by the paths effect, and
  // report nothing — an open, empty folder with no fetch behind it, which is
  // the #2091 symptom returning. This is the wrapper's half of the same
  // invalidation the host performs on its children cache.
  createEffect(
    on(
      () => props.lazyEpoch,
      () => {
        // No close edge for these: the epoch says the host has ALREADY declared
        // its whole loaded world void (it is the same signal that clears it), so
        // there is nothing left to retire — only the in-flight loads, whose
        // answers now belong to a tree that no longer exists.
        for (const key of [...lazyLoads.keys()]) abortLazyLoad(key);
        openLazyDirs.clear();
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

  // The host's CSS is pure styling — rewriting the one adopted sheet touches no
  // Pierre state, so a change never disturbs expansion, scroll, or the
  // git-change roll-up. NOT deferred: this effect is created after `onMount`
  // above, so Solid runs it later in the same flush, with the sheet already
  // adopted — its first run IS the mount-time application, and there is no
  // second call site to keep in sync.
  createEffect(
    on(
      () => props.shadowCss,
      (css) => {
        safeApply(() => hostSheet?.replaceSync(css ?? ""), props.onError);
      },
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
  // canonical case. `onSelectionChange` re-fires when we call `select()`,
  // but the provenance gate drops that emit (no user gesture is armed), so
  // it never reaches the host — the programmatic echo stops here rather than
  // round-tripping through `onSelect`.
  createEffect(
    on(
      () => props.selectedPath ?? null,
      (path) => {
        // Inside `withOwnWrites`: the `expandDirs` below is the wrapper's own
        // expansion, not user intent, and the deliberate post-probe it fires is
        // what reports a LAZY ancestor this reveal left open-and-childless.
        withOwnWrites(() =>
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
          }, props.onError),
        );
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
        // Also a wrapper-initiated expansion (see the selection effect): the
        // reveal opens the folder and its ancestors, and only the deliberate
        // post-probe should read the result as "this lazy folder is open now".
        withOwnWrites(() =>
          safeApply(() => {
            if (!tree) return;
            revealDirectory(tree, req.path);
          }, props.onError),
        );
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    // Every in-flight load is superseded by the tree ceasing to exist — abort
    // so a late rejection can't try to collapse a row in a torn-down Pierre.
    for (const key of [...lazyLoads.keys()]) abortLazyLoad(key);
    // Fire the close edge for every still-open lazy directory: this wrapper
    // instance is the only holder of `openLazyDirs`, so an unmount without
    // this would strand the host's per-level machinery (watches, cached
    // levels) registered against expansions no surviving tree remembers — a
    // remounted tree starts collapsed and re-reports afresh. Same total-
    // contract reasoning as the declared-set removal loop above.
    for (const key of [...openLazyDirs]) {
      openLazyDirs.delete(key);
      retireLazyDir(key);
    }
    tree?.cleanUp();
  });

  return (
    <div
      ref={container}
      class={props.class}
      style={props.style}
      data-testid="pierre-file-tree"
    />
  );
};
