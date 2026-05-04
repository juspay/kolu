/** SolidJS wrapper over `@pierre/diffs`' vanilla `File` class.
 *
 *  Renders a single file's contents with the same shiki-backed highlighter
 *  that powers `FileDiff`. Pierre's imperative `render()` can throw
 *  (e.g. unsupported language, asset load failure) — those surface via
 *  the required `onError` prop instead of escaping Solid's lifecycle. */

import {
  DEFAULT_THEMES,
  File as FileClass,
  type FileContents,
  type SelectedLineRange,
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

  const fileContents = createMemo<FileContents>(() => ({
    name: props.name,
    contents: props.contents,
  }));

  const safeRender = (file: FileContents) => {
    if (!instance) return;
    try {
      instance.render({ containerWrapper: container, file });
    } catch (e) {
      props.onError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  onMount(() => {
    try {
      instance = new FileClass({
        theme: DEFAULT_THEMES,
        themeType: props.theme,
        enableLineSelection: props.enableLineSelection ?? false,
        onLineSelected: props.onLineSelected,
      });
      safeRender(fileContents());
    } catch (e) {
      props.onError(e instanceof Error ? e : new Error(String(e)));
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
          props.onError(e instanceof Error ? e : new Error(String(e)));
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
