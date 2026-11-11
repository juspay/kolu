/** The files a tool call rewrote, drawn by Pierre — the same renderer the Code
 *  tab uses, so a diff looks the same wherever kolu shows one.
 *
 *  The wire carries a file as a path and TWO TEXTS, which is what ACP itself
 *  carries; the line diff is a view-time computation, and
 *  `@kolu/solid-pierre`'s `textDiffItem` is where that computation lives — one
 *  seam over `@pierre/diffs`, hashing both texts into the cache identity so an
 *  agent that rewrites the same path twice in a turn gets two highlight
 *  targets rather than a card still painting its first snapshot.
 *
 *  TRIMMED by default. A card in a conversation is a mention of a change, not a
 *  review of it: the box opens to a few lines and expands on a press, so a turn
 *  that rewrote six files stays readable. */

import type { FileDiff } from "kolu-common/orchestrator";
import { CodeView, textDiffItem } from "@kolu/solid-pierre";
import { type Component, createMemo, createSignal, For } from "solid-js";
import { toast } from "solid-sonner";
import { useColorScheme } from "../settings/useColorScheme";
import { koluCodeViewProps } from "../ui/pierreTheme";

const OrchestratorDiffs: Component<{
  /** The row the diffs belong to — part of each item's id, so two rows that
   *  touched one path never collide in Pierre's viewport. */
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

  return (
    <div
      data-testid="orchestrator-diff"
      data-path={props.diff.path}
      class="rounded-md border border-edge overflow-hidden"
    >
      <button
        type="button"
        data-testid="orchestrator-diff-toggle"
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
        // Never a blank box: a render throw goes to the same toast lane the
        // Code tab's diffs use, where a blank one would be indistinguishable
        // from "nothing changed".
        onError={(err: Error) =>
          toast.error(`Diff render failed: ${err.message}`)
        }
        class="w-full overflow-auto"
        {...koluCodeViewProps()}
        // AFTER the spread: the kolu diffs style is the inseparable half of the
        // row-height invariant and must not be dropped, while the height cap is
        // this surface's own — so the two are merged rather than one winning.
        style={{
          ...koluCodeViewProps().style,
          "max-height": expanded() ? "28rem" : "8rem",
        }}
      />
    </div>
  );
}

export default OrchestratorDiffs;
