import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  AGENTS_HOST_CHECK,
  type AgentHostDetail,
} from "@kolu/agent-distro/status";
import type { HostKey } from "kolu-common/hostKey";
import { type Component, For, Show } from "solid-js";
import {
  agentsWhere,
  checkAgentsOn,
  hostAgentDetail,
} from "../agents/useAgentDistro";
import FailureWords from "../agents/FailureWords";
import { padiMap } from "../wire";

const CheckRow: Component<{ host: HostKey }> = (props) => {
  const enabled = () => padiMap.entry(props.host).state().kind === "connected";
  return (
    <button
      type="button"
      data-testid="host-agents-action"
      disabled={!enabled()}
      title={AGENTS_HOST_CHECK.hint}
      class="mt-0.5 flex w-full cursor-pointer items-center justify-between gap-4 rounded-md px-1.5 py-1 text-left text-[11px] text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-fg-3"
      onClick={() => checkAgentsOn(props.host)}
    >
      <span>{AGENTS_HOST_CHECK.label}</span>
      <span aria-hidden="true">↻</span>
    </button>
  );
};

const Section: Component<{ host: HostKey; detail: AgentHostDetail }> = (
  props,
) => (
  <>
    <div class="my-2 border-t border-edge/60" />
    <div
      data-testid="host-agents"
      data-host={agentsWhere(props.host)}
      class="flex items-center gap-1.5 py-0.5 pb-1 text-[10px] uppercase tracking-wide text-fg-3"
    >
      <AgentDistroLogo size={12} />
      agents
    </div>
    <div
      class="flex items-center justify-between gap-4 py-0.5 text-[11px]"
      data-testid="host-agents-profile"
      data-profile={props.detail.stack}
    >
      <span class="text-fg-3">profiles</span>
      <span class="min-w-0 truncate font-medium text-fg">
        {props.detail.stack === "" ? "none" : props.detail.stack}
        <Show when={props.detail.hash}>
          {(hash) => (
            <span class="ml-1 font-mono font-normal text-fg-3">{hash()}</span>
          )}
        </Show>
      </span>
    </div>
    <div
      class="flex items-center justify-between gap-4 py-0.5 text-[11px]"
      data-testid="host-agents-state"
      data-tone={props.detail.state.tone}
      title={props.detail.state.title}
    >
      <span
        classList={{
          "text-warning": props.detail.state.tone === "warn",
          "text-fg-3": props.detail.state.tone !== "warn",
        }}
      >
        state
      </span>
      <span
        data-testid="host-agents-state-text"
        class="min-w-0 truncate font-medium"
        classList={{
          "text-warning": props.detail.state.tone === "warn",
          "text-fg": props.detail.state.tone !== "warn",
        }}
      >
        {props.detail.state.text}
      </span>
    </div>
    <Show when={props.detail.cause}>
      {(cause) => (
        <FailureWords
          words={cause()}
          tone="warn"
          testid="host-agents-cause"
          class="my-0.5 font-mono text-[10px] leading-4"
        />
      )}
    </Show>
    <Show when={props.detail.means}>
      {(means) => (
        <p class="mb-0.5 text-[10.5px] leading-4 text-fg-3">{means()}</p>
      )}
    </Show>
    <Show when={props.detail.events.length > 0}>
      <div
        data-testid="host-agents-events"
        class="scrollbar-subtle my-1 flex max-h-28 flex-col gap-1 overflow-y-auto rounded-md bg-surface-2/70 px-2 py-1.5"
      >
        <For each={props.detail.events}>
          {(event) => (
            <div
              data-testid="host-agents-event"
              data-kind={event.kind}
              title={event.title}
              class="grid grid-cols-[2.6rem_minmax(0,1fr)] items-baseline gap-1.5 text-[10.5px] leading-[1.35]"
            >
              <span class="truncate font-mono text-fg-3/60">{event.when}</span>
              <span
                classList={{
                  "text-warning": event.tone === "warn",
                  "text-fg-3": event.tone !== "warn",
                }}
              >
                <span class="font-medium">{event.kind}</span>
                <Show when={event.text !== ""}>
                  <span class="ml-1 font-mono wrap-anywhere">{event.text}</span>
                </Show>
              </span>
            </div>
          )}
        </For>
      </div>
    </Show>
    <Show when={props.detail.canCheck}>
      <CheckRow host={props.host} />
    </Show>
  </>
);

const HostAgentsSection: Component<{ host: HostKey }> = (props) => (
  <Show when={hostAgentDetail(props.host)}>
    {(detail) => <Section host={props.host} detail={detail()} />}
  </Show>
);

export default HostAgentsSection;
