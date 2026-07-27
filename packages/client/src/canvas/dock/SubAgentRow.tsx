/** An agent running in a SPLIT, as an indented entry under the dock row for the
 *  terminal it lives in.
 *
 *  A split is a whole second terminal, and the dock had no row for one — so an
 *  agent working in a split was counted by its host's tab and visible nowhere
 *  in the dock. That is how a tab read 4 above three rows, with the fourth
 *  agent reachable only by clicking into terminals one at a time. This is the
 *  row it never had.
 *
 *  Indented rather than promoted to a peer row, deliberately: a split IS
 *  subordinate to the terminal holding it, and flattening it would break the
 *  one-to-one correspondence between a top-level row and its `Cmd+N` shortcut.
 *  Clicking it goes all the way — the parent tile, then the split's own pane,
 *  focused — rather than dropping you on the parent to hunt for the tab.
 *
 *  ONE component for both dock surfaces (unlike `DockRow`/`DockListRow`, which
 *  are deliberately separate): a sub-entry is a single line with no shortcut
 *  hint, no PR pip, and no drawer-drag gesture to intercept, so the divergence
 *  axes that keep those two apart simply don't arise here. Touch density rides
 *  in on `padClass`. */

import { activeArm } from "@kolu/padi/surface";
import { StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import { cwdBasename } from "kolu-common/path";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { annotationLine } from "../../intent/text";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { dockRowAttrs } from "./dockRowAttrs";
import type { DockRowBucket } from "./dockRowRanking";
import { useDockFocus } from "./useDockFocus";

export const SubAgentRow: Component<{
  id: TerminalId;
  /** The terminal whose split this is — the tile a click activates first. */
  parentId: TerminalId;
  /** ORDER bucket — `data-bucket`, for ordering tests. The attention wash is
   *  keyed on the attention class off the bound pip, not on this. */
  bucket: DockRowBucket;
  /** PAINT bucket — the same fold the parent row's pip reads. */
  pip: DockRowBucket;
  /** Vertical padding, the one per-surface pixel (touch wants more). */
  padClass?: string;
  /** Called after the jump lands — the mobile drawer closes itself here, the
   *  same seam the touch row uses. */
  onSelected?: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const focus = useDockFocus();
  const meta = () => store.getMetadata(props.id);
  // A split agent that finished while you were away is unread exactly as a
  // tile's agent is — the whole justification for this row is that an agent in
  // a split IS an agent. Hard-coding `false` here had the section header count
  // an amber 1 while the row directly beneath it wore no badge at all.
  const unread = () => store.isUnread(props.id);
  // A sub-terminal has no `TerminalDisplayInfo` (that projection covers
  // top-level terminals only), so the label comes off its own metadata: its
  // intent when it has one, else the directory it sits in.
  const label = () => {
    const m = meta();
    if (!m) return "terminal";
    return annotationLine(m.intent, cwdBasename(m.cwd));
  };
  const open = () => {
    focus(props.id);
    props.onSelected?.();
  };
  return (
    <Show when={meta()}>
      {(m) => {
        const pip = useStatePip(
          encActiveHost,
          () => props.id,
          m,
          unread,
          () => props.pip,
        );
        return (
          <button
            type="button"
            data-testid="dock-sub-agent-row"
            // The shared row contract (`dockRowAttrs`) — the wash hook and its
            // state attributes in ONE bag, so this surface cannot spell five of
            // six and land silently outside a stylesheet rule. It did exactly
            // that: it set `data-asking` and got no wash at all, which is the
            // one row type that represents "an agent nobody could see".
            {...dockRowAttrs({
              id: props.id,
              bucket: props.bucket,
              agentState: activeArm(m())?.agent?.state,
              // A sub-entry is never the active row — activating it activates
              // the PARENT tile and then focuses the split, so the highlight
              // (and the wash's `:not([data-active])` suppression) belongs to
              // the row above. Said out loud rather than omitted.
              active: false,
              asking: pip().asking,
              unread: unread(),
            })}
            data-parent-id={props.parentId}
            class={`relative w-full col-span-full flex items-center gap-1.5 pl-7 pr-2 ${props.padClass ?? "py-1"} text-left cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 hover:bg-surface-2/40`}
            onClick={(e) => {
              // The parent row underneath activates the terminal; this entry
              // means the split, so its click must not also be that one.
              e.stopPropagation();
              open();
            }}
            title="Jump to this split"
          >
            {/* The elbow reads as "inside the row above" at a glance — the
             *  indent alone is ambiguous next to a wrapped label. */}
            <span
              aria-hidden="true"
              class="font-mono text-[0.6rem] leading-none text-fg-3/70 select-none"
            >
              └
            </span>
            <StatePip {...pip()} class={DOCK_ROW_PIP_BOX} />
            <span class="text-[0.72rem] text-fg-2 truncate min-w-0">
              <IntentMarkdownInline markdown={label()} />
            </span>
          </button>
        );
      }}
    </Show>
  );
};
