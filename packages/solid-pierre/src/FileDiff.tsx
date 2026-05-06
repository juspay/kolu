/** SolidJS wrapper over `@pierre/diffs`' vanilla `FileDiff` class — or
 *  `VirtualizedFileDiff` when wrapped in `<Virtualizer>`.
 *
 *  Pierre parses raw unified diffs via `parsePatchFiles`. A single diff
 *  can contain multiple files; this wrapper picks the first one (kolu's
 *  callers slice per-file before passing in). Pierre throws on malformed
 *  headers and the imperative `render()` can also throw — both routes
 *  are caught and surfaced via the required `onError` prop.
 *
 *  Virtualization is controlled by the enclosing `<Virtualizer>` (via
 *  Solid context). When present, `VirtualizedFileDiff` renders only the
 *  hunks intersecting the viewport — the path that closes Phase 8 of
 *  #514 for 50k-line lockfile diffs. With no enclosing `<Virtualizer>`,
 *  the wrapper uses the plain `FileDiff` class — same behavior as
 *  before. */

import {
  DEFAULT_THEMES,
  FileDiff as FileDiffClass,
  type FileDiffMetadata,
  parsePatchFiles,
  type SelectedLineRange,
  VirtualizedFileDiff as VirtualizedFileDiffClass,
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
import { useVirtualizer } from "./Virtualizer";

export type FileDiffProps = {
  /** Raw per-file unified diff (with `--- / +++ / @@` headers). */
  rawDiff: string;
  /** Light vs dark syntax-highlight theme. */
  theme: "light" | "dark";
  /** Default `"unified"`. */
  diffStyle?: "unified" | "split";
  /** When true, Pierre wires gutter selection. The consumer drives it via
   *  `onLineSelected`. Default `false`. */
  enableLineSelection?: boolean;
  /** Fires on every selection commit (single-line click or drag end);
   *  `null` on deselect. */
  onLineSelected?: (range: SelectedLineRange | null) => void;
  /** Surface construction, parse, and render throws. Required because
   *  silently swallowing a parse failure leaves a blank pane that looks
   *  identical to an empty diff. */
  onError: (err: Error) => void;
  /** Forwarded to the container `<div>`. */
  class?: string;
  /** Forwarded to the container `<div>` — host theming lives here. */
  style?: JSX.CSSProperties;
};

const FileDiff: Component<FileDiffProps> = (props) => {
  let container!: HTMLDivElement;
  let instance: FileDiffClass | undefined;

  // Captured at setup. Switching modes mid-life would require tearing
  // down the instance — kolu's `<Show keyed>` on the selected path
  // already remounts the component on higher-level transitions.
  const virtualizer = useVirtualizer();

  const parseFirstFile = (raw: string): FileDiffMetadata | undefined => {
    if (!raw) return undefined;
    return parsePatchFiles(raw)[0]?.files[0];
  };

  const safeRender = (raw: string) => {
    if (!instance) return;
    try {
      const fileDiff = parseFirstFile(raw);
      if (virtualizer) {
        // Virtualized: `container` IS the file container — we own its
        // lifecycle (`isContainerManaged: true`). Note that
        // `VirtualizedFileDiff` caches the first `fileDiff` via `??=`
        // and ignores subsequent values, so live content swaps require
        // a host-driven remount (kolu's `<Show keyed>` already does this
        // on path changes). Calling `render()` here still flushes
        // visibility / window-spec changes.
        instance.render({ fileContainer: container, fileDiff });
      } else {
        // Non-virtualized: `container` is the wrapper; Pierre creates
        // the inner file-container element inside it on first render.
        instance.render({ containerWrapper: container, fileDiff });
      }
    } catch (e) {
      props.onError(toError(e));
    }
  };

  onMount(() => {
    try {
      const options = {
        theme: DEFAULT_THEMES,
        themeType: props.theme,
        diffStyle: props.diffStyle ?? "unified",
        overflow: "wrap" as const,
        lineHoverHighlight: "both" as const,
        enableLineSelection: props.enableLineSelection ?? false,
        onLineSelected: props.onLineSelected,
      };
      instance = virtualizer
        ? new VirtualizedFileDiffClass(
            options,
            virtualizer,
            /* metrics */ undefined,
            /* workerManager */ undefined,
            /* isContainerManaged */ true,
          )
        : new FileDiffClass(options);
      safeRender(props.rawDiff);
    } catch (e) {
      props.onError(toError(e));
    }
  });

  createEffect(
    on(
      () => props.rawDiff,
      (raw) => safeRender(raw),
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.theme,
      (t) => {
        try {
          instance?.setThemeType(t);
        } catch (e) {
          props.onError(toError(e));
        }
      },
      { defer: true },
    ),
  );

  onCleanup(() => instance?.cleanUp());

  return (
    <div
      ref={container}
      class={props.class}
      style={props.style}
      data-testid="pierre-diff-view"
    />
  );
};

export default FileDiff;
export { FileDiff };
