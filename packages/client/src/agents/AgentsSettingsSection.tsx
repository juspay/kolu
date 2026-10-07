/** Settings → Agents: the one agent-distro choice kolu asks the user to make,
 *  as two ordinary Settings rows — nothing the rest of the popover does not do.
 *
 *    - **Agents** — on/off. The hint names agent-distro and the one consequence
 *      worth knowing (these come first on a new terminal's PATH), and the row
 *      carries the docs link. While this machine is fetching or failed to fetch
 *      its agents, the hint is that status instead — the words a host tab uses.
 *    - **Agent profile** — which profile, from the listing the pinned
 *      agent-distro ships. The hint is the profile's description and, on a
 *      second line, the harnesses it ships with their versions.
 *
 *  It writes only the preference; kolu-server pushes it to every host, and each
 *  host applies it to its NEXT new terminal. */

import { LOCAL_HOST } from "kolu-common/hostKey";
import type { AgentDistroProfile } from "kolu-common/surface";
import type { Component } from "solid-js";
import SettingRow, { type Hint } from "../settings/SettingRow";
import SegmentedControl from "../ui/SegmentedControl";
import Toggle from "../ui/Toggle";
import { preferences, updatePreferences } from "../wire";
import { agentDistroStatusText, harnessLine } from "./agentDistroText";
import {
  agentDistroListing,
  agentDistroStatusOf,
  unknownAgentProfile,
} from "./useAgentDistro";

const AGENTS_HINT: Hint = {
  text: "Provided by agent-distro. When on, they come first on the PATH of new terminals, ahead of agents you installed yourself.",
};

const AgentsSettingsSection: Component = () => {
  const setting = () => preferences().agentDistro;
  const profiles = (): readonly AgentDistroProfile[] => {
    const listing = agentDistroListing();
    return listing?.kind === "available" ? listing.profiles : [];
  };

  const agentsHint = (): Hint => {
    const status = setting().enabled
      ? agentDistroStatusText(agentDistroStatusOf(LOCAL_HOST))
      : undefined;
    if (status === undefined) return AGENTS_HINT;
    return {
      text: status.text,
      tone: status.tone === "error" ? "warn" : "muted",
    };
  };

  const profileHint = (): Hint | undefined => {
    const listing = agentDistroListing();
    // Nothing while the listing's first frame is in flight.
    if (listing === undefined) return undefined;
    if (listing.kind === "unavailable")
      return {
        text: "This kolu was built without agent-distro, so there are no agents to choose from.",
      };
    const unknown = unknownAgentProfile();
    if (unknown !== undefined)
      return {
        text: `"${unknown}" is not a profile this kolu ships — pick one.`,
        tone: "warn",
      };
    const selected = listing.profiles.find((p) => p.name === setting().profile);
    return selected === undefined
      ? undefined
      : { text: `${selected.description}\n${harnessLine(selected)}` };
  };

  return (
    <>
      <SettingRow label="Agents" hint={agentsHint()} doc="agents">
        <Toggle
          testId="agents-enabled-toggle"
          enabled={setting().enabled}
          onChange={(on) => updatePreferences({ agentDistro: { enabled: on } })}
        />
      </SettingRow>
      <SettingRow label="Agent profile" hint={profileHint()}>
        <SegmentedControl
          options={profiles().map((p) => ({
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
    </>
  );
};

export default AgentsSettingsSection;
