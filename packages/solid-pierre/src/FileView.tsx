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

/** Façade over Pierre's two file-content classes. Same pairing
 *  invariant as `createDiffRenderer`: keep the constructor and the
 *  render-call shape that follows from it inside one factory so a
 *  future render-option addition can't be applied to one arm and
 *  missed on the other. */
type FileRenderer = {
  render(file: FileContents): void;
  setThemeType(theme: "light" | "dark"): void;
  cleanUp(): void;
};

const createFileRenderer = (
  options: FileOptions<undefined>,
  container: HTMLDivElement,
  virtualizer: VirtualizerClass | undefined,
): FileRenderer => {
  if (virtualizer) {
    // Virtualized: `container` IS the file container; we own its
    // lifecycle (`isContainerManaged: true`). Pierre's `VirtualizedFile`
    // re-renders against the cached `file` for window-spec changes;
    // swapping a different file entirely should remount the host
    // component (kolu's `<Show keyed>` does this on path changes).
    const instance = new VirtualizedFileClass(
      options,
      virtualizer,
      /* metrics */ undefined,
      /* workerManager */ undefined,
      /* isContainerManaged */ true,
    );
    return {
      render: (file) => instance.render({ fileContainer: container, file }),
      setThemeType: (t) => instance.setThemeType(t),
      cleanUp: () => instance.cleanUp(),
    };
  }
  // Vanilla: `container` is the wrapper; Pierre creates the inner
  // file-content element inside it on first render.
  const instance = new FileClass(options);
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

  const fileContents = createMemo<FileContents>(() => ({
    name: props.name,
    contents: props.contents,
  }));

  const safeRender = (file: FileContents) => {
    if (!renderer) return;
    try {
      renderer.render(file);
    } catch (e) {
      props.onError(toError(e));
    }
  };

  onMount(() => {
    try {
      renderer = createFileRenderer(
        {
          theme: DEFAULT_THEMES,
          themeType: props.theme,
          enableLineSelection: props.enableLineSelection ?? false,
          onLineSelected: props.onLineSelected,
        },
        container,
        virtualizer,
      );
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
