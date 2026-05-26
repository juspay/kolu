/** Tiny inline icons rendered on inactive dock rows so the row scans
 *  as "has a PR, has an agent, has sub-terminals" without unfolding
 *  the full chrome.
 *
 *  Each pip is presence-only — no number, no label, no token count.
 *  The active row hides these and instead reveals the full
 *  `AgentIndicator` + `PrLine` detail line below the row. The bucket
 *  dot already encodes agent state (awaiting / working / idle), so
 *  the agent pip carries only the agent kind (Claude Code / Codex /
 *  OpenCode logo). */

import type { AgentInfo, TerminalMetadata } from "kolu-common/surface";
import { prValue } from "kolu-github/schemas";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { agentIcons } from "../../ui/agentDisplay";
import { PrStateIcon } from "../../ui/Icons";
import { SubCountChip } from "./SubCountChip";

export const RowIcons: Component<{
  meta: TerminalMetadata;
  info: TerminalDisplayInfo;
}> = (props) => {
  const pr = () => prValue(props.meta.pr);
  return (
    <>
      <Show when={pr()}>
        {(p) => (
          <span
            class="flex items-center gap-1"
            data-testid="dock-row-pr-pip"
            title={`PR #${p().number}`}
          >
            <PrStateIcon state={p().state} class="w-3 h-3 text-fg-3" />
            <Show when={p().checks}>
              {(checks) => <ChecksIndicator status={checks()} />}
            </Show>
          </span>
        )}
      </Show>
      <Show when={props.meta.agent}>
        {(agent) => <AgentPip agent={agent()} />}
      </Show>
      <Show when={props.info.subCount > 0}>
        <SubCountChip
          count={props.info.subCount}
          active={false}
          testId="dock-sub-count"
        />
      </Show>
    </>
  );
};

const AgentPip: Component<{ agent: AgentInfo }> = (props) => {
  const Icon = () => agentIcons[props.agent.kind];
  return (
    <span
      class="shrink-0 text-fg-3"
      data-testid="dock-row-agent-pip"
      data-agent-kind={props.agent.kind}
      title={props.agent.kind}
    >
      <Dynamic component={Icon()} class="w-3 h-3" />
    </span>
  );
};
