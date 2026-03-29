/** Claude Code session state indicator — logo + state label. Logo animates when active. */

import type { Component } from "solid-js";
import type { ClaudeCodeInfo } from "kolu-common";
import { ClaudeCodeIcon } from "./Icons";

type ClaudeState = ClaudeCodeInfo["state"];

const stateConfig: Record<
  ClaudeState,
  { color: string; animate: boolean; label: string }
> = {
  thinking: { color: "text-[#D97757]", animate: true, label: "Thinking" },
  tool_use: { color: "text-warning", animate: true, label: "Running tools" },
  waiting: { color: "text-accent", animate: false, label: "Waiting" },
};

const ClaudeIndicator: Component<{ state: ClaudeState }> = (props) => {
  const cfg = () => stateConfig[props.state];
  return (
    <span
      class="inline-flex items-center gap-1 text-xs text-fg-3"
      data-testid="claude-indicator"
      data-claude-state={props.state}
      title={`Claude Code: ${cfg().label}`}
    >
      <span
        class={`shrink-0 ${cfg().color}`}
        classList={{ "animate-pulse": cfg().animate }}
      >
        <ClaudeCodeIcon class="w-3 h-3" />
      </span>
      <span class="hidden sm:inline">{cfg().label}</span>
    </span>
  );
};

export default ClaudeIndicator;
