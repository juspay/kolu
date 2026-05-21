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
import { toError } from "./toError";

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

export const CodeView: Component<CodeViewProps> = (props) => {
  let root!: HTMLDivElement;
  let instance: CodeViewClass | undefined;
  // Per-item version state — keyed by `id`. When the same id appears in a
  // new items array with a different content reference, bump its version
  // so Pierre publishes the new content. Without this, the `version`-gated
  // `syncItemRecord` path in CodeView keeps the old record in place even
  // though the item's `fileDiff`/`file` field has changed.
  const versions = new Map<string, VersionEntry>();

  const versionedItems = (raw: readonly CodeViewItem[]): CodeViewItem[] => {
    const seen = new Set<string>();
    const next = raw.map((item): CodeViewItem => {
      seen.add(item.id);
      const ref = contentRefOf(item);
      const prev = versions.get(item.id);
      if (!prev) {
        versions.set(item.id, { ref, version: 1 });
        return { ...item, version: 1 };
      }
      if (prev.ref === ref) {
        return { ...item, version: prev.version };
      }
      const bumped = prev.version + 1;
      versions.set(item.id, { ref, version: bumped });
      return { ...item, version: bumped };
    });
    // Drop versions for ids that left the list so the map can't grow
    // unboundedly across long-lived sessions (e.g. flipping through many
    // files in browse mode).
    for (const id of Array.from(versions.keys())) {
      if (!seen.has(id)) versions.delete(id);
    }
    return next;
  };

  // Read every reactive prop at call time so a later prop change lands on
  // the existing CodeView instance via `setOptions` (theme toggle, etc.)
  // instead of forcing a reconstruct.
  const buildOptions = (): CodeViewOptions<undefined> => ({
    theme: DEFAULT_THEMES,
    themeType: props.theme,
    diffStyle: props.diffStyle ?? "unified",
    overflow: props.overflow ?? "wrap",
    lineHoverHighlight: "both",
    enableLineSelection: props.enableLineSelection ?? false,
    onSelectedLinesChange: (s) => props.onSelectedLinesChange?.(s),
  });

  const safeApply = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      props.onError(toError(e));
    }
  };

  onMount(() => {
    safeApply(() => {
      instance = new CodeViewClass(buildOptions());
      instance.setup(root);
      instance.setItems(versionedItems(props.items));
      if (props.selectedLines !== undefined) {
        instance.setSelectedLines(props.selectedLines);
      }
    });
  });

  createEffect(
    on(
      () => props.items,
      (items) => safeApply(() => instance?.setItems(versionedItems(items))),
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.selectedLines,
      (s) => safeApply(() => instance?.setSelectedLines(s ?? null)),
      { defer: true },
    ),
  );

  // A theme toggle (or any other option flip) lands on the existing
  // instance — no reconstruct needed. `setOptions` rebuilds the per-item
  // option wrappers internally.
  createEffect(
    on(
      () => [props.theme, props.diffStyle, props.overflow] as const,
      () => safeApply(() => instance?.setOptions(buildOptions())),
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
