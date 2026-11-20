import {
  CodeView as CodeViewClass,
  type CodeViewLineSelection,
  type CodeViewOptions,
} from "@pierre/diffs";
import {
  type Component,
  createEffect,
  type JSX,
  on,
  onCleanup,
  onMount,
} from "solid-js";
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

const contentRefOf = (item: CodeViewItem): unknown =>
  item.type === "diff"
    ? (item.fileDiff.cacheKey ?? item.fileDiff)
    : (item.file.cacheKey ?? item.file);

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

export const itemIdOnPath = (
  rendered: readonly { id: string; element: EventTarget }[],
  ancestors: readonly EventTarget[],
): string | undefined =>
  rendered.find((r) => ancestors.includes(r.element))?.id;

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
  let versions: ReadonlyMap<string, VersionEntry> = new Map();

  const versionedItems = (raw: readonly CodeViewItem[]): CodeViewItem[] => {
    const result = applyVersions(raw, versions);
    versions = result.next;
    return result.items;
  };

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

  const buildOptions = (): CodeViewOptions<undefined, undefined> => ({
    ...HIGHLIGHTER_CONTRACT,
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
      instance = new CodeViewClass(buildOptions(), getCodeViewWorkerPool());
      instance.setup(root);
      mountedViews.set(root, instance);
      instance.setItems(versionedItems(props.items));
      if (props.selectedLines !== undefined) {
        instance.setSelectedLines(props.selectedLines);
      }
      instance.render(true);
      scrollToSelection(props.selectedLines, "center");
    }, props.onError);
  });

  createEffect(
    on(
      () => props.items,
      (items) =>
        safeApply(() => {
          if (!instance) return;
          instance.setItems(versionedItems(items));
          instance.setOptions(buildOptions());
        }, props.onError),
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

  createEffect(
    on(
      buildOptions,
      (opts) => safeApply(() => instance?.setOptions(opts), props.onError),
      { defer: true },
    ),
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
