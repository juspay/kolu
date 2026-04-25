/** AI agent state indicator — logo + state label + compact context-token
 *  count. Logo animates when active. Renders the appropriate icon per agent
 *  kind (Claude Code, OpenCode). */

import type { AgentInfo } from "kolu-common";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { agentIcons, agentNames, stateLabels } from "../ui/agentDisplay";

/** Busy = actively working (thinking or running tools). Warning = needs user input. */
const BUSY_COLOR = "text-busy";

/** State → display config. Keyed on state, not kind — all agents currently
 *  share the same visual treatment per state. When agents diverge in states,
 *  this becomes a per-kind dispatch (the `agentIcons`/`agentNames` tables
 *  already handle the per-kind axis). */
const stateConfig: Record<
  AgentInfo["state"],
  { color: string; animation: string }
> = {
  thinking: { color: BUSY_COLOR, animation: "animate-pulse" },
  tool_use: { color: BUSY_COLOR, animation: "animate-spin" },
  waiting: { color: "text-warning", animation: "animate-pulse" },
};

/** "47392" → "47K", "1183456" → "1.2M". Single call site; no helper module
 *  needed. `maximumFractionDigits: 1` keeps "1.2M" but avoids "47.0K". */
const tokenFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Tooltip body for the token badge. Includes the model when known so
 *  hover reveals both "how much" and "on what" — useful when the user
 *  has multiple agents in flight with different models. Model is
 *  skipped (not rendered as "unknown") when the JSONL/DB hasn't pinned
 *  a name yet, rather than noise up the tooltip. */
function contextTokensTooltip(tokens: number, model: string | null): string {
  const count = `Context: ${tokens.toLocaleString()} tokens`;
  return model ? `${count} · ${model}` : count;
}

const AgentIndicator: Component<{ agent: AgentInfo }> = (props) => {
  const cfg = () => stateConfig[props.agent.state];
  const Icon = () => agentIcons[props.agent.kind];
  const name = () => agentNames[props.agent.kind];
  const label = () => stateLabels[props.agent.state];
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
      {/* Wrap the value in an object so `<Show>`'s truthy check fires
       *  even when `contextTokens` is `0` — a legitimate value for a
       *  synthetic assistant entry with a zeroed usage block. Show's
       *  callback then sees `box()` typed as `{ value: number }`,
       *  dropping the `null | undefined` widening. */}
      <Show
        when={
          props.agent.contextTokens != null
            ? { value: props.agent.contextTokens }
            : null
        }
      >
        {(box) => (
          <span
            data-testid="agent-context-tokens"
            class="tabular-nums text-fg-3"
            title={contextTokensTooltip(box().value, props.agent.model)}
          >
            {tokenFormat.format(box().value)}
          </span>
        )}
      </Show>
    </span>
  );
};

export default AgentIndicator;
