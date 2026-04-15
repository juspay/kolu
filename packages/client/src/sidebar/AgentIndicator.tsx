/** AI agent state indicator — logo + state label. Logo animates when active.
 *  Renders the appropriate icon per agent kind (Claude Code, OpenCode). */

import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { AgentInfo } from "kolu-common";
import { agentIcons, agentNames, stateDisplay } from "../ui/agentDisplay";

const AgentIndicator: Component<{ agent: AgentInfo }> = (props) => {
  const cfg = () => stateDisplay[props.agent.state];
  const Icon = () => agentIcons[props.agent.kind];
  const name = () => agentNames[props.agent.kind];
  const label = () => cfg().label;
  return (
    <span
      class={`inline-flex items-center gap-1 text-xs ${cfg().color}`}
      data-testid="agent-indicator"
      data-agent-kind={props.agent.kind}
      data-agent-state={props.agent.state}
      title={`${name()}: ${label()}`}
    >
      <span class={`shrink-0 ${cfg().animation}`}>
        <Dynamic component={Icon()} class="w-3 h-3" />
      </span>
      <span class="hidden sm:inline">{label()}</span>
    </span>
  );
};

export default AgentIndicator;
