import type { FileDiff } from "kolu-common/conductor";
import { CodeView, textDiffItem } from "@kolu/solid-pierre";
import { type Component, createMemo, createSignal, For } from "solid-js";
import { toast } from "solid-sonner";
import { useColorScheme } from "../settings/useColorScheme";
import { koluCodeViewProps } from "../ui/pierreTheme";

const ConductorDiffs: Component<{
  rowId: string;
  diffs: readonly FileDiff[];
}> = (props) => {
  const { colorScheme } = useColorScheme();

  return (
    <div class="col-span-full space-y-1.5">
      <For each={props.diffs}>
        {(diff) => (
          <DiffBox
            id={`${props.rowId}:${diff.path}`}
            diff={diff}
            theme={colorScheme() === "light" ? "light" : "dark"}
          />
        )}
      </For>
    </div>
  );
};

function DiffBox(props: {
  id: string;
  diff: FileDiff;
  theme: "light" | "dark";
}) {
  const [expanded, setExpanded] = createSignal(false);
  const items = createMemo(() => [
    textDiffItem(
      props.id,
      props.diff.path,
      // `null` is the protocol's own way of saying the file did not exist — a
      // distinction the seam draws, rather than one flattened here into an
      // empty old file.
      props.diff.oldText,
      props.diff.newText,
    ),
  ]);
  const cappedCodeViewProps = createMemo(() => {
    const base = koluCodeViewProps();
    return {
      ...base,
      style: { ...base.style, "max-height": expanded() ? "28rem" : "8rem" },
    };
  });

  return (
    <div
      data-testid="conductor-diff"
      data-path={props.diff.path}
      class="rounded-md border border-edge overflow-hidden"
    >
      <button
        type="button"
        data-testid="conductor-diff-toggle"
        class="w-full flex items-center gap-2 px-2 py-1 bg-surface-2 text-left font-mono text-[0.65rem] text-fg-2 cursor-pointer hover:text-fg"
        onClick={() => setExpanded(!expanded())}
      >
        <span>{expanded() ? "▾" : "▸"}</span>
        <span class="truncate">{props.diff.path}</span>
      </button>
      <CodeView
        items={items()}
        theme={props.theme}
        diffStyle="unified"
        onError={(err: Error) =>
          toast.error(`Diff render failed: ${err.message}`)
        }
        class="w-full overflow-auto"
        {...cappedCodeViewProps()}
      />
    </div>
  );
}

export default ConductorDiffs;
