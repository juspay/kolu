/** Thin SolidJS wrapper over `@pierre/diffs`' vanilla `File` class.
 *
 *  Renders a single file's contents with the same shiki-backed syntax
 *  highlighter that powers `FileDiff`. Used by the Code tab's browse mode.
 *
 *  Line selection is enabled so the user can select a range and right-click
 *  to copy `path:start-end` for pasting into chats / agents. */

import {
  type Component,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import {
  File,
  DEFAULT_THEMES,
  type FileContents,
  type SelectedLineRange,
} from "@pierre/diffs";
import { pierreDiffsStyle } from "./pierreTheme";
import {
  CodeContextMenu,
  type CodeContextMenuController,
  type CodeContextMenuItem,
} from "./CodeContextMenu";
import { formatLineRef } from "./lineRef";

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
  const [range, setRange] = createSignal<SelectedLineRange | null>(null);

  const fileContents = (): FileContents => ({
    name: props.name,
    contents: props.contents,
  });

  onMount(() => {
    instance = new File({
      theme: DEFAULT_THEMES,
      themeType: props.theme,
      enableLineSelection: true,
      onLineSelected: (r) => setRange(r),
    });
    instance.render({ containerWrapper: container, file: fileContents() });
  });

  createEffect(
    on(
      [() => props.name, () => props.contents],
      () => {
        setRange(null);
        instance?.render({ containerWrapper: container, file: fileContents() });
      },
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

  const buildItems = (): CodeContextMenuItem[] => {
    const items: CodeContextMenuItem[] = [
      { label: "Copy path", textToCopy: props.name },
    ];
    const r = range();
    if (r) {
      const ref = formatLineRef(props.name, r.start, r.end);
      items.push({ label: `Copy ${ref}`, textToCopy: ref });
    }
    return items;
  };

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
      <CodeContextMenu getItems={buildItems} ref={(c) => (menuCtrl = c)} />
    </div>
  );
};

export default PierreFileView;
