/** Tiny inline icons rendered on every dock row.
 *
 *  Three exports, one per slot the row needs:
 *
 *    - `AgentSlot` — first column. Always renders a grid cell so
 *      subgrid placement stays stable; empty for rows without an
 *      agent. The bucket dot encodes state via colour + animation
 *      (`awaiting` pulses, `working` spins), so a single icon does
 *      double duty as "which agent" + "what is it doing now".
 *    - `PrPip` — leading glyph on row line 2. Inline (not a grid
 *      cell): wherever the caller puts it, the PR icon sits at that
 *      X. We put it at the left edge of line 2, before the subline
 *      text. That gives one consistent X-position for the PR pip
 *      across every section regardless of how the section's right-
 *      side columns sized themselves. PR is a real `<a>` to
 *      `pr.url` — Cmd-click opens GitHub directly; the row's outer
 *      click handler doesn't intercept (stopPropagation). Tooltip
 *      via `prTooltip` carries the multi-line checks breakdown.
 *    - `SubCountCell` — last column of line 1 (when sub-terminals
 *      exist). Empty span when count is 0 so the column collapses
 *      and gives its width back to the branch label. */

import type { AgentInfo, TerminalMetadata } from "kolu-common/surface";
import { type GitHubPrInfo, prValue } from "kolu-github/schemas";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { agentBucket, bucketDescriptor } from "../dockModel";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import { prTooltip } from "../../terminal/prTooltip";
import { agentIcons, stateLabels } from "../../ui/agentDisplay";
import { PrStateIcon } from "../../ui/Icons";
import { SubCountChip } from "./SubCountChip";

/** Pip animation by bucket — `working` spins (continuous motion),
 *  `awaiting` pulses (rhythmic attention). The bucket→colour mapping
 *  lives in `AGENT_BUCKETS` (`canvas/dockModel.ts`); we derive it
 *  through `bucketDescriptor` rather than re-declaring colours
 *  here, so the dock pip, the workspace switcher's column header,
 *  and the canvas minimap all read the same "alert orange = needs
 *  you / accent = alive" cue from one source. Animation is the only
 *  channel the dock owns that the other surfaces don't, so it stays
 *  local. */
const PIP_ANIM_BY_BUCKET: Record<"awaiting" | "working", string> = {
  awaiting: "animate-pulse",
  working: "animate-spin",
};

function pipConfig(agent: AgentInfo): { color: string; animation: string } {
  const bucket = agentBucket(agent);
  if (bucket === "awaiting" || bucket === "working") {
    return {
      color: bucketDescriptor(bucket).textClass,
      animation: PIP_ANIM_BY_BUCKET[bucket],
    };
  }
  // `agentBucket` only returns `awaiting`/`working`/`none` for the
  // four live states; the `none` arm is unreachable when an
  // `AgentInfo` is in hand but the type isn't aware. Return a
  // neutral fallback so the pip stays visible.
  return { color: bucketDescriptor("none").textClass, animation: "" };
}

/** Inline PR pip — leading glyph on row line 2. Caller controls
 *  layout (typically a flex container alongside the subline text).
 *  Renders nothing when there's no PR. */
export const PrPip: Component<{ meta: TerminalMetadata }> = (props) => {
  const pr = (): GitHubPrInfo | null => prValue(props.meta.pr);
  return (
    <Show when={pr()}>
      {(p) => (
        <a
          href={p().url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="dock-row-pr-pip"
          class="flex items-center gap-1 text-fg-3 hover:text-fg transition-colors shrink-0"
          title={prTooltip(p())}
          onClick={(e) => e.stopPropagation()}
        >
          <PrStateIcon state={p().state} class="w-3 h-3" />
          <Show when={p().checks}>
            {(checks) => <ChecksIndicator status={checks()} />}
          </Show>
        </a>
      )}
    </Show>
  );
};

/** Sub-count cell — grid cell on line 1. Empty span collapses to 0
 *  width when this row has no sub-terminals, so the column gives
 *  its width back to the branch label. */
export const SubCountCell: Component<{ subCount: number }> = (props) => (
  <span class="flex items-center justify-end">
    <Show when={props.subCount > 0}>
      <SubCountChip
        count={props.subCount}
        active={false}
        testId="dock-sub-count"
      />
    </Show>
  </span>
);

/** First-column agent slot. Always renders a cell so subgrid placement
 *  stays stable; the cell is empty for rows without an agent. */
export const AgentSlot: Component<{
  agent: TerminalMetadata["agent"];
}> = (props) => (
  <span class="flex items-center justify-center">
    <Show when={props.agent}>{(agent) => <AgentPip agent={agent()} />}</Show>
  </span>
);

const AgentPip: Component<{ agent: AgentInfo }> = (props) => {
  const Icon = () => agentIcons[props.agent.kind];
  const cfg = () => pipConfig(props.agent);
  return (
    <span
      class={`shrink-0 inline-flex ${cfg().color} ${cfg().animation}`}
      data-testid="dock-row-agent-pip"
      data-agent-kind={props.agent.kind}
      data-agent-state={props.agent.state}
      title={`${props.agent.kind} · ${stateLabels[props.agent.state]}`}
    >
      <Dynamic component={Icon()} class="w-3 h-3" />
    </span>
  );
};
