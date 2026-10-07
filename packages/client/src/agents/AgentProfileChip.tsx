/** The tile header's agent-distro pill: the agent-distro mark, the profile the
 *  terminal was spawned with, and the short hash of the exact bundle it pinned
 *  (dimmer). A real button in the theme pill's treatment — the caller passes the
 *  tile chrome's shared class and click wiring — that opens Settings at the
 *  Agents rows, where the profile for NEW terminals is changed. No pill at all
 *  when agent-distro was off at spawn: the caller renders this only for a record
 *  that carries both fields.
 *
 *  STALE (`agentStalenessOf`: a new terminal on this host would get different
 *  agents) it goes muted — the old profile struck through, a ↻ glyph — and its
 *  tooltip says what this terminal has, what new ones get, and what Restart
 *  does; the caller puts the Restart button beside it.
 *
 *  The first pill a user ever sees is the moment to say where the setting lives,
 *  so it raises the one-shot `agents` tip. */

import { type Component, onMount, Show } from "solid-js";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import Tip from "../ui/Tip";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import { agentBundleShortHash } from "@kolu/agent-distro/bundle";
import {
  type AgentStaleness,
  agentStaleLabel,
} from "@kolu/agent-distro/status";

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
  /** This terminal's agents against what a new one gets (default current). */
  staleness?: AgentStaleness;
}> = (props) => {
  const { showTipOnce } = useTips();
  onMount(() => showTipOnce(CONTEXTUAL_TIPS.agents));
  const stale = () =>
    props.staleness?.kind === "stale" ? props.staleness : undefined;
  const label = () => {
    const s = stale();
    return s === undefined
      ? agentChipLabel(props.profile, props.bundle)
      : agentStaleLabel(s);
  };
  return (
    <Tip label={label()}>
      <button
        type="button"
        data-testid="tile-agent-chip"
        data-profile={props.profile}
        data-stale={stale() ? "" : undefined}
        class={`${props.buttonClass} gap-1.5 px-2 text-xs`}
        classList={{ "opacity-60": stale() !== undefined }}
        style={{ color: "var(--color-fg-3, currentColor)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => props.onClick(e)}
        aria-label={label()}
      >
        <AgentDistroLogo size={14} />
        <span classList={{ "line-through": stale() !== undefined }}>
          {props.profile}
        </span>
        <span class="opacity-60 tabular-nums">
          {agentBundleShortHash(props.bundle)}
        </span>
        <Show when={stale()}>
          <span aria-hidden="true">↻</span>
        </Show>
      </button>
    </Tip>
  );
};

export default AgentProfileChip;
