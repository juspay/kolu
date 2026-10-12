/** The ONE Agents choice — the switch (Settings), the profile PICKER (named
 *  cards: the bundles this build ships, Juspay, Custom… with its reference
 *  field), the agents it brings as chips, the fleet line, and the one writer
 *  behind all of them with its toasts. Settings → Agents and the welcome
 *  card's first-run step both render it, so neither keeps a copy of the
 *  control, the writer or a sentence; each lays the parts out in its own row
 *  (`children` receives them).
 *
 *  The welcome step picks a profile BEFORE agents are on — its cards write
 *  nothing until "Turn on" does (`turnOn`), so "Not now" leaves nothing
 *  chosen. Settings' cards write at once: agents are already on there.
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
  type AgentProfileCard,
  type AgentsChange,
  agentChips,
  agentDistroChoice,
  agentProfileCards,
  agentSelectedCard,
  agentToast,
  agentsHint,
  agentsResolvedLine,
  agentsStepHint,
  profileSuggestions,
  rememberProfile,
} from "@kolu/agent-distro/status";
import AgentChips from "./AgentChips";
import AgentsFleetLine from "./AgentsFleetLine";
import AgentsProfilePicker from "./AgentsProfilePicker";
import {
  agentDistroListing,
  agentDistroSetting,
  agentDistroStored,
  agentFleetNow,
  localAgentReceipt,
  localAgentResolved,
} from "./useAgentDistro";

/** Write the change — whole, through the one builder — and say what it did
 *  (colocated per the toast rule). A choice that changes nothing writes
 *  nothing. A profile written as a reference is remembered for Custom…'s
 *  suggestions. */
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
  /** The welcome card's line: the default bundle's agents by name. */
  readonly stepHint: () => string | undefined;
  /** Are agents on? What a row shows only then (Settings' note that a
   *  repository's own `agent-distro.nix` wins) asks it. */
  readonly on: () => boolean;
  /** The profile cards — present only while agents are on, or in a deferred
   *  picker (the welcome step, where the choice comes first). Settings writes a
   *  pick at once; the welcome step holds it until "Turn on". */
  readonly picker: JSX.Element;
  /** The agents the setting brings, one chip each. */
  readonly chips: JSX.Element;
  /** The ONE fleet line — present only while agents are on. */
  readonly fleet: JSX.Element;
  /** Turn agents on with the card picked RIGHT NOW — the welcome step's Enter
   *  action and its button. A no-op until the listing has a card to turn on;
   *  {@link AgentsChooserParts.canTurnOn} is what decides whether the button
   *  shows. */
  readonly turnOn: () => void;
  /** Is there a card to turn on yet? False until the listing arrives. */
  readonly canTurnOn: () => boolean;
}

export default function AgentsChooser(props: {
  /** Focus the picked card on mount (the first-run step, while nothing is
   *  chosen). */
  autofocus?: boolean;
  /** Show the reference under a card's name (Settings) — the welcome step
   *  keeps its cards to names. */
  references?: boolean;
  /** Pick without writing until {@link AgentsChooserParts.turnOn} (the welcome
   *  step, where agents are still off). */
  deferred?: boolean;
  children: (parts: AgentsChooserParts) => JSX.Element;
}): JSX.Element {
  const cards = () => agentProfileCards(agentDistroListing());
  /** The card picked but NOT written: Custom… anywhere (it writes only once
   *  its field does), and every card in a deferred picker (the welcome step,
   *  which writes when "Turn on" is pressed). It is dropped the moment the
   *  STORED AGENTS SETTING moves — a write from this picker, from another
   *  tab, or the switch going off — so the picker never keeps showing Custom…
   *  for a setting that names a card.
   *
   *  The source is an EQUALITY-checked memo, not `agentDistroStored` itself:
   *  that reads `preferences()`, the one cell behind every preference, so a
   *  `seenTips` or `colorScheme` write anywhere in the app would otherwise
   *  close Custom…'s field mid-typing. */
  const [pending, setPending] = createSignal<AgentProfileCard | undefined>();
  const storedAgents = createMemo(agentDistroStored, undefined, {
    equals: (a, b) =>
      a === null || b === null ? a === b : agentDistroSettingEqual(a, b),
  });
  createEffect(on(storedAgents, () => setPending(undefined), { defer: true }));
  const cardFor = (profile: string | undefined) =>
    cards().find((c) => c.profile === profile);
  const selected = () => {
    const picked =
      pending() ??
      agentSelectedCard(agentDistroSetting(), agentDistroListing());
    // The welcome step offers no Custom… card, so a stored reference (agents
    // switched off after one was picked) falls back to the default one: the
    // step must always have a card to turn on.
    return props.deferred === true && picked?.profile === undefined
      ? cards().find((c) => c.isDefault)
      : picked;
  };
  const pick = (profile: string | undefined) => {
    if (profile === undefined || props.deferred === true) {
      setPending(cardFor(profile));
      return;
    }
    setPending(undefined);
    choose({ profile });
  };
  /** Custom…'s field wrote: the stored profile decides the card again (the
   *  text may well name one). */
  const submit = (text: string) => {
    setPending(undefined);
    choose({ profile: text });
  };
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
    on: () => agentDistroSetting().enabled,
    picker: (
      <Show
        when={
          cards().length > 0 &&
          (props.deferred === true || agentDistroSetting().enabled)
        }
      >
        <AgentsProfilePicker
          cards={
            // The welcome step offers the profiles kolu names; a reference of
            // your own stays a Settings matter.
            props.deferred === true
              ? cards().filter((c) => c.profile !== undefined)
              : cards()
          }
          selected={selected()}
          onPick={pick}
          profile={agentDistroSetting().profile}
          suggestions={profileSuggestions({
            recent: preferences().agentProfilesRecent,
          })}
          resolved={agentsResolvedLine(
            agentDistroSetting(),
            localAgentResolved(),
          )}
          onSubmit={submit}
          autofocus={props.autofocus}
          references={props.references}
        />
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
    // Read at PRESS time, never at mount: the card is picked after this
    // object is built, and a value captured here would freeze the first
    // answer (and, before the listing arrives, freeze "nothing to turn on").
    turnOn: () => {
      const profile = selected()?.profile;
      if (profile === undefined) return;
      choose({ profile });
    },
    canTurnOn: () => selected()?.profile !== undefined,
  });
}
