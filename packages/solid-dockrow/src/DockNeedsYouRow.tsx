/** ONE entry in the pinned NEEDS-YOU strip — a terminal whose agent is blocked
 *  on you, mirrored into a fixed place above the ordinary rows.
 *
 *  It is a MIRROR: the entry sits above a row that is still in its own
 *  structural slot below, wearing its own shortcut number, and clicking either
 *  goes to the same place. So it reads the same pip binding and the same recency
 *  cell the structural row does — the whole point of a mirror is that it agrees
 *  with what it mirrors — and it carries the SAME `dockRowAttrs` contract. It
 *  used to carry none of it, so the one surface literally named "Needs you" was
 *  the one dock surface outside the `[data-asking]` wash vocabulary, and it
 *  failed silently, by rendering plainer than every other row.
 *
 *  Two densities of its own, and they are a different axis from
 *  `DockRowDensity`: this one is about how much of the entry there is ROOM for.
 *  `icon` is a 44 px rail — pip alone, the label and the wait capsule dropped,
 *  the duration moved into the tooltip (an unlabelled band of pips is not the
 *  feature). `full` shows all three. */

import { StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { type Component, type JSX, Show } from "solid-js";
import type { DockRowBucket, StatePipBind } from "./pipBind.ts";
import { RecencyCell, type RowRecency } from "./RecencyCell.tsx";
import { dockRowAttrs } from "./rowAttrs.ts";
import { RowLabel } from "./RowLabel.tsx";

/** How much of an entry there is room for. Named for the axis, not for the
 *  caller: a touch surface's persistent left rail takes `"full"`, because what
 *  a desktop dock's rail mode really means here is "44 px, icons only". */
export type NeedsYouDensity = "icon" | "full";

export const DockNeedsYouRow: Component<{
  /** The BLOCKED terminal — the one whose pip, wait and landing this entry
   *  names. When a split is the one asking, that is the split, not its parent:
   *  naming one agent and navigating to another is the same lie as painting the
   *  wrong clock. */
  id: TerminalId;
  /** The TILE this entry lands on and takes its display identity from. A split
   *  has no display identity of its own, which is precisely why the pair
   *  exists. */
  tileId: TerminalId;
  density: NeedsYouDensity;
  pip: StatePipBind;
  bucket: DockRowBucket;
  /** The agent state VERBATIM (`data-agent-state`). A plain `string`: a
   *  consumer whose wire carries it as text narrows the closed literal out with
   *  `narrowAgentState` and passes the raw word here, known or not. */
  agentState: string | undefined;
  /** The TILE's annotation line. */
  label: string;
  labelColor: string;
  renderLabel: (markdown: string) => JSX.Element;
  /** The BLOCKED row's own wait — never the tile-wide fold. */
  recency: RowRecency;
  /** Where the entry is + how long it has waited; at `icon` density this is the
   *  only place the duration survives. */
  title: string;
  onSelect: () => void;
  active?: boolean;
  /** The dock's filters are hiding the structural row this mirrors. */
  hiddenByFilter?: boolean;
  testId?: string;
}> = (props) => (
  <button
    type="button"
    data-testid={props.testId}
    {...dockRowAttrs({
      id: props.id,
      bucket: props.bucket,
      agentState: props.agentState,
      asking: props.pip.asking,
      unread: props.pip.alert,
      active: props.active ?? false,
    })}
    // The tile this entry lands on — distinct from `data-terminal-id` above,
    // which names the row the pip and the wait come off.
    data-tile-id={props.tileId}
    onClick={() => props.onSelect()}
    title={props.title}
    class={`flex items-center gap-1.5 w-full rounded-md cursor-pointer text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
      props.density === "icon" ? "justify-center py-1" : "px-1.5 py-1"
    }`}
    classList={{ "opacity-70": props.hiddenByFilter ?? false }}
  >
    <StatePip {...props.pip} class={DOCK_ROW_PIP_BOX} />
    <Show when={props.density === "full"}>
      {/* The SHARED label class, not three of its six rules re-spelled as
       *  utilities: `[data-dock-row]:is([data-unread],[data-asking])
       *  .dock-cards-row-label` lifts a blocked row's label to weight 700, these
       *  entries carry both attributes, and so that rule was already targeting
       *  them and finding no element. It supplies `min-width:0` and the ellipsis
       *  too, so `flex-1` is all that is left to add. */}
      <RowLabel
        markdown={props.label}
        render={props.renderLabel}
        class="flex-1 text-[0.8rem]"
        color={props.labelColor}
      />
      {/* The violet wait capsule — how long it has been blocked. The one number
       *  that makes this strip worth glancing at, and the same cell the row
       *  below renders. */}
      <RecencyCell recency={props.recency} textSize="text-[0.6rem]" />
    </Show>
  </button>
);
