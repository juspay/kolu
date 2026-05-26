/** Tiny inline icons rendered on every dock row so the row scans as
 *  "has a PR, has an agent, has sub-terminals" without unfolding the
 *  full chrome.
 *
 *  Emits **three cells**, one per pip type, designed to sit directly
 *  inside `RepoSection`'s 6-column CSS-subgrid so the pip columns
 *  align vertically across every row in the section. When a column
 *  has no pip on any row in the section, the column auto-collapses
 *  to 0 (no width is reserved for slots nobody uses), so a section
 *  whose rows all lack PRs gives that width back to the branch
 *  label. Cells are empty `<span>`s rather than `<Show>`-conditional
 *  null so the subgrid placement stays stable: cell 3 is always PR,
 *  cell 4 is always agent, cell 5 is always sub-count.
 *
 *  Pips are presence-only — no number, no label, no token count. The
 *  bucket dot already encodes agent state (awaiting / working /
 *  idle), so the agent pip carries only the agent kind (Claude Code
 *  / Codex / OpenCode logo).
 *
 *  The PR pip is a link to `pr.url` — clicking opens the PR on
 *  GitHub directly. `stopPropagation` on the inner click keeps the
 *  dock row's `activate` handler from firing as well. Tooltip
 *  combines the PR label and the live checks verdict so a single
 *  hover surfaces `#123 Title — Checks: pending`. */

import type { AgentInfo, TerminalMetadata } from "kolu-common/surface";
import { type GitHubPrInfo, prValue } from "kolu-github/schemas";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { agentBucket, bucketDescriptor } from "../dockModel";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import { prTooltip } from "../../terminal/prTooltip";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
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
 *  local. (The tile chrome's `AgentIndicator` keeps its own
 *  state-level `warning`/`busy` palette so it can split `thinking`
 *  vs `tool_use` at full label size; the dock is bucket-only.) */
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

/** Right-side pips (PR + sub-count) — emitted as two grid cells that
 *  share columns with sibling rows in the section's subgrid. Agent
 *  pip is NOT here; it lives in the row's first column (see
 *  `AgentSlot`), so the row's most action-bearing icon sits at the
 *  left edge where the eye lands first. */
export const RowIcons: Component<{
  meta: TerminalMetadata;
  info: TerminalDisplayInfo;
}> = (props) => {
  const pr = (): GitHubPrInfo | null => prValue(props.meta.pr);
  return (
    <>
      <span class="flex items-center justify-end gap-1">
        <Show when={pr()}>
          {(p) => (
            <a
              href={p().url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="dock-row-pr-pip"
              class="flex items-center gap-1 text-fg-3 hover:text-fg transition-colors"
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
      </span>
      <span class="flex items-center justify-end">
        <Show when={props.info.subCount > 0}>
          <SubCountChip
            count={props.info.subCount}
            active={false}
            testId="dock-sub-count"
          />
        </Show>
      </span>
    </>
  );
};

/** First-column agent slot. Always renders a cell so subgrid placement
 *  stays stable; the cell is empty for rows without an agent (the
 *  section's first column then collapses to 0 width if no row in the
 *  section has an agent). */
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
