/** Thin SolidJS wrapper over `@pierre/diffs`' vanilla `FileDiff` class.
 *
 *  Pierre parses raw unified diffs via `parsePatchFiles`. Kolu's server
 *  returns `hunks: string[]` where each entry is a full per-file patch
 *  (with `--- / +++ / @@` headers). We pick the first file and render it.
 *
 *  Line selection is enabled so the user can select a hunk range and
 *  right-click to copy `path:start-end` for pasting into chats / agents. */

import {
  DEFAULT_THEMES,
  FileDiff,
  type FileDiffMetadata,
  parsePatchFiles,
} from "@pierre/diffs";
import { type Component, createEffect, on, onCleanup, onMount } from "solid-js";
import {
  CodeContextMenu,
  type CodeContextMenuController,
} from "./CodeContextMenu";
import { pierreDiffsStyle } from "./pierreTheme";
import { useLineSelection } from "./useLineSelection";

export type PierreDiffViewProps = {
  /** Repo-relative path of the file being diffed. Used by the context
   *  menu's "Copy path" / "Copy path:line(s)" entries. */
  path: string;
  /** Raw per-file unified diff (one element of `GitDiffOutput.hunks`). */
  rawDiff: string;
  /** Light vs dark syntax-highlight theme. */
  theme: "light" | "dark";
};

function parseFirstFile(raw: string): FileDiffMetadata | undefined {
  if (!raw) return undefined;
  try {
    const patches = parsePatchFiles(raw);
    return patches[0]?.files[0];
  } catch (e) {
    // Pierre rejects malformed headers; surface to console so the blank
    // pane doesn't look like a silent data-loading bug.
    console.warn("pierre-diffs: parsePatchFiles failed", e);
    return undefined;
  }
}

const PierreDiffView: Component<PierreDiffViewProps> = (props) => {
  let container!: HTMLDivElement;
  let host!: HTMLDivElement;
  let instance: FileDiff | undefined;
  let menuCtrl: CodeContextMenuController | undefined;
  const selection = useLineSelection(() => props.path);

  onMount(() => {
    const fileDiff = parseFirstFile(props.rawDiff);
    instance = new FileDiff({
      theme: DEFAULT_THEMES,
      themeType: props.theme,
      diffStyle: "unified",
      overflow: "wrap",
      lineHoverHighlight: "both",
      enableLineSelection: true,
      onLineSelected: selection.handleSelect,
    });
    instance.render({ containerWrapper: container, fileDiff });
  });

  createEffect(
    on(
      () => props.rawDiff,
      (raw) => {
        const fileDiff = parseFirstFile(raw);
        instance?.render({ containerWrapper: container, fileDiff });
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
        data-testid="pierre-diff-view"
      />
      <CodeContextMenu
        getItems={selection.buildItems}
        ref={(c) => (menuCtrl = c)}
      />
    </div>
  );
};

export default PierreDiffView;
