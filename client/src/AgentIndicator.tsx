/** AI agent state indicator — logo + state label. Logo animates when active.
 *  Renders the appropriate icon per agent kind (Claude Code, OpenCode). */

import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { AgentInfo } from "kolu-common";
import { ClaudeCodeIcon, OpenCodeIcon } from "./Icons";

/** Busy = actively working (thinking or running tools). Warning = needs user input. */
const BUSY_COLOR = "text-busy";

/** State → display config. Keyed on state, not kind — all agents currently
 *  share the same visual treatment per state. When agents diverge in states,
 *  this becomes a per-kind dispatch (the `agentIcons`/`agentNames` tables
 *  already handle the per-kind axis). */
const stateConfig: Record<
  AgentInfo["state"],
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

const AgentIndicator: Component<{ agent: AgentInfo }> = (props) => {
  const cfg = () => stateConfig[props.agent.state];
  const Icon = () => agentIcons[props.agent.kind];
  const name = () => agentNames[props.agent.kind];
  return (
    <span
      class={`inline-flex items-center gap-1 text-xs ${cfg().color}`}
      data-testid="agent-indicator"
      data-agent-kind={props.agent.kind}
      data-agent-state={props.agent.state}
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
