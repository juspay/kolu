import { StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { DOCK_ROW_FOCUS_RING, type NeedsYouDensity } from "./geometry.ts";
import { type Component, type JSX, Show } from "solid-js";
import type { DockRowBucket, StatePipBind } from "./pipBind.ts";
import { RecencyCell, type RowRecency } from "./RecencyCell.tsx";
import { dockRowAttrs } from "./rowAttrs.ts";
import { RowLabel } from "./RowLabel.tsx";

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
    {...dockRowAttrs(props)}
    data-tile-id={props.tileId}
    onClick={() => props.onSelect()}
    title={props.title}
    class={`flex items-center gap-1.5 w-full rounded-md cursor-pointer text-left transition-colors duration-150 ${DOCK_ROW_FOCUS_RING} ${
      props.density === "icon" ? "justify-center py-1" : "px-1.5 py-1"
    }`}
    classList={{ "opacity-70": props.hiddenByFilter ?? false }}
  >
    <StatePip {...props.pip} class={DOCK_ROW_PIP_BOX} />
    <Show when={props.density === "full"}>
      <RowLabel
        markdown={props.label}
        render={props.renderLabel}
        class="flex-1 text-[0.8rem]"
        color={props.labelColor}
      />
      <RecencyCell recency={props.recency} textSize="text-[0.6rem]" />
    </Show>
  </button>
);
