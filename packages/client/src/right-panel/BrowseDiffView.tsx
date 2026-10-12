/** Pure presenter for a single path's unified diff in the Code tab's local/
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
  diffItems,
  useCodeViewSelection,
} from "@kolu/solid-pierre";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { koluCodeViewProps } from "../ui/pierreTheme";
import CodeMenuFrame from "./CodeMenuFrame";
import { openInCodeTab } from "./openInCodeTab";

export type BrowseDiffViewProps = {
  /** Terminal whose per-terminal Code-tab selection the open mutates. */
  terminalId: TerminalId;
  /** Repo-relative path the diff is for — anchors the line-selection menu. */
  path: string;
  /** The unified-diff hunk text for this file (Pierre parses it). */
  hunk: string;
  theme: "light" | "dark";
  /** Repo root, for the context-menu "Open" → jump-to-browse action. */
  repoRoot: string;
};

const BrowseDiffView: Component<BrowseDiffViewProps> = (props) => {
  // Usually one file; a type-changed path (a directory replaced by a file)
  // also carries the files that used to live under it — see `diffItems`. The
  // wrapper virtualizes long diffs internally (50k-line lockfile, #809 / #514
  // Phase 8) — no separate scroll context component required.
  const items = createMemo<CodeViewItem[]>(() =>
    diffItems(props.path, props.hunk, (err) =>
      toast.error(`Diff parse failed: ${err.message}`),
    ),
  );

  return (
    <CodeMenuFrame
      path={props.path}
      onOpen={(ref) =>
        openInCodeTab({
          terminalId: props.terminalId,
          ref,
          targetMode: "browse",
        })
      }
    >
      {(selection) => {
        // Keyed by the selection's own file, so a range on a former child
        // highlights on that child and the menu names it.
        const codeViewSelection = useCodeViewSelection(
          selection.path,
          selection.range,
        );
        return (
          <CodeView
            items={items()}
            theme={props.theme}
            diffStyle="unified"
            enableLineSelection
            selectedLines={codeViewSelection()}
            // Each item's id is its own path (`diffItems`), so the line
            // menu's "Copy path:N" and "Open" point at the file the user
            // selected in — the type-changed path itself or a former child.
            onSelectedLinesChange={(s) =>
              selection.handleSelect(s?.range ?? null, s?.id)
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
