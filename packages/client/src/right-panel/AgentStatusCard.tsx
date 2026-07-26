/** AgentStatusCard — the Inspector's tier-1 lead: "what is this agent doing,
 *  and does it need me?", answered before a single label is read.
 *
 *  Replaces the old label/value "Agent" section. The state is the headline —
 *  a chip painted from the shared semantic buckets (`stateTones`: needs-you
 *  violet vs working rust, the same families the dock StatePip and the header
 *  AgentIndicator use), echoed by the card's left rail so the answer reads
 *  peripherally. The task summary is the second line; model / running-for /
 *  task progress / workflow / context size fold into one quiet mono meta row.
 *
 *  Context renders as a compact count ("488K"), full count in the tooltip.
 *  Deliberately NO capacity meter: `TerminalMetadata` carries no context
 *  *limit* (it varies per model), and inventing a denominator client-side
 *  would be a guess presented as a fact. */

import type { AgentInfo } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { useDuration } from "../terminal/staleness";
import {
  type AgentStateTone,
  agentIcons,
  agentNames,
  agentWorkflow,
  formatContextTokens,
  stateLabels,
  stateTones,
} from "../ui/agentDisplay";

/** Tone → the card's two paints, one entry per tone so a new bucket is a single
 *  edit here. The linger bucket (post-turn `waiting`) keeps the violet family at
 *  reduced strength, mirroring `AWAITING_LINGER_CLASS` in the header cluster. */
const TONE: Record<
  AgentStateTone,
  { chip: string; rail: string; pulse: boolean }
> = {
  busy: { chip: "bg-busy/15 text-busy", rail: "border-busy", pulse: true },
  alert: { chip: "bg-alert/15 text-alert", rail: "border-alert", pulse: false },
  "alert-linger": {
    chip: "bg-alert/10 text-alert/70",
    rail: "border-alert/50",
    pulse: false,
  },
};

const AgentStatusCard: Component<{ agent: AgentInfo }> = (props) => {
  const tone = () => TONE[stateTones[props.agent.state]];
  const runningFor = useDuration();
  return (
    <div
      class={`border-b border-edge border-l-2 px-3 py-3 ${tone().rail}`}
      data-testid="inspector-agent-card"
      data-agent-state={props.agent.state}
    >
      <div class="flex min-w-0 items-center gap-2">
        <Dynamic
          component={agentIcons[props.agent.kind]}
          class="h-3.5 w-3.5 shrink-0"
        />
        <span class="truncate text-[12px] font-semibold text-fg">
          {agentNames[props.agent.kind] ?? props.agent.kind}
        </span>
        <span
          class={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${tone().chip}`}
        >
          <span
            class="h-1.5 w-1.5 rounded-full bg-current"
            classList={{
              "animate-pulse motion-reduce:animate-none": tone().pulse,
            }}
          />
          {stateLabels[props.agent.state] ?? props.agent.state}
        </span>
      </div>

      <Show when={props.agent.summary}>
        {(summary) => (
          <div class="mt-2 text-[12px] font-medium leading-snug text-fg">
            {summary()}
          </div>
        )}
      </Show>

      <div class="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[10px] tabular-nums text-fg-3">
        <Show when={props.agent.model}>
          {(model) => <span>{model()}</span>}
        </Show>
        <Show when={props.agent.startedAt}>
          {(startedAt) => (
            <span title={`Started ${new Date(startedAt()).toLocaleString()}`}>
              {runningFor(startedAt())}
            </span>
          )}
        </Show>
        <Show when={props.agent.taskProgress}>
          {(tp) => (
            <span>
              {tp().completed}/{tp().total} tasks
            </span>
          )}
        </Show>
        <Show when={agentWorkflow(props.agent)}>
          {(wf) => (
            <span>
              {wf().name} · {wf().agents} agents · {wf().status}
            </span>
          )}
        </Show>
        {/* Boxed so a legitimate `0` still renders (Show is truthy-gated). */}
        <Show
          when={
            props.agent.contextTokens != null
              ? { value: props.agent.contextTokens }
              : null
          }
        >
          {(box) => (
            <span title={`Context: ${box().value.toLocaleString()} tokens`}>
              {formatContextTokens(box().value)} ctx
            </span>
          )}
        </Show>
      </div>
    </div>
  );
};

export default AgentStatusCard;
