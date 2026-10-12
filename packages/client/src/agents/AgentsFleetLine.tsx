/** Settings' ONE line about the fleet: which machines have the agents, which
 *  are still fetching them, which failed — `agentFleetSummary`'s groups, each
 *  a coloured dot, its words and the machines it names. A machine's NAME is a
 *  button that opens that machine's host details, where its profile, its last
 *  run, its events and its own actions live; Settings keeps no per-machine
 *  facts of its own.
 *
 *  The groups are KEYED on their own `key` (`<Key>`, not `<For>`): the fold
 *  mints fresh objects on every read, and on a single-machine fleet it reads
 *  the 60 s "3h ago" ticker — so a plain `<For>` rebuilt every row each
 *  minute, dropping hover and focus on the machine buttons. Keyed, only the
 *  trailing note's words move. */

import { Key } from "@solid-primitives/keyed";
import { type Component, For, Show } from "solid-js";
import type { AgentFleetGroup } from "@kolu/agent-distro/status";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { openHostDiagnostics } from "../host/useHostDiagnosticsOpen";

/** One group's dot colour, by its tone. */
const DOT: Record<AgentFleetGroup<never>["tone"], string> = {
  ok: "bg-ok",
  busy: "bg-accent",
  warn: "bg-warning",
  muted: "bg-edge-bright",
};

/** The groups as this line renders them — the host each name opens. */
export interface FleetLineHost {
  readonly label: string;
  readonly host: HostKey;
}

const AgentsFleetLine: Component<{
  groups: readonly AgentFleetGroup<FleetLineHost>[];
}> = (props) => (
  <Show when={props.groups.length > 0}>
    <div
      data-testid="agents-fleet"
      class="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-2"
    >
      <Key each={props.groups} by="key">
        {(group, i) => (
          <>
            <Show when={i() > 0}>
              <span aria-hidden="true" class="text-edge-bright">
                ·
              </span>
            </Show>
            <span
              data-testid="agents-fleet-group"
              data-tone={group().tone}
              class="flex items-center gap-1.5"
            >
              {/* The dot marks the STATE machines are in; a trailing note
                  ("updated 3h ago") names no machine and wears none. */}
              <Show when={group().hosts.length > 0}>
                <span
                  aria-hidden="true"
                  class={`h-2 w-2 shrink-0 rounded-full ${DOT[group().tone]}`}
                />
              </Show>
              <Show when={group().lead !== ""}>
                <span>{group().lead}</span>
              </Show>
              <For each={group().hosts}>
                {(host, at) => (
                  <>
                    <Show when={at() > 0}>
                      <span>and</span>
                    </Show>
                    <button
                      type="button"
                      data-testid="agents-fleet-host"
                      data-host={host.label}
                      title={`Agents on ${host.label} — open its host details`}
                      class="cursor-pointer text-accent underline-offset-2 hover:underline"
                      onClick={(e) =>
                        openHostDiagnostics(
                          encodeHostKey(host.host),
                          e.currentTarget,
                        )
                      }
                    >
                      {host.label}
                    </button>
                  </>
                )}
              </For>
              <Show when={group().trail !== ""}>
                <span
                  data-testid="agents-fleet-text"
                  class="font-mono text-[0.7rem] text-fg-3/80"
                >
                  {group().trail}
                </span>
              </Show>
            </span>
          </>
        )}
      </Key>
    </div>
  </Show>
);

export default AgentsFleetLine;
