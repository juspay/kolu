/** The tile header's agent-distro chip: the profile a terminal was spawned with
 *  and the short hash of the exact bundle it pinned (full store path on hover).
 *  Muted, like the theme pill beside it — it is a receipt, not a control. No chip
 *  at all when agent-distro was off at spawn: the caller renders this only for a
 *  record that carries both fields.
 *
 *  The first chip a user ever sees is the moment to say where the setting lives,
 *  so it raises the one-shot `agents` tip. */

import { type Component, onMount } from "solid-js";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import Tip from "../ui/Tip";
import { agentBundleShortHash } from "./agentDistroText";

const AgentProfileChip: Component<{ profile: string; bundle: string }> = (
  props,
) => {
  const { showTipOnce } = useTips();
  onMount(() => showTipOnce(CONTEXTUAL_TIPS.agents));
  return (
    <Tip label={`Agents: ${props.profile} — ${props.bundle}`}>
      <span
        data-testid="tile-agent-chip"
        data-profile={props.profile}
        class="flex items-center gap-1 h-5 px-1.5 rounded-md text-[0.65rem] leading-none shrink-0 pointer-events-auto bg-black/10 tabular-nums"
        style={{ color: "var(--color-fg-3, currentColor)" }}
      >
        <span>{props.profile}</span>
        <span class="opacity-60">{agentBundleShortHash(props.bundle)}</span>
      </span>
    </Tip>
  );
};

export default AgentProfileChip;
