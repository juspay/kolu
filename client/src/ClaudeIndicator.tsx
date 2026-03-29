/** Claude Code session state indicator — logo + state label. Logo animates when active. */

import type { Component } from "solid-js";
import type { ClaudeCodeInfo } from "kolu-common";
import { ClaudeCodeIcon } from "./Icons";

type ClaudeState = ClaudeCodeInfo["state"];

const stateConfig: Record<
  ClaudeState,
  { color: string; animation: string; label: string }
> = {
  thinking: {
    color: "text-[#D97757]",
    animation: "animate-pulse",
    label: "Thinking",
  },
  tool_use: {
    color: "text-[#D97757]",
    animation: "animate-spin",
    label: "Running tools",
  },
  waiting: {
    color: "text-warning",
    animation: "animate-pulse",
    label: "Waiting",
  },
};

const ClaudeIndicator: Component<{ state: ClaudeState }> = (props) => {
  const cfg = () => stateConfig[props.state];
  return (
    <span
      class={`inline-flex items-center gap-1 text-xs ${cfg().color}`}
      data-testid="claude-indicator"
      data-claude-state={props.state}
      title={`Claude Code: ${cfg().label}`}
    >
      <span class={`shrink-0 ${cfg().animation}`}>
        <ClaudeCodeIcon class="w-3 h-3" />
      </span>
      <span class="hidden sm:inline">{cfg().label}</span>
    </span>
  );
};

export default ClaudeIndicator;
