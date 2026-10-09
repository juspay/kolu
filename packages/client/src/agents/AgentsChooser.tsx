/** The ONE Agents choice — a switch (on or off) and, while it is on, a
 *  profile field (`AgentsProfileField`: Juspay's profile by default, any
 *  bundle kolu ships, or a reference of the user's own, with whether
 *  agent-distro resolves it on this machine), the one writer behind both with
 *  its toasts, the hint while agents are off (`agentsHint`, Settings; the
 *  welcome card's `agentsStepHint`), one status line per machine
 *  (`agentStatusLines`) and Settings' updates footer — Check now and the
 *  History. Settings → Agents and the welcome card's first-run step both
 *  render it, so neither keeps a copy of the control, the writer or a
 *  sentence; each lays the parts out in its own row (`children` receives
 *  them). The welcome card shows only the switch: turning it on with nothing
 *  chosen starts on Juspay's profile.
 *
 *  It writes only the preference; kolu-server pushes it to every host, and each
 *  host applies it to its NEXT new terminal. */

import type { Hint } from "../settings/SettingRow";
import { type JSX, Show } from "solid-js";
import { agentDistroSettingEqual } from "@kolu/agent-distro/schema";
import { toast } from "solid-sonner";
import Toggle from "../ui/Toggle";
import { preferences, updatePreferences } from "../wire";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  AGENTS_OFF_MEANS,
  type AgentsChange,
  agentDistroChoice,
  agentToast,
  agentsHint,
  agentsProfileNotes,
  agentsResolvedLine,
  agentsStepHint,
  profileSuggestions,
  rememberProfile,
  selectedAgentProfile,
} from "@kolu/agent-distro/status";
import AgentStatusLines from "./AgentStatusLines";
import AgentUpdateHistory from "./AgentUpdateHistory";
import AgentsCheckNowButton from "./AgentsCheckNowButton";
import AgentsProfileField from "./AgentsProfileField";
import {
  agentDistroListing,
  agentDistroSetting,
  agentDistroStored,
  agentStatusLinesNow,
  agentUpdateHistoryNow,
  localAgentReceipt,
  localAgentResolved,
} from "./useAgentDistro";

/** Write the change — whole, through the one builder — and say what it did
 *  (colocated per the toast rule). A field left as it was writes nothing. A
 *  profile the field writes is remembered for its suggestions. */
function choose(change: AgentsChange): void {
  const stored = agentDistroStored();
  const next = agentDistroChoice(change, stored);
  if (next === undefined) return;
  if (stored !== null && agentDistroSettingEqual(next, stored)) return;
  updatePreferences({
    agentDistro: next,
    ...("profile" in change
      ? {
          agentProfilesRecent: [
            ...rememberProfile(
              preferences().agentProfilesRecent,
              next.profile,
              agentDistroListing(),
            ),
          ],
        }
      : {}),
  });
  if (!next.enabled) {
    toast(agentToast.off, {
      description: AGENTS_OFF_MEANS,
      icon: AgentDistroLogo({ size: 16 }),
    });
    return;
  }
  toast.success(agentToast.on(next.profile), {
    icon: AgentDistroLogo({ size: 16 }),
  });
}

/** The parts a host row lays out. */
export interface AgentsChooserParts {
  /** The switch. */
  readonly control: JSX.Element;
  /** What off means (`undefined` until the listing arrives, and while agents
   *  are on) — the Settings form. */
  readonly hint: () => Hint | undefined;
  /** The welcome card's line: the lead with the default bundle's agents. */
  readonly stepHint: () => string | undefined;
  /** The profile field and its lines — present only while agents are on.
   *  Settings shows it; the welcome card does not. */
  readonly profile: JSX.Element;
  /** The per-machine status lines — present only while a bundle is selected. */
  readonly status: JSX.Element;
  /** Keeping them current — Check now and the History; present only while a
   *  bundle is selected. Settings shows it; the welcome card does not. */
  readonly updates: JSX.Element;
}

export default function AgentsChooser(props: {
  /** Focus the switch on mount (the first-run step, while nothing is chosen). */
  autofocus?: boolean;
  children: (parts: AgentsChooserParts) => JSX.Element;
}): JSX.Element {
  const picked = () =>
    selectedAgentProfile(agentDistroSetting(), agentDistroListing()) !==
    undefined;
  return props.children({
    control: (
      <Toggle
        enabled={agentDistroSetting().enabled}
        onChange={(on) => choose({ on })}
        testId="agents-switch"
        label="Coding agents in new terminals"
        autofocus={props.autofocus}
      />
    ),
    hint: () =>
      agentsHint({
        stored: agentDistroStored(),
        listing: agentDistroListing(),
      }),
    stepHint: () => agentsStepHint(agentDistroListing()),
    profile: (
      <Show when={agentDistroSetting().enabled}>
        <AgentsProfileField
          profile={agentDistroSetting().profile}
          suggestions={profileSuggestions({
            listing: agentDistroListing(),
            recent: preferences().agentProfilesRecent,
          })}
          resolved={agentsResolvedLine(
            agentDistroSetting(),
            localAgentResolved(),
          )}
          notes={agentsProfileNotes({
            setting: agentDistroSetting(),
            listing: agentDistroListing(),
            localReceipt: localAgentReceipt(),
          })}
          onSubmit={(text) => choose({ profile: text })}
        />
      </Show>
    ),
    status: (
      <Show when={picked()}>
        <AgentStatusLines lines={agentStatusLinesNow()} />
      </Show>
    ),
    updates: (
      <Show when={picked()}>
        {/* Check now sits at the History summary's right; the History itself
            takes the full width, so its rows have room for the words. */}
        <div class="relative mt-1.5">
          <AgentUpdateHistory rows={agentUpdateHistoryNow()} />
          <div class="absolute right-0 top-0">
            <AgentsCheckNowButton />
          </div>
        </div>
      </Show>
    ),
  });
}
