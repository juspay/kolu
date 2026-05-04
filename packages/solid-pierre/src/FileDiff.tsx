/** SolidJS wrapper over `@pierre/diffs`' vanilla `FileDiff` class.
 *
 *  Pierre parses raw unified diffs via `parsePatchFiles`. A single diff
 *  can contain multiple files; this wrapper picks the first one (kolu's
 *  callers slice per-file before passing in). Pierre throws on malformed
 *  headers and the imperative `render()` can also throw — both routes
 *  are caught and surfaced via the required `onError` prop. */

import {
  DEFAULT_THEMES,
  FileDiff as FileDiffClass,
  type FileDiffMetadata,
  parsePatchFiles,
  type SelectedLineRange,
} from "@pierre/diffs";
import {
  type Component,
  createEffect,
  type JSX,
  on,
  onCleanup,
  onMount,
} from "solid-js";

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

  const parseFirstFile = (raw: string): FileDiffMetadata | undefined => {
    if (!raw) return undefined;
    return parsePatchFiles(raw)[0]?.files[0];
  };

  const safeRender = (raw: string) => {
    if (!instance) return;
    try {
      instance.render({
        containerWrapper: container,
        fileDiff: parseFirstFile(raw),
      });
    } catch (e) {
      props.onError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  onMount(() => {
    try {
      instance = new FileDiffClass({
        theme: DEFAULT_THEMES,
        themeType: props.theme,
        diffStyle: props.diffStyle ?? "unified",
        overflow: "wrap",
        lineHoverHighlight: "both",
        enableLineSelection: props.enableLineSelection ?? false,
        onLineSelected: props.onLineSelected,
      });
      safeRender(props.rawDiff);
    } catch (e) {
      props.onError(e instanceof Error ? e : new Error(String(e)));
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
      data-testid="pierre-diff-view"
    />
  );
};

export default FileDiff;
export { FileDiff };
