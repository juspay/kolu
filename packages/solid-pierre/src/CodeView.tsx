/** SolidJS wrapper over `@pierre/diffs`' `CodeView` class — the advanced-mode
 *  viewport that holds one or more file/diff items in a single virtualized
 *  scroll. Replaces the earlier `Virtualizer` + `FileView` + `FileDiff` trio:
 *  advanced mode is unconditional, so the dual-path (vanilla vs virtualized)
 *  forks, the `??=` recreate dance, the rAF scroll-to-line fallback, and the
 *  `setVisibility` upstream-bug patch all disappear.
 *
 *  The wrapper takes typed `items` (Pierre's `CodeViewItem[]`) and forwards
 *  selection through Pierre's item-scoped `CodeViewLineSelection`. One quirk
 *  is internalised: Pierre's `reconcileItems` keeps the previous record when
 *  the item's `version` field is unchanged, so passing a fresh `fileDiff` /
 *  `file` for the same `id` *without* a version bump leaves stale content on
 *  screen. The wrapper diffs incoming items against the previous snapshot by
 *  reference and bumps `version` for the items whose content changed; callers
 *  pass items reactively and never see the field. */

import {
  CodeView as CodeViewClass,
  type CodeViewLineSelection,
  type CodeViewOptions,
} from "@pierre/diffs";
import {
  type Component,
  createEffect,
  onCleanup,
  onSettled,
  untrack,
} from "solid-js";
import type { JSX } from "@solidjs/web";
import type { CodeViewItem } from "./codeViewItem";
import { safeApply } from "./safeApply";
import { getCodeViewWorkerPool, HIGHLIGHTER_CONTRACT } from "./workerPool";

export type CodeViewProps = {
  /** The items to render — files, diffs, or a mix. Pierre virtualizes across
   *  every item in this list inside a single scroll viewport. Pass through
   *  a `createMemo` so a parent re-render doesn't re-publish identical
   *  items (Pierre dedups by reference internally, but the wrapper still
   *  walks the list to compute version bumps). */
  items: readonly CodeViewItem[];
  /** Light vs dark Shiki theme selector. */
  theme: "light" | "dark";
  /** Diff layout. Applied to every diff item in the viewport. Default
   *  `"unified"`. */
  diffStyle?: "unified" | "split";
  /** Pierre's text-overflow strategy: `"scroll"` keeps lines on one row,
   *  `"wrap"` wraps long lines. Distinct from CSS overflow, which lives
   *  on the wrapper's `class`/`style`. Default `"wrap"`. */
  overflow?: "scroll" | "wrap";
  /** Rendered code-row height in pixels. Pierre's virtualizer uses this as
   *  `itemMetrics.lineHeight` to size its scroll scaffold and pick which
   *  rows fall in the render window; it defaults to 20px. If a caller
   *  overrides the *rendered* row height (Kolu sets `--diffs-line-height`
   *  in its diffs style) the metric must match, or the window comes up
   *  short and the last rows are unreachable at the bottom of the scroll
   *  (#1026). Pass the same pixel value used for `--diffs-line-height`.
   *  Omit to keep Pierre's 20px default. */
  lineHeight?: number;
  /** When true, Pierre wires gutter selection. Drive the visible
   *  highlight via `selectedLines` and observe changes via
   *  `onSelectedLinesChange`. Default `false`. */
  enableLineSelection?: boolean;
  /** Push this selection into Pierre's controller. Pierre's
   *  `CodeViewLineSelection` is `{ id, range }` — the `id` must match
   *  one of the items currently in the viewport. */
  selectedLines?: CodeViewLineSelection | null;
  /** Fires when the user completes a selection or deselects. The
   *  selection's `id` identifies which item the range belongs to. */
  onSelectedLinesChange?: (selection: CodeViewLineSelection | null) => void;
  /** Surface construction and render throws. Required because silent
   *  failures here produce a blank pane indistinguishable from "loading". */
  onError: (err: Error) => void;
  /** Forwarded to the host `<div>`, which IS Pierre's scroll container.
   *  Apply `overflow-auto` / sizing here. */
  class?: string;
  style?: JSX.CSSProperties;
  /** Passed through to the host `<div>` so e2e tests can find specific
   *  viewports (e.g. `"pierre-diff-view"`, `"pierre-file-view"`). */
  "data-testid"?: string;
};

type VersionEntry = { ref: unknown; version: number };

/** Pull the content identity out of an item so a live hunk/body swap
 *  bumps `version`. Prefer Pierre's `cacheKey` (what 1.3 uses as the
 *  highlight-target id) over object identity — Pierre fills a missing
 *  key with the filename, so two parses of the same path would otherwise
 *  look unchanged. */
const contentRefOf = (item: CodeViewItem): unknown =>
  item.type === "diff"
    ? (item.fileDiff.cacheKey ?? item.fileDiff)
    : (item.file.cacheKey ?? item.file);

/** Pure transform: stamp each item with a `version` derived from `current`.
 *  An item with no prior entry starts at `1`; an item whose content
 *  reference is unchanged keeps its version; an item whose content has
 *  changed bumps. The returned `next` Map contains only ids in `raw`, so a
 *  caller that swaps it in wholesale also handles eviction.
 *
 *  Decoupling this from the mutation step keeps the version logic testable
 *  and removes the "transform side-effects the closure" interleaving the
 *  earlier inline implementation carried. */
const applyVersions = (
  raw: readonly CodeViewItem[],
  current: ReadonlyMap<string, VersionEntry>,
): { items: CodeViewItem[]; next: Map<string, VersionEntry> } => {
  const next = new Map<string, VersionEntry>();
  const items = raw.map((item): CodeViewItem => {
    const ref = contentRefOf(item);
    const prev = current.get(item.id);
    const version = !prev
      ? 1
      : prev.ref === ref
        ? prev.version
        : prev.version + 1;
    next.set(item.id, { ref, version });
    return { ...item, version };
  });
  return { items, next };
};

/** The id of the rendered item whose root element lies on `ancestors` (a
 *  node and its ancestors, through shadow roots), or `undefined` when none
 *  does. */
export const itemIdOnPath = (
  rendered: readonly { id: string; element: EventTarget }[],
  ancestors: readonly EventTarget[],
): string | undefined =>
  rendered.find((r) => ancestors.includes(r.element))?.id;

/** Every mounted viewport, by its host `<div>`, so `codeViewItemIdAt` can
 *  answer from a bare DOM node. Weak, so an unmounted viewport is never held. */
const mountedViews = new WeakMap<Element, CodeViewClass>();

/** The id of the item a DOM node sits in — the target of a right-click, the
 *  start of a text selection — or `undefined` outside every viewport. A
 *  viewport can hold several items, and Pierre itself names the item only
 *  for its own gutter selection; a host that reacts to any other gesture
 *  asks here which file the gesture landed in. Walks up through Pierre's
 *  shadow roots to the viewport and matches its rendered items. */
export const codeViewItemIdAt = (node: Node): string | undefined => {
  const ancestors: Node[] = [];
  for (
    let cur: Node | null = node;
    cur;
    cur = cur.parentNode ?? (cur instanceof ShadowRoot ? cur.host : null)
  ) {
    ancestors.push(cur);
    const instance = cur instanceof Element ? mountedViews.get(cur) : undefined;
    if (instance) return itemIdOnPath(instance.getRenderedItems(), ancestors);
  }
  return undefined;
};

export const CodeView: Component<CodeViewProps> = (props) => {
  let root!: HTMLDivElement;
  let instance: CodeViewClass | undefined;
  // The two handlers PIERRE holds, mirrored into plain fields by the effect
  // below — the one place they are read reactively.
  //
  // Pierre keeps the selection callback it is constructed with and fires it
  // when the user completes a gutter selection, which is inside its own
  // dispatch — a strict-read window, where reading `props` is a defect. And
  // `props` here is routinely a `merge()` key bag (`BrowseFileView` and
  // `BrowseDiffView` spread `{...koluCodeViewProps()}`), so the read lands on
  // the merge proxy rather than on a plain object. The Pierre-facing closure
  // reads the field instead; the field is kept current by a tracked compute,
  // so a consumer swapping its handler still takes effect with no reconstruct.
  //
  // `onError` rides along: it is the channel every `safeApply` reports
  // through, including the one in `onSettled` that builds the instance, so
  // one mirror serves both and there is a single spelling for "the current
  // handler". The effect is created before the instance is, so it has already
  // run when anything fires.
  //
  // Plain fields rather than memos: nothing else reads these, and the compute
  // below is already the tracking scope a memo would add.
  let emitSelection: ((s: CodeViewLineSelection | null) => void) | undefined;
  let reportError!: (err: Error) => void;
  createEffect(
    () => ({
      onSelected: props.onSelectedLinesChange,
      onError: props.onError,
    }),
    ({ onSelected, onError }) => {
      emitSelection = onSelected;
      reportError = onError;
    },
    { name: "codeView.handlerMirror" },
  );
  // Per-item version state — keyed by `id`. When the same id appears in a
  // new items array with a different content reference, bump its version
  // so Pierre publishes the new content. Without this, the `version`-gated
  // `syncItemRecord` path in CodeView keeps the old record in place even
  // though the item's `fileDiff`/`file` field has changed. Swap-by-replace
  // (rather than per-id mutation) also evicts ids that left the list so
  // the map can't grow unboundedly across long-lived sessions.
  let versions: ReadonlyMap<string, VersionEntry> = new Map();

  const versionedItems = (raw: readonly CodeViewItem[]): CodeViewItem[] => {
    const result = applyVersions(raw, versions);
    versions = result.next;
    return result.items;
  };

  // Bring a programmatically-set selection into view. Pierre's
  // `setSelectedLines` paints the highlight but never scrolls — and with
  // virtualization an off-screen range isn't even in the DOM. A terminal
  // `path:line` click on a line deep in the file would otherwise open the
  // file scrolled to the top with the highlight invisible below the fold.
  // `align: "nearest"` is the no-yank choice for prop-driven updates: it
  // moves the minimum to reveal the range, so the echo of a user's own
  // gutter click (which selects an already-visible line) is a no-op.
  const scrollToSelection = (
    selection: CodeViewLineSelection | null | undefined,
    align: "center" | "nearest",
  ): void => {
    if (!selection) return;
    instance?.scrollTo({
      type: "range",
      id: selection.id,
      range: selection.range,
      align,
    });
  };

  // Read every reactive prop at call time so a later prop change lands on
  // the existing CodeView instance via `setOptions` (theme toggle, etc.)
  // instead of forcing a reconstruct. `lineHeight` (when supplied) feeds
  // Pierre's `itemMetrics.lineHeight` so its virtualizer windows the right
  // number of rows; see the prop doc.
  // Two generics since `@pierre/diffs@1.6`: the line-annotation payload and
  // the editor caret, both `undefined` here (see `codeViewItem`).
  const buildOptions = (): CodeViewOptions<undefined, undefined> => ({
    // Fixed engine + theme policy shared with the worker pool that tokenizes
    // for this view. Not per-view choices — spread from the one named binding
    // (rather than inline literals among the reactive props below) so they
    // cannot drift from the pool's `highlighterOptions`.
    ...HIGHLIGHTER_CONTRACT,
    themeType: props.theme,
    diffStyle: props.diffStyle ?? "unified",
    overflow: props.overflow ?? "wrap",
    lineHoverHighlight: "both",
    enableLineSelection: props.enableLineSelection ?? false,
    // The MIRROR, not `props`: Pierre fires this from its own dispatch, a
    // strict-read window (see the fields above). A fresh closure per call is
    // deliberate — `setOptions` compares option identity, and that comparison
    // is what bumps Pierre's render revision for a reused element.
    onSelectedLinesChange: (s) => emitSelection?.(s),
    ...(props.lineHeight != null
      ? { itemMetrics: { lineHeight: props.lineHeight } }
      : {}),
  });

  onSettled(() => {
    safeApply(() => {
      // The shared worker pool moves syntax tokenization off the UI thread;
      // it is a session-lived singleton, so `cleanUp()` below tears down this
      // CodeView's instances but never the pool.
      instance = new CodeViewClass(buildOptions(), getCodeViewWorkerPool());
      // `setup(root)` ends with an internal `render(true)` against zero
      // items, then `setItems(...)` queues a *separate* render for the
      // next frame. On a slow host that one-frame gap stretches and the
      // e2e text-poll on `pierre-file-view` / `pierre-diff-view` can
      // time out before the content paints. Forcing an immediate render
      // after `setItems` collapses the two-step into one synchronous
      // paint at mount time. Subsequent updates go through the queued
      // path normally.
      instance.setup(root);
      mountedViews.set(root, instance);
      instance.setItems(versionedItems(props.items));
      if (props.selectedLines !== undefined) {
        instance.setSelectedLines(props.selectedLines, { notify: false });
      }
      instance.render(true);
      // An initial selection (e.g. file opened at a terminal `path:line`)
      // centers — there is no prior scroll position to disturb at mount,
      // so the navigation intent reads best with the range centered.
      scrollToSelection(props.selectedLines, "center");
    }, reportError);
  });

  createEffect(
    // The effect phase is a strict-read window, so everything it needs comes
    // from here. `buildOptions()` is read with `untrack`: the items apply must
    // re-run for a NEW `items` only — tracking the option sources here would
    // re-apply the whole item list on a theme toggle (the options effect below
    // already owns that). The error channel is the mirrored field: it is a
    // channel, not a trigger.
    () => ({ items: props.items, options: untrack(buildOptions) }),
    ({ items, options }) => {
      safeApply(() => {
        if (!instance) return;
        instance.setItems(versionedItems(items));
        // Pierre 1.3's FileDiff.render early-returns when layout has
        // already stored the new fileDiff (`fileDiff === this.fileDiff`)
        // and the viewport range is unchanged — so a same-path hunk
        // swap (Code tab live git) never paints. setOptions with a
        // fresh callback identity fails areOptionsEqual and bumps
        // renderOptionsRevision, which is the forceRender the reused
        // element path needs.
        instance.setOptions(options);
      }, reportError);
    },
    { defer: true },
  );

  createEffect(
    // A fresh record per pass, so an identical `selectedLines` reference still
    // re-applies: Pierre owns the painted highlight, and the wrapper's job is
    // to assert the prop over whatever Pierre currently holds.
    () => ({ selected: props.selectedLines }),
    ({ selected }) => {
      safeApply(() => {
        // PROVENANCE, not de-duping: a selection the consumer PUSHED is not a
        // user selection, so it stops here instead of round-tripping back out
        // through `onSelectedLinesChange`. Without the gate Pierre answers
        // this very call synchronously, inside this apply arm, with the range
        // it was handed (`InteractionManager.setSelection` →
        // `notifySelectionCommitted`) — and a consumer that treats that echo
        // as a change is an effect writing its own source. `FileTree` has
        // gated the same way since the tree's 60-120 Hz ping-pong
        // (`FileTree.tsx:251-268`, `:872-890`); this viewer never got it.
        // Pierre's own gutter gestures are unaffected: it reports those from
        // its pointer paths whatever an apply said.
        instance?.setSelectedLines(selected ?? null, { notify: false });
        scrollToSelection(selected, "nearest");
      }, reportError);
    },
    { defer: true },
  );

  // A theme toggle (or any other option flip) lands on the existing
  // instance — no reconstruct needed. `setOptions` rebuilds the per-item
  // option wrappers internally. Tracking `buildOptions` itself (rather
  // than an explicit deps array) means whatever it reads becomes the
  // tracked set automatically — the two cannot drift if a new option
  // is added to `buildOptions` later. Pierre's `setOptions` is
  // idempotent on identical input, so any incidental re-fire is harmless.
  // The selection handler is no longer among what `buildOptions` reads — the
  // closure Pierre holds delegates to the mirror — so this effect tracks the
  // option sources only.
  createEffect(
    buildOptions,
    (opts) => {
      safeApply(() => instance?.setOptions(opts), reportError);
    },
    { defer: true },
  );

  onCleanup(() => {
    mountedViews.delete(root);
    instance?.cleanUp();
  });

  return (
    <div
      ref={root}
      class={props.class}
      style={props.style}
      data-testid={props["data-testid"]}
    />
  );
};

export default CodeView;
