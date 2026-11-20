import { AWAITING_LINGER_CLASS } from "@kolu/solid-statepip/pipVariant";
import type { AgentInfo } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import {
  type AgentStateTone,
  agentName,
  formatContextTokens,
  stateLabels,
  stateTones,
} from "../ui/agentDisplay";
import { useDuration } from "./staleness";

const toneColor: Record<AgentStateTone, string> = {
  busy: "text-busy",
  "alert-linger": AWAITING_LINGER_CLASS,
  alert: "text-alert",
  quiet: "text-fg-3",
};

const stateColor = (state: AgentInfo["state"]): string =>
  toneColor[stateTones[state]];

function contextTokensTooltip(tokens: number, model: string | null): string {
  const count = `Context: ${tokens.toLocaleString()} tokens`;
  return model ? `${count} · ${model}` : count;
}

const AgentIndicator: Component<{ agent: AgentInfo }> = (props) => {
  const color = () => stateColor(props.agent.state);
  const name = () => agentName(props.agent.kind);
  const label = () => stateLabels[props.agent.state];
  const runningFor = useDuration();
  return (
    <span
      class={`inline-flex items-center gap-1 text-xs ${color()}`}
      data-testid="agent-indicator"
      data-agent-kind={props.agent.kind}
      data-agent-state={props.agent.state}
      title={`${name()}: ${label()}`}
    >
      <span class="hidden sm:inline">{label()}</span>
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
            {formatContextTokens(box().value)}
          </span>
        )}
      </Show>
      <Show when={props.agent.startedAt}>
        {(startedAt) => (
          <span
            data-testid="agent-running-for"
            class="tabular-nums text-fg-3"
            title={`Running for ${runningFor(startedAt())} · started ${new Date(
              startedAt(),
            ).toLocaleString()}`}
          >
            {runningFor(startedAt())}
          </span>
        )}
      </Show>
    </span>
  );
};

export default AgentIndicator;
