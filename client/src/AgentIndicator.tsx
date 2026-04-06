/** AI agent state indicator — logo + state label. Logo animates when active.
 *  Renders the appropriate icon per agent kind (Claude Code, OpenCode). */

import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { AgentInfo, AgentState } from "kolu-common";
import { ClaudeCodeIcon, OpenCodeIcon } from "./Icons";

/** Busy = actively working (thinking or running tools). Warning = needs user input. */
const BUSY_COLOR = "text-[#D97757]";

const stateConfig: Record<
  AgentState,
  { color: string; animation: string; label: string }
> = {
  thinking: {
    color: BUSY_COLOR,
    animation: "animate-pulse",
    label: "Thinking",
  },
  tool_use: {
    color: BUSY_COLOR,
    animation: "animate-spin",
    label: "Running tools",
  },
  waiting: {
    color: "text-warning",
    animation: "animate-pulse",
    label: "Waiting",
  },
};

const agentIcons: Record<AgentInfo["kind"], Component<{ class?: string }>> = {
  "claude-code": ClaudeCodeIcon,
  opencode: OpenCodeIcon,
};

const agentNames: Record<AgentInfo["kind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
};

const AgentIndicator: Component<{
  kind: AgentInfo["kind"];
  state: AgentState;
}> = (props) => {
  const cfg = () => stateConfig[props.state];
  const Icon = () => agentIcons[props.kind];
  const name = () => agentNames[props.kind];
  return (
    <span
      class={`inline-flex items-center gap-1 text-xs ${cfg().color}`}
      data-testid="agent-indicator"
      data-agent-kind={props.kind}
      data-agent-state={props.state}
      title={`${name()}: ${cfg().label}`}
    >
      <span class={`shrink-0 ${cfg().animation}`}>
        <Dynamic component={Icon()} class="w-3 h-3" />
      </span>
      <span class="hidden sm:inline">{cfg().label}</span>
    </span>
  );
};

export default AgentIndicator;
