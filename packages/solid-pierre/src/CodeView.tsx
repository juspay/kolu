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
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  DEFAULT_THEMES,
} from "@pierre/diffs";
import {
  type Component,
  createEffect,
  type JSX,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { safeApply } from "./safeApply";

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
   *  (#1021). Pass the same pixel value used for `--diffs-line-height`.
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

/** Pull the content reference out of an item so reference equality
 *  identifies "same content, no bump needed". For files that's the
 *  `FileContents` object; for diffs it's the `FileDiffMetadata`. */
const contentRefOf = (item: CodeViewItem): unknown =>
  item.type === "diff" ? item.fileDiff : item.file;

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

export const CodeView: Component<CodeViewProps> = (props) => {
  let root!: HTMLDivElement;
  let instance: CodeViewClass | undefined;
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
  const buildOptions = (): CodeViewOptions<undefined> => ({
    theme: DEFAULT_THEMES,
    themeType: props.theme,
    diffStyle: props.diffStyle ?? "unified",
    overflow: props.overflow ?? "wrap",
    lineHoverHighlight: "both",
    enableLineSelection: props.enableLineSelection ?? false,
    onSelectedLinesChange: (s) => props.onSelectedLinesChange?.(s),
    ...(props.lineHeight != null
      ? { itemMetrics: { lineHeight: props.lineHeight } }
      : {}),
  });

  onMount(() => {
    safeApply(() => {
      instance = new CodeViewClass(buildOptions());
      // `setup(root)` ends with an internal `render(true)` against zero
      // items, then `setItems(...)` queues a *separate* render for the
      // next frame. On a slow host that one-frame gap stretches and the
      // e2e text-poll on `pierre-file-view` / `pierre-diff-view` can
      // time out before the content paints. Forcing an immediate render
      // after `setItems` collapses the two-step into one synchronous
      // paint at mount time. Subsequent updates go through the queued
      // path normally.
      instance.setup(root);
      instance.setItems(versionedItems(props.items));
      if (props.selectedLines !== undefined) {
        instance.setSelectedLines(props.selectedLines);
      }
      instance.render(true);
      // An initial selection (e.g. file opened at a terminal `path:line`)
      // centers — there is no prior scroll position to disturb at mount,
      // so the navigation intent reads best with the range centered.
      scrollToSelection(props.selectedLines, "center");
    }, props.onError);
  });

  createEffect(
    on(
      () => props.items,
      (items) =>
        safeApply(
          () => instance?.setItems(versionedItems(items)),
          props.onError,
        ),
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.selectedLines,
      (s) =>
        safeApply(() => {
          instance?.setSelectedLines(s ?? null);
          scrollToSelection(s, "nearest");
        }, props.onError),
      { defer: true },
    ),
  );

  // A theme toggle (or any other option flip) lands on the existing
  // instance — no reconstruct needed. `setOptions` rebuilds the per-item
  // option wrappers internally. Tracking `buildOptions` itself (rather
  // than an explicit deps array) means whatever it reads becomes the
  // tracked set automatically — the two cannot drift if a new option
  // is added to `buildOptions` later. Pierre's `setOptions` is
  // idempotent on identical input, so any incidental re-fire is harmless.
  createEffect(
    on(
      buildOptions,
      (opts) => safeApply(() => instance?.setOptions(opts), props.onError),
      { defer: true },
    ),
  );

  onCleanup(() => instance?.cleanUp());

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
