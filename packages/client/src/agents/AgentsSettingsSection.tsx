/** Settings → Agents: the one agent-distro entry in Settings — a single
 *  ordinary row, like every other setting.
 *
 *  It keeps the PREFERENCE and nothing else: the switch (the harnesses), the
 *  profile list stacked over them — ending in the read-only note that a
 *  repository's own plugin.json composes over it — the agents the switch
 *  brings as chips, and ONE line for the fleet whose machine names open that
 *  machine's host details. Per-machine state (the set it serves, its last
 *  run, its events) and the per-machine actions live there; the fleet-wide
 *  update check is the "Check for newer coding agents" palette command.
 *
 *  The choice itself — the switch, the list, the writer and its toasts, the
 *  hint — is `AgentsChooser`, which the welcome card's first-run step renders
 *  too. This row adds only what belongs to Settings: the label with
 *  agent-distro's logo, the docs link and "Provided by agent-distro ↗". */

import type { Component } from "solid-js";
import SettingRow from "../settings/SettingRow";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import AgentsChooser from "./AgentsChooser";

const AgentsSettingsSection: Component = () => (
  <AgentsChooser>
    {(parts) => (
      <SettingRow
        label="Agents"
        icon={<AgentDistroLogo size={16} />}
        hint={parts.hint()}
        details={
          <>
            {parts.chips}
            {parts.profiles}
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
