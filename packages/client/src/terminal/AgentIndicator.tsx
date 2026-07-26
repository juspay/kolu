/** AI agent state indicator — state label + compact context-token count + a
 *  live running-for duration. Words and state color only: the brand mark and
 *  activity motion live once on the surface in the leading StatePip (T1). No
 *  per-state CSS animation here (spinning "Tool use" text was a defect). */

import { AWAITING_LINGER_CLASS } from "@kolu/solid-statepip/pipVariant";
import type { AgentInfo } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import {
  type AgentStateTone,
  agentNames,
  formatContextTokens,
  stateLabels,
  stateTones,
} from "../ui/agentDisplay";
import { useDuration } from "./staleness";

/** Tone → text colour (the WHICH-bucket fact lives in `stateTones`). Busy =
 *  actively working. Alert = needs user input — same violet family as the dock
 *  StatePip; post-turn `waiting` lingers via `AWAITING_LINGER_CLASS` (same
 *  token as pip awaiting paint), genuine `awaiting_user` is full strength. */
const toneColor: Record<AgentStateTone, string> = {
  busy: "text-busy",
  "alert-linger": AWAITING_LINGER_CLASS,
  alert: "text-alert",
};

/** State → text colour. Keyed on state, not kind — all agents currently share
 *  the same paint per state. Motion is the StatePip's job, not this cluster. */
const stateColor = (state: AgentInfo["state"]): string =>
  toneColor[stateTones[state]];

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
  const color = () => stateColor(props.agent.state);
  const name = () => agentNames[props.agent.kind];
  const label = () => stateLabels[props.agent.state];
  // Live elapsed-since formatter for the running-for badge; ticks every second
  // off the shared clock, the same readout the inspector's "Running for" uses.
  // `startedAt` is already reprojected to the browser clock at the metadata INGESTION
  // boundary (`useTerminalMetadata.reprojectClock`), so a plain local-clock duration +
  // absolute instant are correct here — no per-consumer reprojection (the boundary owns
  // it; a warming host's `startedAt` arrives as 0, gated out by the `<Show>` below).
  const runningFor = useDuration();
  return (
    <span
      class={`inline-flex items-center gap-1 text-xs ${color()}`}
      data-testid="agent-indicator"
      data-agent-kind={props.agent.kind}
      data-agent-state={props.agent.state}
      title={`${name()}: ${label()}`}
    >
      {/* Static label — no spin/pulse; activity motion is the StatePip. */}
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
            {formatContextTokens(box().value)}
          </span>
        )}
      </Show>
      {/* Running-for badge, beside the token count. Hidden until `startedAt`
       *  resolves (epoch-ms is always truthy, so the bare value gates Show). */}
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
