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
