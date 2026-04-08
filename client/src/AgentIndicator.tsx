/** AI coding agent state indicator — logo + state label. Logo animates when active.
 *  Per-agent icon selected via `kind`; state vocabulary is shared across agents. */

import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { AgentKind, AgentState } from "kolu-common";
import { ClaudeCodeIcon } from "./Icons";

/** Busy = actively working (thinking or running tools). Warning = needs user input. */
const BUSY_COLOR = "text-busy";

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

/** Per-agent UI metadata. Pure A→B mapping — kept as a Record rather than a
 *  ts-pattern match because there's no per-arm logic. Add new agents here:
 *  both the icon and the display name live together so they can't drift. */
const agentMeta: Record<
  AgentKind,
  { icon: Component<{ class?: string }>; name: string }
> = {
  "claude-code": { icon: ClaudeCodeIcon, name: "Claude Code" },
};

const AgentIndicator: Component<{
  kind: AgentKind;
  state: AgentState;
}> = (props) => {
  const cfg = () => stateConfig[props.state];
  const meta = () => agentMeta[props.kind];
  return (
    <span
      class={`inline-flex items-center gap-1 text-xs ${cfg().color}`}
      data-testid="agent-indicator"
      data-agent-kind={props.kind}
      data-agent-state={props.state}
      title={`${meta().name}: ${cfg().label}`}
    >
      <span class={`shrink-0 ${cfg().animation}`}>
        <Dynamic component={meta().icon} class="w-3 h-3" />
      </span>
      <span class="hidden sm:inline">{cfg().label}</span>
    </span>
  );
};

export default AgentIndicator;
