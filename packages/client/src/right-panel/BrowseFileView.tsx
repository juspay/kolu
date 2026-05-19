/** Pure presenter for a text file in the Code tab's browse mode. Receives
 *  the file body as props and renders Pierre's syntax-highlighted `FileView`
 *  wrapped in `CommentTextSurface` so character-range selections get the
 *  floating "+ Comment" pill and existing comments highlight in place.
 *
 *  Subscription, loading, error, and kind-dispatch live one level up in
 *  `BrowseFileDispatcher` so the views stay single-strategy. */

import {
  FileView,
  type SelectedLineRange,
  Virtualizer,
} from "@kolu/solid-pierre";
import { type Component, Show } from "solid-js";
import { toast } from "solid-sonner";
import { CommentTextSurface } from "../comments/CommentTextSurface";
import { pierreDiffsStyle } from "../ui/pierreTheme";
import CodeMenuFrame from "./CodeMenuFrame";

export type BrowseFileViewProps = {
  terminalId: string;
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
  return (
    <>
      <Show when={props.truncated}>
        <div class="px-2 py-1 text-warning text-[10px] border-b border-edge bg-surface-1/30">
          File truncated (exceeds 1 MB)
        </div>
      </Show>
      <CommentTextSurface
        terminalId={props.terminalId}
        path={props.filePath}
        contentTick={props.content}
        class="h-full w-full"
      >
        <CodeMenuFrame
          path={props.filePath}
          initialSelectedLines={props.initialSelectedLines}
        >
          {(lineSelection) => (
            // `<Virtualizer>` upgrades `<FileView>` to Pierre's
            // `VirtualizedFile` for very large files
            // (#809 / #514 Phase 8). Without it, `<FileView>` uses
            // the vanilla `File` class — same behavior as before.
            <Virtualizer
              class="h-full w-full overflow-auto"
              style={pierreDiffsStyle}
            >
              <FileView
                name={props.filePath}
                contents={props.content}
                theme={props.theme}
                overflow="wrap"
                enableLineSelection
                onLineSelected={lineSelection.handleSelect}
                selectedLines={lineSelection.range()}
                onError={(err) =>
                  toast.error(`File render failed: ${err.message}`)
                }
                class="w-full"
              />
            </Virtualizer>
          )}
        </CodeMenuFrame>
      </CommentTextSurface>
    </>
  );
};

export default BrowseFileView;
