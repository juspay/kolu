/** The ONE Agents choice — two things that never fold into one: the SWITCH
 *  (the harnesses on a new terminal's PATH) and the PROFILE LIST stacked over
 *  them (`AgentsProfileList`), plus the agents the switch brings as chips, the
 *  fleet line, and the one writer behind all of them with its toasts.
 *  Settings → Agents and the welcome card's first-run step both render it, so
 *  neither keeps a copy of the control, the writer or a sentence; each lays
 *  the parts out in its own row (`children` receives them).
 *
 *  Settings' list writes each edit at once — the whole list, never touching
 *  the switch. The welcome step's list is DEFERRED: it is held here and
 *  written only by "Turn on" (`turnOn`, agents on with the list), so "Not now"
 *  leaves nothing chosen.
 *
 *  It writes only the preference; kolu-server pushes it to every host, and each
 *  host applies it to its NEXT new terminal. */

import type { Hint } from "../settings/SettingRow";
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  Show,
} from "solid-js";
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
  juspayOffered,
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

/** Write the change — whole, through the one builder — and say what it did
 *  (colocated per the toast rule). A choice that changes nothing writes
 *  nothing. A reference the change adds is remembered for the add field's
 *  suggestions. A list edit while agents are off says nothing: it changes
 *  nothing new terminals get until they are on. */
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

/** The parts a host row lays out. */
export interface AgentsChooserParts {
  /** The switch. */
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
  /** The deferred list: the stored one to start with, edited here, written
   *  by "Turn on". It is put back the moment the STORED AGENTS SETTING moves —
   *  a write from another tab, say — so it never shows a list the setting
   *  has left behind.
   *
   *  The source is an EQUALITY-checked memo, not `agentDistroStored` itself:
   *  that reads `preferences()`, the one cell behind every preference, so a
   *  `seenTips` or `colorScheme` write anywhere in the app would otherwise
   *  throw away the list being put together. */
  const storedAgents = createMemo(agentDistroStored, undefined, {
    equals: (a, b) =>
      a === null || b === null ? a === b : agentDistroSettingEqual(a, b),
  });
  const [held, setHeld] = createSignal<readonly string[]>(
    agentDistroSettingOf(storedAgents()).profiles,
  );
  createEffect(
    on(
      storedAgents,
      (stored) => setHeld(agentDistroSettingOf(stored).profiles),
      { defer: true },
    ),
  );
  const list = () =>
    props.deferred === true ? (
      // Its profiles are not the setting's yet, so kolu-server has built none
      // of them: the rows keep to their names.
      <AgentsProfileList
        rows={held().map((reference) => ({
          reference,
          title: agentProfileTitle(reference),
        }))}
        juspay={juspayOffered(held())}
        onChange={setHeld}
      />
    ) : (
      <AgentsProfileList
        rows={agentProfileRows(agentDistroSetting(), agentProfilesNow())}
        juspay={juspayOffered(agentDistroSetting().profiles)}
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
    // Read at PRESS time, never at mount: the list is edited after this
    // object is built, and a value captured here would freeze the first one.
    turnOn: () => {
      if (!available()) return;
      choose({ on: true, profiles: held() });
    },
    canTurnOn: available,
  });
}
