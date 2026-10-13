/** The agents section of a machine's host details — everything about
 *  agent-distro that is TRUE OF THAT MACHINE: the profile new terminals there
 *  get and the build serving it, its state with its last delivery, a failed
 *  delivery's own words and what it means there, that machine's last update
 *  events,
 *  and the one action it offers: check for newer agents — which is also how a
 *  machine whose delivery failed is tried again. The facts and their words are
 *  `agentHostDetail`'s; Settings keeps only the fleet line.
 *
 *  Absent entirely when there are no agents to describe there — a padi built
 *  without them, or a machine we cannot hear from (whose `state` row above
 *  already says so). */

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
import { padiMap } from "../wire";

/** The one action a machine's section offers: check for newer agents. Shown
 *  when the machine's agents allow one (`canCheck`); a disconnected machine's
 *  last-known status cannot answer it. */
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
    {/* The section says WHICH machine it is about — the same name every
        other agents surface uses for it (`agentsWhere`). */}
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
      data-profile={props.detail.profile}
    >
      <span class="text-fg-3">profile</span>
      <span class="min-w-0 truncate font-medium text-fg">
        {props.detail.profile}
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
    {/* A failure's cause wraps in FULL — it may carry nix's own long line, and
        a cut-off cause is no cause. */}
    <Show when={props.detail.cause}>
      {(cause) => (
        <p
          data-testid="host-agents-cause"
          class="my-0.5 font-mono text-[10px] leading-4 wrap-anywhere text-warning"
        >
          {cause()}
        </p>
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
                  <span class="ml-1 font-mono">{event.text}</span>
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
