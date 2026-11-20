import {
  CodeView,
  type CodeViewItem,
  fileItem,
  type SelectedLineRange,
  useCodeViewSelection,
} from "@kolu/solid-pierre";
import { type Component, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { koluCodeViewProps } from "../ui/pierreTheme";
import CodeMenuFrame from "./CodeMenuFrame";

export type BrowseFileViewProps = {
  filePath: string;
  content: string;
  theme: "light" | "dark";
  initialSelectedLines?: SelectedLineRange | null;
};

const BrowseFileView: Component<BrowseFileViewProps> = (props) => {
  const items = createMemo<CodeViewItem[]>(() => [
    fileItem(props.filePath, props.filePath, props.content),
  ]);

  return (
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
            onError={(err) => toast.error(`File render failed: ${err.message}`)}
            class="h-full w-full overflow-auto"
            {...koluCodeViewProps()}
            data-testid="pierre-file-view"
          />
        );
      }}
    </CodeMenuFrame>
  );
};

export default BrowseFileView;
