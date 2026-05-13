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
  DIFFS_TAG_NAME,
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
  /** Programmatic selection — when set, Pierre highlights this range
   *  via `setSelectedLines` and stamps `[data-selected-line]` on the
   *  content row. Mirrors `FileView.selectedLines`; consumers push to
   *  it from tray jump / pencil flows so the inline composer popover
   *  has an anchor in diff mode too. */
  selectedLines?: SelectedLineRange | null;
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
  setSelectedLines(range: SelectedLineRange | null): void;
  cleanUp(): void;
};

const createDiffRenderer = (
  buildOptions: () => FileDiffOptions<undefined>,
  container: HTMLDivElement,
  virtualizer: VirtualizerClass | undefined,
): DiffRenderer => {
  if (virtualizer) {
    // Virtualized: we own a `<diffs-container>` custom element nested
    // inside our wrapper, and pass it to Pierre as `fileContainer`.
    // Creating the element ourselves (`document.createElement(
    // DIFFS_TAG_NAME)`) is what triggers the custom-element constructor
    // in `@pierre/diffs/components/web-components`, which attaches a
    // shadow root and adopts Pierre's main stylesheet — without this,
    // the diff would render unstyled (syntax tokens fall back to the
    // inherited fg colour, gutter grid layout collapses).
    //
    // `VirtualizedFileDiff` caches the first `fileDiff` via `??=` and
    // ignores subsequent values, so a single instance can't swap
    // content. Recreate on every render: the live-update path
    // (`gitDiff` stream tick when the working tree changes) and any
    // `rawDiff` reassignment for the same path go through this
    // function, and a stale viewport would silently render the old
    // content. Recreate cost is bounded by Pierre's setup; the new
    // instance doesn't walk the previous diff. The `<diffs-container>`
    // host stays put across recreates so the adopted stylesheet
    // survives.
    let instance: VirtualizedFileDiffClass | undefined;
    let fileContainer: HTMLElement | undefined;
    return {
      render: (fileDiff) => {
        instance?.cleanUp();
        if (fileContainer == null) {
          fileContainer = document.createElement(DIFFS_TAG_NAME);
          container.appendChild(fileContainer);
        }
        // `buildOptions` reads `props.theme` so a theme change between
        // renders lands on the fresh instance.
        instance = new VirtualizedFileDiffClass(
          buildOptions(),
          virtualizer,
          /* metrics */ undefined,
          /* workerManager */ undefined,
          /* isContainerManaged */ true,
        );
        instance.render({ fileContainer, fileDiff });
      },
      setThemeType: (t) => instance?.setThemeType(t),
      setSelectedLines: (range) => instance?.setSelectedLines(range),
      cleanUp: () => {
        instance?.cleanUp();
        fileContainer?.remove();
        fileContainer = undefined;
      },
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
    setSelectedLines: (range) => instance.setSelectedLines(range),
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

  // Programmatic selection — pushes the prop's range through Pierre's
  // `setSelectedLines`, which stamps `[data-selected-line]` on the
  // matching content row. Used by the tray jump / pencil flows so the
  // inline popover has a DOM anchor in diff mode (matches FileView).
  createEffect(
    on(
      () => props.selectedLines,
      (range) => {
        try {
          renderer?.setSelectedLines(range ?? null);
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
