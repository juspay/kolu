/** Pure presenter for a text file in the Code tab's browse mode. Receives
 *  the file body as props and renders Pierre's syntax-highlighted `CodeView`
 *  (single-item, file shape).
 *
 *  Knows nothing of comments: the capture surface is applied one level up at
 *  the seam (`withComments` in `BrowseFileDispatcher`), so "is this
 *  commentable?" is decided in one place for every browse view — source,
 *  markdown preview, image — rather than each leaf wrapping itself.
 *
 *  Subscription, loading, error, and kind-dispatch live one level up in
 *  `BrowseFileDispatcher` so the views stay single-strategy. */

import {
  CodeView,
  type CodeViewItem,
  fileItem,
  type SelectedLineRange,
  useCodeViewSelection,
} from "@kolu/solid-pierre";
import { type Component, createMemo, Show } from "solid-js";
import { toast } from "solid-sonner";
import { koluCodeViewProps } from "../ui/pierreTheme";
import CodeMenuFrame from "./CodeMenuFrame";

export type BrowseFileViewProps = {
  filePath: string;
  content: string;
  /** True if the file exceeded the server's size limit and was truncated. */
  truncated: boolean;
  theme: "light" | "dark";
  /** Initial line range to highlight (and scroll to). Set when the
   *  caller opens the file at a specific range — e.g. a terminal
   *  `path:line` click. Goes through the line-selection controller
   *  so the right-click "Copy path:N" menu reflects the highlight. */
  initialSelectedLines?: SelectedLineRange | null;
};

const BrowseFileView: Component<BrowseFileViewProps> = (props) => {
  // One file = one-element items array. The wrapper still handles
  // virtualization, version-tracked content updates, and selection — Pierre
  // doesn't distinguish the single-item case at the API boundary.
  const items = createMemo<CodeViewItem[]>(() => [
    fileItem(props.filePath, props.filePath, props.content),
  ]);

  return (
    <>
      <Show when={props.truncated}>
        <div class="px-2 py-1 text-warning text-[10px] border-b border-edge bg-surface-1/30">
          File truncated (exceeds 1 MB)
        </div>
      </Show>
      <CodeMenuFrame
        path={props.filePath}
        initialSelectedLines={props.initialSelectedLines}
      >
        {(lineSelection) => {
          const codeViewSelection = useCodeViewSelection(
            () => props.filePath,
            lineSelection.range,
          );
          return (
            <CodeView
              items={items()}
              theme={props.theme}
              overflow="wrap"
              enableLineSelection
              selectedLines={codeViewSelection()}
              onSelectedLinesChange={(s) =>
                lineSelection.handleSelect(s?.range ?? null)
              }
              onError={(err) =>
                toast.error(`File render failed: ${err.message}`)
              }
              class="h-full w-full overflow-auto"
              {...koluCodeViewProps()}
              data-testid="pierre-file-view"
            />
          );
        }}
      </CodeMenuFrame>
    </>
  );
};

export default BrowseFileView;
