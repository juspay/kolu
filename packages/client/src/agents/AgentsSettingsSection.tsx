/** Settings → Agents: the one agent-distro entry in Settings — a single
 *  ordinary row, like every other setting.
 *
 *  It keeps the PREFERENCE and nothing else: the switch, the profile cards,
 *  the agents they bring as chips, and ONE line for the fleet whose machine
 *  names open that machine's host details. Per-machine state (the build it
 *  serves, its last run, its events) and the per-machine actions live there;
 *  the fleet-wide update check is the "Check for newer coding agents" palette
 *  command.
 *
 *  The choice itself — the switch, the picker, the writer and its toasts, the
 *  hint — is `AgentsChooser`, which the welcome card's first-run step renders
 *  too. This row adds only what belongs to Settings: the label with
 *  agent-distro's logo, the docs link and "Provided by agent-distro ↗". */

import { type Component, Show } from "solid-js";
import { AGENTS_REPO_OVERRIDES } from "@kolu/agent-distro/status";
import SettingRow from "../settings/SettingRow";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import AgentsChooser from "./AgentsChooser";

const AgentsSettingsSection: Component = () => (
  <AgentsChooser references>
    {(parts) => (
      <SettingRow
        label="Agents"
        icon={<AgentDistroLogo size={16} />}
        hint={parts.hint()}
        details={
          <>
            {parts.picker}
            {parts.chips}
            <Show when={parts.on()}>
              <p class="mt-1.5 text-xs text-fg-3/70">{AGENTS_REPO_OVERRIDES}</p>
            </Show>
            {parts.fleet}
          </>
        }
        doc="agents"
        aside={
          <a
            href="https://github.com/juspay/agent-distro"
            target="_blank"
            rel="noreferrer"
            class="text-fg-3/70 hover:text-fg-2 hover:underline"
          >
            Provided by agent-distro ↗
          </a>
        }
      >
        {parts.control}
      </SettingRow>
    )}
  </AgentsChooser>
);

export default AgentsSettingsSection;
