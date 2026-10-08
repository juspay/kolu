/** Settings → Agents: the one agent-distro entry in Settings — a single ordinary
 *  row, like every other setting.
 *
 *  The choice itself — the control, its writer and toasts, the hint, the
 *  per-machine status lines — is `AgentsChooser`, the same one the welcome
 *  card's first-run step renders. This row adds only what belongs to Settings:
 *  the label with agent-distro's logo, the docs link and "Provided by
 *  agent-distro ↗". */

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
        details={parts.status}
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
