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
  /** When true, Pierre wires gutter selection. The consumer drives it via
   *  `onLineSelected`. Default `false`. */
  enableLineSelection?: boolean;
  /** Fires on every selection commit (single-line click or drag end);
   *  `null` on deselect. */
  onLineSelected?: (range: SelectedLineRange | null) => void;
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
  cleanUp(): void;
};

const createFileRenderer = (
  buildOptions: () => FileOptions<undefined>,
  container: HTMLDivElement,
  virtualizer: VirtualizerClass | undefined,
): FileRenderer => {
  if (virtualizer) {
    // Virtualized: `container` IS the file container; we own its
    // lifecycle (`isContainerManaged: true`). `VirtualizedFile.render`
    // caches the first `file` via `??=` and ignores subsequent values,
    // so a single instance can't swap content. Recreate on every
    // render: the live-update path (`fsReadFile` stream tick when the
    // file changes on disk) goes through this function, and a stale
    // viewport would silently render the old content. Recreate cost
    // is bounded by Pierre's setup; the new instance doesn't walk the
    // previous content.
    let instance: VirtualizedFileClass | undefined;
    return {
      render: (file) => {
        instance?.cleanUp();
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
        instance.render({ fileContainer: container, file });
      },
      setThemeType: (t) => instance?.setThemeType(t),
      cleanUp: () => instance?.cleanUp(),
    };
  }
  // Vanilla: `container` is the wrapper; Pierre creates the inner
  // file-content element inside it on first render. Pierre's internal
  // diffing handles updates, so a single instance covers the lifetime.
  const instance = new FileClass(buildOptions());
  return {
    render: (file) => instance.render({ containerWrapper: container, file }),
    setThemeType: (t) => instance.setThemeType(t),
    cleanUp: () => instance.cleanUp(),
  };
};

const FileView: Component<FileViewProps> = (props) => {
  let container!: HTMLDivElement;
  let renderer: FileRenderer | undefined;

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
  const fileContents = createMemo<FileContents>(
    () => ({ name: props.name, contents: props.contents }),
    undefined,
    {
      equals: (a, b) => a.name === b.name && a.contents === b.contents,
    },
  );

  const safeRender = (file: FileContents) => {
    if (!renderer) return;
    try {
      renderer.render(file);
    } catch (e) {
      props.onError(toError(e));
    }
  };

  // Closed over for the virtualized recreate path so each fresh
  // instance picks up the current `props.theme`.
  const buildOptions = (): FileOptions<undefined> => ({
    theme: DEFAULT_THEMES,
    themeType: props.theme,
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
      data-testid="pierre-file-view"
    />
  );
};

export default FileView;
export { FileView };
