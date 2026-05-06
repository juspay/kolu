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
  type SelectedLineRange,
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
  /** Forwarded to the container `<div>`. */
  class?: string;
  /** Forwarded to the container `<div>` — host theming lives here. */
  style?: JSX.CSSProperties;
};

const FileView: Component<FileViewProps> = (props) => {
  let container!: HTMLDivElement;
  let instance: FileClass | undefined;

  // Captured at setup. Switching modes mid-life would require tearing
  // down the instance — hosts that remount on higher-level transitions
  // (e.g. kolu's `<Show keyed>` on path) avoid that case.
  const virtualizer = useVirtualizer();

  const fileContents = createMemo<FileContents>(() => ({
    name: props.name,
    contents: props.contents,
  }));

  const safeRender = (file: FileContents) => {
    if (!instance) return;
    try {
      if (virtualizer) {
        // Virtualized: `container` IS the file container — we own its
        // lifecycle. Pierre's `VirtualizedFile.render` reuses the cached
        // `file` for window-spec changes; calling render() with new
        // `file` updates underlying `super.render` metadata, but to swap
        // a different file entirely host code should remount the
        // component.
        instance.render({ fileContainer: container, file });
      } else {
        instance.render({ containerWrapper: container, file });
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
        enableLineSelection: props.enableLineSelection ?? false,
        onLineSelected: props.onLineSelected,
      };
      instance = virtualizer
        ? new VirtualizedFileClass(
            options,
            virtualizer,
            /* metrics */ undefined,
            /* workerManager */ undefined,
            /* isContainerManaged */ true,
          )
        : new FileClass(options);
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
      data-testid="pierre-file-view"
    />
  );
};

export default FileView;
export { FileView };
