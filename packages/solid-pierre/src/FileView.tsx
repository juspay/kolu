/** SolidJS wrapper over `@pierre/diffs`' vanilla `File` class — or
 *  `VirtualizedFile` when wrapped in `<Virtualizer>`.
 *
 *  Renders a single file's contents with the same shiki-backed highlighter
 *  that powers `FileDiff`. Pierre's imperative `render()` can throw
 *  (e.g. unsupported language, asset load failure) — those surface via
 *  the required `onError` prop instead of escaping Solid's lifecycle.
 *
 *  Virtualization is controlled by the enclosing `<Virtualizer>` (via
 *  Solid context). When present, `VirtualizedFile` renders only the
 *  lines intersecting the viewport — the path that closes Phase 8 of
 *  #514 for very large file views. With no enclosing `<Virtualizer>`,
 *  the wrapper uses the plain `File` class — same behavior as before. */

import {
  DEFAULT_THEMES,
  DIFFS_TAG_NAME,
  File as FileClass,
  type FileContents,
  type FileOptions,
  type SelectedLineRange,
  type Virtualizer as VirtualizerClass,
  VirtualizedFile as VirtualizedFileClass,
} from "@pierre/diffs";
import {
  type Component,
  createEffect,
  createMemo,
  type JSX,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { toError } from "./toError";
import { useVirtualizer } from "./Virtualizer";

export type FileViewProps = {
  /** Display name (drives language inference for syntax highlighting). */
  name: string;
  contents: string;
  /** Light vs dark syntax-highlight theme. */
  theme: "light" | "dark";
  /** Horizontal overflow behavior. Default `"scroll"` matches Pierre's
   *  file-view default; callers can opt into wrapped long lines. */
  overflow?: FileOptions<undefined>["overflow"];
  /** When true, Pierre wires gutter selection. The consumer drives it via
   *  `onLineSelected`. Default `false`. */
  enableLineSelection?: boolean;
  /** Fires on every selection commit (single-line click or drag end);
   *  `null` on deselect. */
  onLineSelected?: (range: SelectedLineRange | null) => void;
  /** Push this range into Pierre's selection state and scroll the
   *  start line into view. Consumers typically wire this to a
   *  line-selection controller signal so user drags and external
   *  navigation requests both flow through the same source of truth. */
  selectedLines?: SelectedLineRange | null;
  /** Surface construction and render throws. Required because silent
   *  failures here produce a blank pane indistinguishable from "loading". */
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

type FileRenderer = {
  render(file: FileContents): void;
  setThemeType(theme: "light" | "dark"): void;
  setSelectedLines(range: SelectedLineRange | null): void;
  /** Best-effort: find the line element by its `data-line-index` and
   *  scroll it into view. No-op when the element isn't in the DOM yet
   *  (virtualized files only render a windowed range). */
  scrollToLine(lineNumber: number): void;
  cleanUp(): void;
};

/** Find Pierre's row element for `lineNumber` (1-based) inside `root`
 *  and centre-scroll it into view. No-op when the element isn't in
 *  the DOM yet — virtualized files only render a windowed range, so
 *  deep references on long files miss until Pierre catches up. */
const scrollToLineIndex = (
  root: ParentNode | null | undefined,
  lineNumber: number,
): void => {
  const el = root?.querySelector(`[data-line-index="${lineNumber - 1}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: "center" });
  }
};

const createFileRenderer = (
  buildOptions: () => FileOptions<undefined>,
  container: HTMLDivElement,
  virtualizer: VirtualizerClass | undefined,
): FileRenderer => {
  if (virtualizer) {
    // Virtualized: we own a `<diffs-container>` custom element nested
    // inside our wrapper, and pass it to Pierre as `fileContainer`.
    // Creating the element ourselves (`document.createElement(
    // DIFFS_TAG_NAME)`) is what triggers the custom-element constructor
    // in `@pierre/diffs/components/web-components`, which attaches a
    // shadow root and adopts Pierre's main stylesheet — without this,
    // the file would render unstyled.
    //
    // `VirtualizedFile` caches the first `file` via `??=` and ignores
    // subsequent values, so a single instance can't swap content.
    // Recreate on every render: the live-update path (`fsReadFile`
    // stream tick when the file changes on disk) goes through this
    // function, and a stale viewport would silently render the old
    // content. Recreate cost is bounded by Pierre's setup; the new
    // instance doesn't walk the previous content. The
    // `<diffs-container>` host stays put across recreates so the
    // adopted stylesheet survives.
    let instance: VirtualizedFileClass | undefined;
    let fileContainer: HTMLElement | undefined;
    return {
      render: (file) => {
        instance?.cleanUp();
        if (fileContainer == null) {
          fileContainer = document.createElement(DIFFS_TAG_NAME);
          container.appendChild(fileContainer);
        }
        // `buildOptions` reads `props.theme` so a theme change between
        // renders lands on the fresh instance.
        instance = new VirtualizedFileClass(
          buildOptions(),
          virtualizer,
          /* metrics */ undefined,
          /* workerManager */ undefined,
          /* isContainerManaged */ true,
        );
        // Pierre upstream bug: `VirtualizedFile.setVisibility(true)`
        // doesn't reset `renderRange`, so after a display:none →
        // display:block transition (e.g. inspector → code right-panel
        // tab toggle in kolu) Pierre's superclass `File.render`
        // early-returns because the cached `renderRange` matches the
        // freshly-computed one — the file stays stuck in the
        // placeholder DOM that `setVisibility(false)` rendered, with
        // no content. `VirtualizedFileDiff.setVisibility` resets
        // `renderRange` itself; this patch mirrors that fix on the
        // file-content sibling. Remove this when Pierre ships the fix
        // upstream.
        const patchedInstance = instance as unknown as {
          isVisible: boolean;
          renderRange: unknown;
          setVisibility(visible: boolean): void;
        };
        const originalSetVisibility =
          patchedInstance.setVisibility.bind(patchedInstance);
        patchedInstance.setVisibility = (visible: boolean) => {
          if (visible && !patchedInstance.isVisible) {
            patchedInstance.renderRange = undefined;
          }
          originalSetVisibility(visible);
        };
        instance.render({ fileContainer, file });
      },
      setThemeType: (t) => instance?.setThemeType(t),
      setSelectedLines: (range) => instance?.setSelectedLines(range),
      scrollToLine: (lineNumber) =>
        scrollToLineIndex(fileContainer?.shadowRoot, lineNumber),
      cleanUp: () => {
        instance?.cleanUp();
        fileContainer?.remove();
        fileContainer = undefined;
      },
    };
  }
  // Vanilla: `container` is the wrapper; Pierre creates the inner
  // file-content element inside it on first render. Pierre's internal
  // diffing handles updates, so a single instance covers the lifetime.
  const instance = new FileClass(buildOptions());
  return {
    render: (file) => instance.render({ containerWrapper: container, file }),
    setThemeType: (t) => instance.setThemeType(t),
    setSelectedLines: (range) => instance.setSelectedLines(range),
    scrollToLine: (lineNumber) => scrollToLineIndex(container, lineNumber),
    cleanUp: () => instance.cleanUp(),
  };
};

const FileView: Component<FileViewProps> = (props) => {
  let container!: HTMLDivElement;
  let renderer: FileRenderer | undefined;
  let scrollRaf = 0;

  // Captured once at setup; see FileDiff for the rationale.
  const virtualizer = useVirtualizer();

  // Structural equality: only emit when the underlying strings change.
  // The default reference-equality form would re-emit on every parent
  // re-render (each render produces a fresh object literal), and in the
  // virtualized branch each emit triggers a tear-down + recreate of the
  // Pierre instance — a recreate during a tab toggle into `display:none`
  // strands the new instance in placeholder mode because Pierre's
  // intersection observer doesn't always fire entries when the root has
  // no layout box.
  const fileContents = createMemo<FileContents, undefined>(
    () => ({ name: props.name, contents: props.contents }),
    undefined,
    {
      equals: (a, b) => a.name === b.name && a.contents === b.contents,
    },
  );

  const applySelection = () => {
    if (!renderer) return;
    const r = props.selectedLines ?? null;
    try {
      renderer.setSelectedLines(r);
      if (r) {
        // One frame deferral so Pierre's render has actually committed
        // the gutter/content DOM that `scrollToLine` queries against.
        // Cancel any prior queued frame so rapid click-spam doesn't
        // stack scrollIntoView calls with stale targets.
        cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(() =>
          renderer?.scrollToLine(r.start),
        );
      }
    } catch (e) {
      props.onError(toError(e));
    }
  };

  const safeRender = (file: FileContents) => {
    if (!renderer) return;
    try {
      renderer.render(file);
      // The virtualized renderer rebuilds its Pierre instance on
      // every content swap — Pierre's prior selection state lives on
      // the discarded instance, so we re-push the consumer-driven
      // range onto the fresh one.
      applySelection();
    } catch (e) {
      props.onError(toError(e));
    }
  };

  // Closed over for the virtualized recreate path so each fresh
  // instance picks up the current `props.theme`.
  const buildOptions = (): FileOptions<undefined> => ({
    theme: DEFAULT_THEMES,
    themeType: props.theme,
    overflow: props.overflow ?? "scroll",
    enableLineSelection: props.enableLineSelection ?? false,
    onLineSelected: props.onLineSelected,
  });

  onMount(() => {
    try {
      renderer = createFileRenderer(buildOptions, container, virtualizer);
      safeRender(fileContents());
    } catch (e) {
      props.onError(toError(e));
    }
  });

  createEffect(on(fileContents, (file) => safeRender(file), { defer: true }));

  // Re-apply selection when the controller's range ticks (user drag,
  // external navigation request). The content-change path already
  // calls `applySelection` from inside `safeRender`. Pierre dedups
  // identical ranges internally, so user drags don't double-apply.
  createEffect(
    on(
      () => props.selectedLines,
      () => applySelection(),
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

  onCleanup(() => {
    cancelAnimationFrame(scrollRaf);
    renderer?.cleanUp();
  });

  return (
    <div
      ref={container}
      class={props.class}
      style={props.style}
      data-testid="pierre-file-view"
    />
  );
};

export default FileView;
export { FileView };
