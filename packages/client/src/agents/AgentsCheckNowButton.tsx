/** "Check now" under Settings' Agents status lines: runs the update check on
 *  every machine at once (`checkAgentsNow`). While any machine's run is going
 *  — read off the status cells, not a local flag, so it shows a scheduled run
 *  too — it reads "Checking…" and does nothing. Its words are
 *  `AGENTS_CHECK_NOW`'s. */

import type { Component } from "solid-js";
import { AGENTS_CHECK_NOW } from "@kolu/agent-distro/status";
import { agentUpdateRunningNow, checkAgentsNow } from "./useAgentDistro";

const AgentsCheckNowButton: Component = () => (
  <button
    type="button"
    data-testid="agents-check-now"
    data-busy={agentUpdateRunningNow() ? "" : undefined}
    disabled={agentUpdateRunningNow()}
    title={AGENTS_CHECK_NOW.hint}
    onClick={checkAgentsNow}
    class="inline-flex shrink-0 items-center rounded-md border border-edge bg-surface-1 px-2 py-0.5 text-[11px] font-medium text-fg-2 transition-colors hover:bg-surface-3/60 hover:text-fg disabled:cursor-default disabled:opacity-60 disabled:hover:bg-surface-1 disabled:hover:text-fg-2"
  >
    {agentUpdateRunningNow()
      ? AGENTS_CHECK_NOW.busyLabel
      : AGENTS_CHECK_NOW.label}
  </button>
);

export default AgentsCheckNowButton;
