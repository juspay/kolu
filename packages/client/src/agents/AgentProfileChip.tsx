/** The tile header's agent-distro pill: the agent-distro mark, the profile the
 *  terminal was spawned with, and the short hash of the exact bundle it pinned
 *  (dimmer). A real button in the theme pill's treatment — the caller passes the
 *  tile chrome's shared class and click wiring — that opens Settings at the
 *  Agents rows, where the profile for NEW terminals is changed. No pill at all
 *  when agent-distro was off at spawn: the caller renders this only for a record
 *  that carries both fields.
 *
 *  The first pill a user ever sees is the moment to say where the setting lives,
 *  so it raises the one-shot `agents` tip. */

import { type Component, onMount } from "solid-js";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import Tip from "../ui/Tip";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import { agentBundleShortHash } from "@kolu/agent-distro/bundle";

/** The pill's tooltip — what agent-distro gave this terminal, and what a click
 *  does. Exported for the test. */
export function agentChipLabel(profile: string, bundle: string): string {
  return `agent-distro · ${profile} · ${bundle} — click to change for new terminals`;
}

const AgentProfileChip: Component<{
  profile: string;
  bundle: string;
  /** The tile chrome's shared button class (`TILE_BUTTON_CLASS`). */
  buttonClass: string;
  onClick: (e: MouseEvent) => void;
}> = (props) => {
  const { showTipOnce } = useTips();
  onMount(() => showTipOnce(CONTEXTUAL_TIPS.agents));
  return (
    <Tip label={agentChipLabel(props.profile, props.bundle)}>
      <button
        type="button"
        data-testid="tile-agent-chip"
        data-profile={props.profile}
        class={`${props.buttonClass} gap-1.5 px-2 text-xs`}
        style={{ color: "var(--color-fg-3, currentColor)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => props.onClick(e)}
        aria-label={agentChipLabel(props.profile, props.bundle)}
      >
        <AgentDistroLogo size={14} />
        <span>{props.profile}</span>
        <span class="opacity-60 tabular-nums">
          {agentBundleShortHash(props.bundle)}
        </span>
      </button>
    </Tip>
  );
};

export default AgentProfileChip;
