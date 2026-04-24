/** Thin SolidJS wrapper over `@pierre/diffs`' vanilla `File` class.
 *
 *  Renders a single file's contents with the same shiki-backed syntax
 *  highlighter that powers `FileDiff`. Used by the Code tab's browse mode.
 *
 *  Line selection is enabled so the user can select a range and right-click
 *  to copy `path:start-end` for pasting into chats / agents. */

import { type Component, createEffect, on, onCleanup, onMount } from "solid-js";
import { File, DEFAULT_THEMES, type FileContents } from "@pierre/diffs";
import { pierreDiffsStyle } from "./pierreTheme";
import {
  CodeContextMenu,
  type CodeContextMenuController,
} from "./CodeContextMenu";
import { useLineSelection } from "./useLineSelection";

export type PierreFileViewProps = {
  /** Display name (drives language inference for syntax highlighting). */
  name: string;
  contents: string;
  theme: "light" | "dark";
};

const PierreFileView: Component<PierreFileViewProps> = (props) => {
  let container!: HTMLDivElement;
  let host!: HTMLDivElement;
  let instance: File | undefined;
  let menuCtrl: CodeContextMenuController | undefined;
  const selection = useLineSelection(() => props.name);

  const fileContents = (): FileContents => ({
    name: props.name,
    contents: props.contents,
  });

  onMount(() => {
    instance = new File({
      theme: DEFAULT_THEMES,
      themeType: props.theme,
      enableLineSelection: true,
      onLineSelected: selection.handleSelect,
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
      ref={host!}
      class="h-full w-full"
      onContextMenu={(e) => menuCtrl?.open(e)}
    >
      <div
        ref={container!}
        class="h-full w-full overflow-auto"
        style={pierreDiffsStyle}
        data-testid="pierre-file-view"
      />
      <CodeContextMenu
        getItems={selection.buildItems}
        ref={(c) => (menuCtrl = c)}
      />
    </div>
  );
};

export default PierreFileView;
