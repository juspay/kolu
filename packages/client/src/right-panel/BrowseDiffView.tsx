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
  terminalId: TerminalId;
  path: string;
  hunk: string;
  theme: "light" | "dark";
  repoRoot: string;
};

const BrowseDiffView: Component<BrowseDiffViewProps> = (props) => {
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
