/** A host tab's agent-distro note: "Downloading agents… 1.1 GB of 2.0 GB" while
 *  the host fetches the selected profile's bundle from the binary cache, or the
 *  updater's own error when it could not. Nothing at all when agents are ready,
 *  off, or unavailable — the tab stays as it was. Full text on hover. */

import type { HostKey } from "kolu-common/hostKey";
import { type Component, Show } from "solid-js";
import { agentDistroStatusOf, agentDistroStatusText } from "./useAgentDistro";

const AgentDistroHostBadge: Component<{ host: HostKey }> = (props) => {
  const note = () => agentDistroStatusText(agentDistroStatusOf(props.host));
  return (
    <Show when={note()}>
      {(n) => (
        <span
          data-testid="host-agents-status"
          data-tone={n().tone}
          title={n().text}
          class={`mr-2.5 max-w-[16rem] truncate text-[0.65rem] ${n().tone === "error" ? "text-warning" : "text-fg-3"}`}
        >
          {n().tone === "error" ? `⚠ Agents: ${n().text}` : n().text}
        </span>
      )}
    </Show>
  );
};

export default AgentDistroHostBadge;
