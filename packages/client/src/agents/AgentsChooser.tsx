/** The ONE Agents choice — the segmented control over `agentsSegments` ("Off"
 *  plus one segment per profile the pinned agent-distro ships), the one writer
 *  behind it with its toasts, the hint that says what the choice means
 *  (`agentsHint`), and, once a profile is picked, one status line per machine
 *  (`agentStatusLines`). Settings → Agents and the welcome card's first-run step
 *  both render it, so neither keeps a copy of the control, the writer or a
 *  sentence; each lays the parts out in its own row (`children` receives them).
 *
 *  While nothing is chosen (`null` stored) no segment is pressed, because
 *  nothing is, and the keyboard's resting place is the listing's first profile,
 *  so Enter picks it.
 *
 *  It writes only the preference; kolu-server pushes it to every host, and each
 *  host applies it to its NEXT new terminal. */

import type { Hint } from "../settings/SettingRow";
import { type JSX, Show } from "solid-js";
import { toast } from "solid-sonner";
import SegmentedControl from "../ui/SegmentedControl";
import { updatePreferences } from "../wire";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  AGENTS_OFF,
  AGENTS_OFF_MEANS,
  AGENTS_SEGMENT_TESTID,
  agentDistroChoice,
  agentToast,
  agentsHint,
  agentsPressedSegment,
  agentsRestingSegment,
  agentsSegments,
  selectedAgentProfile,
} from "@kolu/agent-distro/status";
import AgentStatusLines from "./AgentStatusLines";
import {
  agentDistroListing,
  agentDistroSetting,
  agentDistroStored,
  agentStatusLinesNow,
} from "./useAgentDistro";

/** Write the choice — whole, through the one builder — and say what it did
 *  (colocated per the toast rule). */
function choose(segment: string): void {
  updatePreferences({
    agentDistro: agentDistroChoice(segment, agentDistroStored()),
  });
  if (segment === AGENTS_OFF) {
    toast(agentToast.off, {
      description: AGENTS_OFF_MEANS,
      icon: AgentDistroLogo({ size: 16 }),
    });
    return;
  }
  toast.success(agentToast.on(segment), {
    icon: AgentDistroLogo({ size: 16 }),
  });
}

/** The parts a host row lays out. */
export interface AgentsChooserParts {
  /** The segmented control. */
  readonly control: JSX.Element;
  /** What the current choice means (`undefined` until the listing arrives). */
  readonly hint: () => Hint | undefined;
  /** The per-machine status lines — present only while a profile is picked. */
  readonly status: JSX.Element;
}

export default function AgentsChooser(props: {
  /** Focus the control on mount (the first-run step, while nothing is chosen). */
  autofocus?: boolean;
  children: (parts: AgentsChooserParts) => JSX.Element;
}): JSX.Element {
  const profiles = () => {
    const l = agentDistroListing();
    return l?.kind === "available" ? l.profiles : [];
  };
  return props.children({
    control: (
      <SegmentedControl
        options={agentsSegments(profiles())}
        value={agentsPressedSegment(agentDistroStored())}
        restingValue={agentsRestingSegment(profiles())}
        autofocus={props.autofocus}
        onChange={choose}
        testIdPrefix={AGENTS_SEGMENT_TESTID}
      />
    ),
    hint: () =>
      agentsHint({
        stored: agentDistroStored(),
        listing: agentDistroListing(),
      }),
    status: (
      <Show
        when={
          selectedAgentProfile(agentDistroSetting(), agentDistroListing()) !==
          undefined
        }
      >
        <AgentStatusLines lines={agentStatusLinesNow()} />
      </Show>
    ),
  });
}
