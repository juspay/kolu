/** Settings → Agents: the one agent-distro entry in Settings — a single ordinary
 *  row, like every other setting.
 *
 *  The control is one segmented choice, "Off" plus one segment per profile the
 *  pinned agent-distro ships. "Off" writes `enabled: false`; a profile writes
 *  `{ enabled: true, profile }`. The hint says what that choice means right now
 *  (`agentsHint`): off, what turning it on does; on, the profile, its agents with
 *  versions, this machine's status, and any remote host that is downloading or
 *  failed. Every change also toasts what it did, so a switch is never silent.
 *
 *  It writes only the preference; kolu-server pushes it to every host, and each
 *  host applies it to its NEXT new terminal. */

import { LOCAL_HOST } from "kolu-common/hostKey";
import type { Component } from "solid-js";
import { toast } from "solid-sonner";
import SettingRow from "../settings/SettingRow";
import SegmentedControl from "../ui/SegmentedControl";
import { preferences, updatePreferences } from "../wire";
import AgentDistroLogo from "./AgentDistroLogo";
import {
  AGENTS_OFF,
  agentsHint,
  agentsSegmentOf,
  agentsSegments,
} from "./agentDistroText";
import {
  agentDistroListing,
  agentDistroStatusOf,
  remoteAgentStatuses,
} from "./useAgentDistro";

/** Write the choice, and say what it did (colocated per the toast rule). */
function choose(segment: string): void {
  if (segment === AGENTS_OFF) {
    updatePreferences({ agentDistro: { enabled: false } });
    toast("Agents off for new terminals", {
      icon: AgentDistroLogo({ size: 16 }),
    });
    return;
  }
  updatePreferences({ agentDistro: { enabled: true, profile: segment } });
  toast.success(`Agents: ${segment} for new terminals`, {
    icon: AgentDistroLogo({ size: 16 }),
  });
}

const AgentsSettingsSection: Component = () => {
  const listing = () => agentDistroListing();
  const segments = () => {
    const l = listing();
    return agentsSegments(l?.kind === "available" ? l.profiles : []);
  };
  const hint = () =>
    agentsHint({
      setting: preferences().agentDistro,
      listing: listing(),
      local: agentDistroStatusOf(LOCAL_HOST),
      remotes: remoteAgentStatuses(),
    });

  return (
    <SettingRow
      label="Agents"
      icon={<AgentDistroLogo size={16} />}
      hint={hint()}
      doc="agents"
    >
      <SegmentedControl
        options={segments()}
        value={agentsSegmentOf(preferences().agentDistro)}
        onChange={choose}
        testIdPrefix="agents-profile"
      />
    </SettingRow>
  );
};

export default AgentsSettingsSection;
