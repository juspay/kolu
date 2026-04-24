/** Thin SolidJS wrapper over `@pierre/diffs`' vanilla `File` class.
 *
 *  Renders a single file's contents with the same shiki-backed syntax
 *  highlighter that powers `FileDiff`. Used by the Code tab's browse mode. */

import { type Component, createEffect, on, onCleanup, onMount } from "solid-js";
import { File, DEFAULT_THEMES, type FileContents } from "@pierre/diffs";
import { pierreDiffsStyle } from "./pierreTheme";

export type PierreFileViewProps = {
  /** Display name (drives language inference for syntax highlighting). */
  name: string;
  contents: string;
  theme: "light" | "dark";
};

const PierreFileView: Component<PierreFileViewProps> = (props) => {
  let container!: HTMLDivElement;
  let instance: File | undefined;

  const fileContents = (): FileContents => ({
    name: props.name,
    contents: props.contents,
  });

  onMount(() => {
    instance = new File({
      theme: DEFAULT_THEMES,
      themeType: props.theme,
    });
    instance.render({ containerWrapper: container, file: fileContents() });
  });

  createEffect(
    on(
      [() => props.name, () => props.contents],
      () =>
        instance?.render({ containerWrapper: container, file: fileContents() }),
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.theme,
      (t) => instance?.setThemeType(t),
      { defer: true },
    ),
  );

  onCleanup(() => instance?.cleanUp());

  return (
    <div
      ref={container!}
      class="h-full w-full overflow-auto"
      style={pierreDiffsStyle}
      data-testid="pierre-file-view"
    />
  );
};

export default PierreFileView;
