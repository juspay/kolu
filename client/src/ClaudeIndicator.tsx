/** Claude Code session state indicator — icon + colored dot + state label. */

import type { Component } from "solid-js";
import type { ClaudeCodeInfo } from "kolu-common";
import { ClaudeCodeIcon } from "./Icons";

type ClaudeState = ClaudeCodeInfo["state"];

const stateStyles: Record<ClaudeState, { dot: string; label: string }> = {
  thinking: { dot: "bg-accent animate-pulse", label: "Thinking" },
  tool_use: { dot: "bg-warning animate-pulse", label: "Running tools" },
  waiting: { dot: "bg-fg-3", label: "Waiting" },
};

const ClaudeIndicator: Component<{ state: ClaudeState }> = (props) => {
  const cfg = () => stateStyles[props.state];
  return (
    <span
      class="inline-flex items-center gap-1 text-xs text-fg-3"
      data-testid="claude-indicator"
      data-claude-state={props.state}
      title={`Claude Code: ${cfg().label}`}
    >
      <ClaudeCodeIcon class="w-3 h-3 shrink-0" />
      <span
        class={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${cfg().dot}`}
      />
      <span class="hidden sm:inline">{cfg().label}</span>
    </span>
  );
};

export default ClaudeIndicator;
