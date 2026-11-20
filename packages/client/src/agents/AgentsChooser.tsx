import type { Hint } from "../settings/SettingRow";
import { createSignal, type JSX, Show } from "solid-js";
import { agentDistroSettingEqual } from "@kolu/agent-distro/schema";
import { toast } from "solid-sonner";
import Toggle from "../ui/Toggle";
import { preferences, updatePreferences } from "../wire";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  AGENTS_OFF_MEANS,
  type AgentsChange,
  agentChips,
  agentDistroChoice,
  agentDistroSettingOf,
  agentProfileRows,
  agentProfileTitle,
  agentToast,
  agentsHint,
  agentsStepHint,
  profileSuggestions,
  rememberProfiles,
} from "@kolu/agent-distro/status";
import AgentChips from "./AgentChips";
import AgentsFleetLine from "./AgentsFleetLine";
import AgentsProfileList from "./AgentsProfileList";
import {
  agentDistroListing,
  agentDistroSetting,
  agentDistroStored,
  agentFleetNow,
  agentProfilesNow,
  localAgentReceipt,
} from "./useAgentDistro";

function choose(change: AgentsChange): void {
  const stored = agentDistroStored();
  const next = agentDistroChoice(change, stored);
  if (next === undefined) return;
  if (stored !== null && agentDistroSettingEqual(next, stored)) return;
  const before = agentDistroSettingOf(stored).profiles;
  const added = next.profiles.filter((p) => !before.includes(p));
  updatePreferences({
    agentDistro: next,
    ...(added.length > 0
      ? {
          agentProfilesRecent: [
            ...rememberProfiles(preferences().agentProfilesRecent, added),
          ],
        }
      : {}),
  });
  if (!next.enabled) {
    if (change.on === false)
      toast(agentToast.off, {
        description: AGENTS_OFF_MEANS,
        icon: AgentDistroLogo({ size: 16 }),
      });
    return;
  }
  toast.success(agentToast.on(next.profiles), {
    icon: AgentDistroLogo({ size: 16 }),
  });
}

export interface AgentsChooserParts {
  readonly control: JSX.Element;
  /** What off means (`undefined` until the listing arrives, and while agents
   *  are on) — the Settings form. */
  readonly hint: () => Hint | undefined;
  /** The welcome card's line: the package's agents by name. */
  readonly stepHint: () => string | undefined;
  /** The profile list — present only while agents are on, or in a deferred
   *  chooser (the welcome step, where it comes before "Turn on"). */
  readonly profiles: JSX.Element;
  /** The agents the setting brings, one chip each. */
  readonly chips: JSX.Element;
  /** The ONE fleet line — present only while agents are on. */
  readonly fleet: JSX.Element;
  /** Turn agents on with the list held RIGHT NOW — the welcome step's
   *  button. A no-op until there is something to turn on
   *  ({@link AgentsChooserParts.canTurnOn}). */
  readonly turnOn: () => void;
  /** Is there something to turn on? False until the listing arrives, and in a
   *  kolu built without agents. */
  readonly canTurnOn: () => boolean;
}

export default function AgentsChooser(props: {
  /** Hold the list until {@link AgentsChooserParts.turnOn} (the welcome step,
   *  where agents are still off). */
  deferred?: boolean;
  children: (parts: AgentsChooserParts) => JSX.Element;
}): JSX.Element {
  const available = () => agentDistroListing()?.kind === "available";
  const [held, setHeld] = createSignal<readonly string[]>([]);
  const list = () =>
    props.deferred === true ? (
      <AgentsProfileList
        rows={held().map((reference) => ({
          reference,
          title: agentProfileTitle(reference),
        }))}
        suggestions={profileSuggestions({
          recent: preferences().agentProfilesRecent,
          profiles: held(),
        })}
        prominentJuspay
        onChange={setHeld}
      />
    ) : (
      <AgentsProfileList
        rows={agentProfileRows(agentDistroSetting(), agentProfilesNow())}
        suggestions={profileSuggestions({
          recent: preferences().agentProfilesRecent,
          profiles: agentDistroSetting().profiles,
        })}
        onChange={(profiles) => choose({ profiles })}
      />
    );
  return props.children({
    control: (
      <Toggle
        enabled={agentDistroSetting().enabled}
        onChange={(on) => choose({ on })}
        testId="agents-switch"
        label="Coding agents in new terminals"
      />
    ),
    hint: () =>
      agentsHint({
        stored: agentDistroStored(),
        listing: agentDistroListing(),
      }),
    stepHint: () => agentsStepHint(agentDistroListing()),
    profiles: (
      <Show
        when={
          available() &&
          (props.deferred === true || agentDistroSetting().enabled)
        }
      >
        {list()}
      </Show>
    ),
    chips: (
      <AgentChips
        chips={agentChips({
          setting: agentDistroSetting(),
          listing: agentDistroListing(),
          localReceipt: localAgentReceipt(),
        })}
      />
    ),
    fleet: (
      <Show when={agentDistroSetting().enabled}>
        <AgentsFleetLine groups={agentFleetNow()} />
      </Show>
    ),
    turnOn: () => {
      if (!available()) return;
      choose({ on: true, profiles: held() });
    },
    canTurnOn: available,
  });
}
