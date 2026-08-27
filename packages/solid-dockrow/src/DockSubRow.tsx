/** A SPLIT terminal, indented directly beneath the row for its parent — its
 *  REAL parent, which may itself be a split: `depth` steps the indent one notch
 *  per hop, so a split of a split reads as one.
 *
 *  Every split gets the same StatePip fold a top-level row uses — identity
 *  glyph, paint, motion, unread. Unread passthrough matters when an agent exits
 *  while still unread: the row re-ranks as a shell but the amber badge must
 *  survive until the user lands. A shell cannot ask (the wash still requires
 *  `asking`), but it is not a second, pip-less contract.
 *
 *  A single line, not two: a split has no display identity of its own (no repo
 *  key, no branch, no PR of its own to badge), so the two-line row's second
 *  line would be reserved space with nothing to put in it. It is a real
 *  `<button>` for the same reason — nothing inside it is a link. */

import { StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Component, JSX } from "solid-js";
import {
  DOCK_ROW_FOCUS_RING,
  DOCK_ROW_SURFACE,
  DOCK_ROW_STRIPE_CLASS,
  type DockRowSurface,
} from "./geometry.ts";
import type { DockRowBucket, StatePipBind } from "./pipBind.ts";
import { dockRowAttrs } from "./rowAttrs.ts";
import { RowLabel } from "./RowLabel.tsx";

export const DockSubRow: Component<{
  id: TerminalId;
  /** The terminal this split hangs under — its real parent, split or tile. */
  parentId: TerminalId;
  /** Hops from the top-level tile: 1 for a split, 2 for a split of a split. */
  depth: number;
  surface: DockRowSurface;
  pip: StatePipBind;
  bucket: DockRowBucket;
  /** The agent state VERBATIM (`data-agent-state`). A plain `string`: a
   *  consumer whose wire carries it as text narrows the closed literal out with
   *  `narrowAgentState` and passes the raw word here, known or not. */
  agentState: string | undefined;
  label: string;
  renderLabel: (markdown: string) => JSX.Element;
  onSelect: () => void;
  active?: boolean;
  testId?: string;
  title?: string;
  onPointerDown?: (event: PointerEvent) => void;
}> = (props) => (
  <button
    type="button"
    data-testid={props.testId}
    {...dockRowAttrs(props)}
    data-parent-id={props.parentId}
    data-depth={props.depth}
    // Sub-entries are flat DOM siblings inside the section grid, so the indent
    // IS the tree: a split of a split steps one notch further in, under the
    // split it actually belongs to. Inline (not a Tailwind class) because depth
    // is unbounded — no class list can enumerate it.
    style={{ "padding-left": `${1.75 + (props.depth - 1) * 0.75}rem` }}
    class={`relative w-full col-span-full flex items-center gap-1.5 pr-2 ${DOCK_ROW_SURFACE[props.surface].subRowPad} ${DOCK_ROW_STRIPE_CLASS} text-left cursor-pointer transition-colors duration-150 ${DOCK_ROW_FOCUS_RING} hover:bg-surface-2/40`}
    onPointerDown={props.onPointerDown}
    onClick={() => props.onSelect()}
    title={props.title}
  >
    <span
      aria-hidden="true"
      class="font-mono text-[0.6rem] leading-none text-fg-3/70 select-none"
    >
      └
    </span>
    <StatePip {...props.pip} class={DOCK_ROW_PIP_BOX} />
    <RowLabel
      markdown={props.label}
      render={props.renderLabel}
      class="text-[0.72rem] text-fg-2 truncate min-w-0"
    />
  </button>
);
