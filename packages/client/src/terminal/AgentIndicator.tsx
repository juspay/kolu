/** AI agent state indicator — logo + state label + compact context-token
 *  count + a live running-for duration. Logo animates when active. Renders the
 *  appropriate icon per agent kind (Claude Code, OpenCode). */

import type { AgentInfo } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { agentIcons, agentNames, stateLabels } from "../ui/agentDisplay";
import { useDuration } from "./staleness";

/** Busy = actively working (thinking or running tools). Alert = needs user input
 *  — the same "your turn" token the dock pip and awaiting column use, so a
 *  waiting agent reads one color everywhere (not yellow here, orange there). */
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
  waiting: { color: "text-alert", animation: "animate-pulse" },
  awaiting_user: { color: "text-alert", animation: "animate-pulse" },
  // Busy, not awaiting: the agent is working in a background task, so use
  // the busy treatment rather than the alert color reserved for needs-user.
  running_background: { color: BUSY_COLOR, animation: "animate-spin" },
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
  // Live elapsed-since formatter for the running-for badge; ticks every second
  // off the shared clock, the same readout the inspector's "Running for" uses.
  const runningFor = useDuration();
  return (
    <span
      class={`inline-flex items-center gap-1 text-xs min-w-0 ${cfg().color}`}
      data-testid="agent-indicator"
      data-agent-kind={props.agent.kind}
      data-agent-state={props.agent.state}
      title={`${name()}: ${label()}`}
    >
      <span class={`shrink-0 ${cfg().animation}`}>
        <Dynamic component={Icon()} class="w-3 h-3" />
      </span>
      {/* Truncates so the indicator can't grow unbounded and shove the
       *  title-bar action buttons (theme pill, split, find…) past the tile's
       *  clipped right edge. The icon + colour already carry the state. */}
      <span class="hidden sm:inline truncate max-w-[11ch]">{label()}</span>
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
      {/* Running-for badge, beside the token count. Hidden until `startedAt`
       *  resolves (epoch-ms is always truthy, so the bare value gates Show).
       *  `font-mono` (not the UI font's no-op `tabular-nums`) makes every glyph
       *  equal-width, so the value's box stays constant as it ticks — no
       *  per-second reflow, and no width padding that would crowd the title
       *  bar. The tooltip keys on `startedAt` alone so it isn't rebuilt each
       *  tick. */}
      <Show when={props.agent.startedAt}>
        {(startedAt) => (
          <span
            data-testid="agent-running-for"
            class="shrink-0 font-mono text-fg-3"
            title={`Started ${new Date(startedAt()).toLocaleString()}`}
          >
            {runningFor(startedAt())}
          </span>
        )}
      </Show>
    </span>
  );
};

export default AgentIndicator;
