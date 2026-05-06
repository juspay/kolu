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
  type FileDiffOptions,
  parsePatchFiles,
  type SelectedLineRange,
  type Virtualizer as VirtualizerClass,
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
  /** Forwarded to the host `<div>` (Pierre's file-container element when
   *  virtualized; the wrapper Pierre creates a child inside otherwise).
   *  Use for sizing classes (`w-full`, `h-full`); do **not** apply
   *  `overflow-*` here — the scroll container is the parent (or the
   *  enclosing `<Virtualizer>` when virtualized). Putting overflow here
   *  would create a nested scroller inside the virtualization scroll
   *  surface and break Pierre's intersection-observer math. */
  class?: string;
  /** Forwarded to the host `<div>` — Pierre theming lives here. */
  style?: JSX.CSSProperties;
};

const parseFirstFile = (raw: string): FileDiffMetadata | undefined => {
  if (!raw) return undefined;
  return parsePatchFiles(raw)[0]?.files[0];
};

type DiffRenderer = {
  render(fileDiff: FileDiffMetadata | undefined): void;
  setThemeType(theme: "light" | "dark"): void;
  cleanUp(): void;
};

const createDiffRenderer = (
  buildOptions: () => FileDiffOptions<undefined>,
  container: HTMLDivElement,
  virtualizer: VirtualizerClass | undefined,
): DiffRenderer => {
  if (virtualizer) {
    // Virtualized: `container` IS the file container; we own its
    // lifecycle (`isContainerManaged: true`). Pierre's
    // `VirtualizedFileDiff` caches the first `fileDiff` via `??=` and
    // ignores subsequent values, so a single instance can't swap
    // content. Recreate on every render: the live-update path
    // (`gitDiff` stream tick when the working tree changes) and any
    // `rawDiff` reassignment for the same path go through this
    // function, and a stale viewport would silently render the old
    // content. Recreate cost is bounded by Pierre's setup; the new
    // instance doesn't walk the previous diff.
    let instance: VirtualizedFileDiffClass | undefined;
    return {
      render: (fileDiff) => {
        instance?.cleanUp();
        // `buildOptions` reads `props.theme` so a theme change between
        // renders lands on the fresh instance (the `setThemeType`
        // effect can't reach an instance that has just been thrown
        // away).
        instance = new VirtualizedFileDiffClass(
          buildOptions(),
          virtualizer,
          /* metrics */ undefined,
          /* workerManager */ undefined,
          /* isContainerManaged */ true,
        );
        instance.render({ fileContainer: container, fileDiff });
      },
      setThemeType: (t) => instance?.setThemeType(t),
      cleanUp: () => instance?.cleanUp(),
    };
  }
  // Vanilla: `container` is the wrapper; Pierre creates an inner
  // file-container element inside it on first render. Pierre's
  // reference-equality check on `fileDiff` handles updates internally,
  // so a single instance covers the whole lifetime.
  const instance = new FileDiffClass(buildOptions());
  return {
    render: (fileDiff) =>
      instance.render({ containerWrapper: container, fileDiff }),
    setThemeType: (t) => instance.setThemeType(t),
    cleanUp: () => instance.cleanUp(),
  };
};

const FileDiff: Component<FileDiffProps> = (props) => {
  let container!: HTMLDivElement;
  let renderer: DiffRenderer | undefined;

  // Captured once at setup. Switching modes mid-life would corrupt
  // Pierre's instance — kolu's `<Show keyed>` on the selected path
  // already remounts the component on higher-level transitions, which
  // is the supported way to swap modes.
  const virtualizer = useVirtualizer();

  const safeRender = (raw: string) => {
    if (!renderer) return;
    try {
      // Parse before render so a malformed diff fails before the
      // virtualized branch tears down the previous Pierre instance.
      renderer.render(parseFirstFile(raw));
    } catch (e) {
      props.onError(toError(e));
    }
  };

  // Closed over for the virtualized recreate path so each fresh
  // instance picks up the current `props.theme`.
  const buildOptions = (): FileDiffOptions<undefined> => ({
    theme: DEFAULT_THEMES,
    themeType: props.theme,
    diffStyle: props.diffStyle ?? "unified",
    overflow: "wrap",
    lineHoverHighlight: "both",
    enableLineSelection: props.enableLineSelection ?? false,
    onLineSelected: props.onLineSelected,
  });

  onMount(() => {
    try {
      renderer = createDiffRenderer(buildOptions, container, virtualizer);
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
          renderer?.setThemeType(t);
        } catch (e) {
          props.onError(toError(e));
        }
      },
      { defer: true },
    ),
  );

  onCleanup(() => renderer?.cleanUp());

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
