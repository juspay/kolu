import { Key } from "@solid-primitives/keyed";
import { type Component, onCleanup, Show } from "solid-js";
import type { AgentFleetGroup } from "@kolu/agent-distro/status";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  openHostDiagnostics,
  releaseHostDiagnosticsAnchor,
} from "../host/useHostDiagnosticsOpen";

const DOT: Record<AgentFleetGroup<never>["tone"], string> = {
  ok: "bg-ok",
  busy: "bg-accent",
  warn: "bg-warning",
  muted: "bg-edge-bright",
};

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
              <span
                aria-hidden="true"
                class={`h-2 w-2 shrink-0 rounded-full ${DOT[group().tone]}`}
              />
              <Show when={group().lead !== ""}>
                <span>{group().lead}</span>
              </Show>
              <Key each={group().hosts} by={(h) => encodeHostKey(h.host)}>
                {(host, at) => (
                  <>
                    <Show when={at() > 0}>
                      <span>and</span>
                    </Show>
                    <button
                      ref={(el) =>
                        onCleanup(() => releaseHostDiagnosticsAnchor(el))
                      }
                      type="button"
                      data-testid="agents-fleet-host"
                      data-host={host().label}
                      title={`Agents on ${host().label} — open its host details`}
                      class="cursor-pointer text-accent underline-offset-2 hover:underline"
                      onClick={(e) =>
                        openHostDiagnostics(
                          encodeHostKey(host().host),
                          e.currentTarget,
                        )
                      }
                    >
                      {host().label}
                    </button>
                  </>
                )}
              </Key>
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
