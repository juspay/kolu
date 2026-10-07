/** A host tab's agent-distro note: "Downloading agents… 1.1 GB of 2.0 GB" while
 *  the host fetches the selected profile's bundle from the binary cache, or the
 *  updater's own error when it could not. Nothing at all when agents are ready,
 *  off, or unavailable — the tab stays as it was. Full text on hover. */

import type { HostKey } from "kolu-common/hostKey";
import { type Component, Show } from "solid-js";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import { agentDistroStatusText } from "@kolu/agent-distro/status";
import { agentDistroStatusOf } from "./useAgentDistro";

const AgentDistroHostBadge: Component<{
  host: HostKey;
  /** Rendered inside the strip's hidden measuring row: same text and width,
   *  but no `data-testid`, so a test query finds only the visible badge. */
  measuring?: boolean;
}> = (props) => {
  const note = () => agentDistroStatusText(agentDistroStatusOf(props.host));
  return (
    <Show when={note()}>
      {(n) => (
        <span
          data-testid={props.measuring ? undefined : "host-agents-status"}
          data-tone={n().tone}
          title={n().text}
          class={`mr-2.5 flex max-w-[16rem] items-center gap-1 text-[0.65rem] ${n().tone === "error" ? "text-warning" : "text-fg-3"}`}
        >
          {/* The mark takes the badge's colour (warning on an error). */}
          <AgentDistroLogo size={12} />
          <span class="truncate">
            {n().tone === "error" ? `Agents: ${n().text}` : n().text}
          </span>
        </span>
      )}
    </Show>
  );
};

export default AgentDistroHostBadge;
