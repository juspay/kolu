/** "Check now" under Settings' Agents status lines: runs the update check on
 *  every machine at once (`checkAgentsNow`). It is busy (disabled) while no
 *  connected machine can be asked — the same per-host test the call uses, read
 *  off the status cells, not a local flag, so a scheduled run counts too — and
 *  reads "Checking…" only while one of them is running an update. Its words
 *  are `AGENTS_CHECK_NOW`'s, chosen by `agentCheckNowLabel`. */

import type { Component } from "solid-js";
import { AGENTS_CHECK_NOW } from "@kolu/agent-distro/status";
import {
  agentCheckNowBusyNow,
  agentCheckNowLabelNow,
  checkAgentsNow,
} from "./useAgentDistro";

const AgentsCheckNowButton: Component = () => (
  <button
    type="button"
    data-testid="agents-check-now"
    data-busy={agentCheckNowBusyNow() ? "" : undefined}
    disabled={agentCheckNowBusyNow()}
    title={AGENTS_CHECK_NOW.hint}
    onClick={checkAgentsNow}
    class="inline-flex shrink-0 items-center rounded-md border border-edge bg-surface-1 px-2 py-0.5 text-[11px] font-medium text-fg-2 transition-colors hover:bg-surface-3/60 hover:text-fg disabled:cursor-default disabled:opacity-60 disabled:hover:bg-surface-1 disabled:hover:text-fg-2"
  >
    {agentCheckNowLabelNow()}
  </button>
);

export default AgentsCheckNowButton;
