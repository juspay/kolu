/** Settings → Agents: the one agent-distro choice kolu asks the user to make.
 *
 *  On/off, and which profile (every profile the pinned agent-distro ships, the
 *  selected one's description as the hint). The section names agent-distro so
 *  the user knows where the agents come from, and says the one consequence worth
 *  knowing — with it on, these agents come first on a new terminal's PATH. The
 *  local machine's download state shows under it, the same words a host tab uses.
 *
 *  It writes only the preference; kolu-server pushes it to every host, and each
 *  host applies it to its NEXT new terminal. */

import { LOCAL_HOST } from "kolu-common/hostKey";
import { type Component, Show } from "solid-js";
import SettingRow from "../settings/SettingRow";
import DocLink from "../ui/DocLink";
import SegmentedControl from "../ui/SegmentedControl";
import Toggle from "../ui/Toggle";
import { preferences, updatePreferences } from "../wire";
import {
  agentDistroListing,
  agentDistroStatusOf,
  agentDistroStatusText,
  unknownAgentProfile,
} from "./useAgentDistro";

const AgentsSettingsSection: Component = () => {
  const setting = () => preferences().agentDistro;
  const profiles = () => {
    const listing = agentDistroListing();
    return listing?.kind === "available" ? listing.profiles : undefined;
  };
  const selected = () => profiles()?.find((p) => p.name === setting().profile);
  const localStatus = () =>
    agentDistroStatusText(agentDistroStatusOf(LOCAL_HOST));

  return (
    <div
      data-testid="settings-agents"
      class="space-y-4 border-t border-edge pt-3"
    >
      <p class="text-xs text-fg-3/70">Agents · Provided by agent-distro</p>
      <SettingRow label="Enabled">
        <Toggle
          testId="agents-enabled-toggle"
          enabled={setting().enabled}
          onChange={(on) => updatePreferences({ agentDistro: { enabled: on } })}
        />
      </SettingRow>
      <Show
        when={profiles()}
        fallback={
          <p class="text-xs text-fg-3/70" data-testid="agents-unavailable">
            <Show when={agentDistroListing()?.kind === "unavailable"}>
              This kolu was built without agent-distro, so there are no agents
              to choose from.
            </Show>
          </p>
        }
      >
        {(list) => (
          <>
            <SettingRow
              label="Profile"
              hint={
                unknownAgentProfile() !== undefined
                  ? {
                      text: `"${setting().profile}" is not a profile this kolu ships — pick one.`,
                      tone: "warn",
                    }
                  : { text: selected()?.description ?? "" }
              }
            >
              <SegmentedControl
                options={list().map((p) => ({
                  value: p.name,
                  label: p.name,
                  hint: p.description,
                }))}
                value={setting().profile}
                onChange={(profile) =>
                  updatePreferences({ agentDistro: { profile } })
                }
                testIdPrefix="agents-profile"
              />
            </SettingRow>
            <div>
              <p class="text-xs leading-relaxed text-fg-3/70">
                When on, these come first on the PATH of new terminals, ahead of
                agents you installed yourself.
              </p>
              <div class="mt-1 text-xs">
                <DocLink slug="agents">Docs →</DocLink>
              </div>
            </div>
          </>
        )}
      </Show>
      <Show when={setting().enabled && localStatus()}>
        {(status) => (
          <p
            data-testid="agents-local-status"
            class={`text-xs ${status().tone === "error" ? "text-warning" : "text-fg-3/70"}`}
          >
            {status().text}
          </p>
        )}
      </Show>
    </div>
  );
};

export default AgentsSettingsSection;
