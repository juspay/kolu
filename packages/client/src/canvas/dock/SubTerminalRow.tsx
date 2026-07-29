/** A split terminal, indented directly beneath the dock row for its parent.
 *
 * Every split gets a landing row and the same StatePip fold a top-level row
 * uses — identity glyph, paint, motion, unread. A shell cannot ask (attention
 * wash still requires `asking`), but it is not a second, pip-less contract.
 * One component serves desktop and touch because the row has no shortcut hint,
 * PR link, or drawer gesture of its own. */

import { activeArm } from "@kolu/padi/surface";
import { StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import { cwdBasename } from "kolu-common/path";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { dockRowAttrs } from "./dockRowAttrs";
import type { RankedDockRow } from "./dockRowRanking";

export const SubTerminalRow: Component<{
  row: RankedDockRow["subRows"][number];
  onSelect: (id: TerminalId) => void;
  surface: "desktop" | "touch";
}> = (props) => {
  const store = useTerminalStore();
  const meta = () => store.getMetadata(props.row.id);
  const unread = () => store.isUnread(props.row.id);
  const label = () => {
    const value = meta();
    return value
      ? annotationLine(value.intent, cwdBasename(value.cwd))
      : "terminal";
  };
  return (
    <Show when={meta()}>
      {(m) => {
        const parentId = m().parentId;
        if (!parentId) {
          throw new Error(
            `SubTerminalRow: ${props.row.id} has no parent terminal`,
          );
        }
        // Same unconditional binder as DockRow / DockListRow — one fold for
        // "what does this row's leading indicator show", kind never re-gates it.
        const agent = () => activeArm(m())?.agent;
        const pip = useStatePip(
          encActiveHost,
          () => props.row.id,
          m,
          unread,
          () => props.row.pip,
        );
        return (
          <button
            type="button"
            data-testid="dock-sub-row"
            {...dockRowAttrs({
              id: props.row.id,
              bucket: props.row.bucket,
              agentState: agent()?.state,
              asking: pip().asking,
              unread: unread(),
            })}
            data-parent-id={parentId}
            class={`relative w-full col-span-full flex items-center gap-1.5 pl-7 pr-2 ${props.surface === "touch" ? "py-2" : "py-1"} border-l-[length:var(--dock-edge-stripe-w)] border-l-transparent text-left cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 hover:bg-surface-2/40`}
            onPointerDown={(event) => {
              if (props.surface === "touch") event.stopPropagation();
            }}
            onClick={() => props.onSelect(props.row.id)}
            title="Jump to this split"
          >
            <span
              aria-hidden="true"
              class="font-mono text-[0.6rem] leading-none text-fg-3/70 select-none"
            >
              └
            </span>
            <StatePip {...pip()} class={DOCK_ROW_PIP_BOX} />
            <span class="dock-cards-row-label text-[0.72rem] text-fg-2 truncate min-w-0">
              <IntentMarkdownInline markdown={label()} />
            </span>
          </button>
        );
      }}
    </Show>
  );
};
