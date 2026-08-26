/** A split terminal, indented directly beneath the dock row for its parent —
 * its REAL parent, which may itself be a split: `row.depth` steps the indent in
 * one notch per hop, so a split of a split reads as one.
 *
 * Every split gets a landing row and the same StatePip fold a top-level row
 * uses — identity glyph, paint, motion, unread. Unread passthrough matters
 * when an agent exits while still unread: the row re-ranks as a shell but the
 * amber badge must survive until the user lands. A shell cannot ask (wash
 * still requires `asking`), but it is not a second, pip-less contract. One
 * component serves desktop and touch because the row has no shortcut hint, PR
 * link, or drawer gesture of its own. */

import { activeArm } from "@kolu/padi-client/surface";
import { StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import { cwdBasename } from "@kolu/terminal-vocab/terminalKey";
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
        const label = () => annotationLine(m().intent, cwdBasename(m().cwd));
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
              agentState: activeArm(m())?.agent?.state,
              asking: pip().asking,
              unread: unread(),
            })}
            data-parent-id={parentId}
            data-depth={props.row.depth}
            // Sub-entries are flat DOM siblings inside the section grid, so the
            // indent IS the tree: a split of a split steps one notch further in,
            // under the split it actually belongs to. Inline (not a Tailwind
            // class) because depth is unbounded — no class list can enumerate it.
            style={{
              "padding-left": `${1.75 + (props.row.depth - 1) * 0.75}rem`,
            }}
            class={`relative w-full col-span-full flex items-center gap-1.5 pr-2 ${props.surface === "touch" ? "py-2" : "py-1"} border-l-[length:var(--dock-edge-stripe-w)] border-l-transparent text-left cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 hover:bg-surface-2/40`}
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
