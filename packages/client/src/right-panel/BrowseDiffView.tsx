/** Pure presenter for a single file's unified diff in the Code tab's local/
 *  branch modes. Renders Pierre's `CodeView` (single diff item) wrapped in the
 *  kolu line-selection + "Copy path:N" menu (`CodeMenuFrame`).
 *
 *  Sibling to `BrowseFileView` (the source presenter): neither knows about
 *  comments. The comment capture surface is applied one level up at the seam
 *  that renders them — `CommentTextSurface` in `CodeTab` for the diff,
 *  `withComments` in `BrowseFileDispatcher` for source — so "is this
 *  commentable?" is decided in one place, never re-open-coded per view. */

import {
  CodeView,
  type CodeViewItem,
  diffItem,
  useCodeViewSelection,
} from "@kolu/solid-pierre";
import { type Component, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { koluCodeViewProps } from "../ui/pierreTheme";
import CodeMenuFrame from "./CodeMenuFrame";
import { openInCodeTab } from "./openInCodeTab";

export type BrowseDiffViewProps = {
  /** Repo-relative path the diff is for — anchors the line-selection menu. */
  path: string;
  /** The unified-diff hunk text for this file (Pierre parses it). */
  hunk: string;
  theme: "light" | "dark";
  /** Repo root, for the context-menu "Open" → jump-to-browse action. */
  repoRoot: string;
};

const BrowseDiffView: Component<BrowseDiffViewProps> = (props) => {
  // Single-file diff → one-element items array. The wrapper virtualizes long
  // diffs internally (50k-line lockfile, #809 / #514 Phase 8) — no separate
  // scroll context component required.
  const items = createMemo<CodeViewItem[]>(() => {
    const item = diffItem(props.path, props.hunk, (err) =>
      toast.error(`Diff parse failed: ${err.message}`),
    );
    return item ? [item] : [];
  });

  return (
    <CodeMenuFrame
      path={props.path}
      onOpen={(ref) =>
        openInCodeTab({ ref, repoRoot: props.repoRoot, targetMode: "browse" })
      }
    >
      {(selection) => {
        const codeViewSelection = useCodeViewSelection(
          () => props.path,
          selection.range,
        );
        return (
          <CodeView
            items={items()}
            theme={props.theme}
            diffStyle="unified"
            enableLineSelection
            selectedLines={codeViewSelection()}
            onSelectedLinesChange={(s) =>
              selection.handleSelect(s?.range ?? null)
            }
            onError={(err) => toast.error(`Diff render failed: ${err.message}`)}
            class="h-full w-full overflow-auto"
            {...koluCodeViewProps()}
            data-testid="pierre-diff-view"
          />
        );
      }}
    </CodeMenuFrame>
  );
};

export default BrowseDiffView;
