/** The tile header's agent-distro pill: the agent-distro mark, the profile the
 *  terminal was spawned with, and the short hash of the exact bundle it pinned
 *  (dimmer). ONE button in the theme pill's treatment — the caller passes the
 *  tile chrome's shared class — and no pill at all when agent-distro was off at
 *  spawn (the caller renders this only for a record that carries both fields).
 *
 *  Current, a click opens Settings at the Agents row, where the profile for NEW
 *  terminals is changed. STALE (`agentStalenessOf`: a new terminal on this host
 *  would get different agents) the profile and hash dim, and — once there is
 *  something to restart into — the same pill grows a thin divider and an accent
 *  "↻ Restart", and the WHOLE pill becomes the restart: one element, one target.
 *  A live agent arms it first ("↻ Restart agent", or "Kill agent and restart"
 *  when agents are now off, for 5 s); a restart in flight dims the pill
 *  (`restartGuard.ts`). The tooltip says what this terminal has, what new ones
 *  get, and what a restart does.
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
  agentChipLabel,
  type agentRestartAction,
  type AgentStaleness,
  agentStaleLabel,
} from "@kolu/agent-distro/status";
import { createRestartGuard } from "./restartGuard";

/** A stale pill's restart, when there is something to restart into. */
export interface ChipRestart {
  /** A live agent — the first press arms instead of acting. */
  readonly guarded: boolean;
  /** What the restart does (`agentRestartAction`): its labels, and whether it
   *  ends a live agent (painted in the warning colour when armed). */
  readonly action: ReturnType<typeof agentRestartAction>;
  /** Runs the restart (the caller selects the tile first); settles when done. */
  readonly run: (e: MouseEvent) => Promise<unknown>;
}

const AgentProfileChip: Component<{
  profile: string;
  bundle: string;
  /** The tile chrome's shared button class (`TILE_BUTTON_CLASS`). */
  buttonClass: string;
  /** A click on a pill that is not restarting (opens Settings). */
  onClick: (e: MouseEvent) => void;
  /** This terminal's agents against what a new one gets (default current). */
  staleness?: AgentStaleness;
  /** Present when the pill is stale AND restartable: the pill IS the restart. */
  restart?: ChipRestart;
}> = (props) => {
  const { showTipOnce } = useTips();
  onMount(() => showTipOnce(CONTEXTUAL_TIPS.agents));
  const stale = () =>
    props.staleness?.kind === "stale" ? props.staleness : undefined;
  let lastClick: MouseEvent | undefined;
  const guard = createRestartGuard({
    guarded: () => props.restart?.guarded ?? false,
    restart: () => {
      const r = props.restart;
      const e = lastClick;
      return r === undefined || e === undefined ? Promise.resolve() : r.run(e);
    },
  });
  const label = () => {
    const s = stale();
    return s === undefined
      ? agentChipLabel(props.profile, props.bundle)
      : agentStaleLabel(s);
  };
  const action = () => {
    const a = props.restart?.action;
    return a === undefined ? "" : guard.armed() ? a.armedLabel : a.label;
  };
  return (
    <Tip label={<span class="block max-w-sm">{label()}</span>}>
      <button
        type="button"
        data-testid="tile-agent-chip"
        data-profile={props.profile}
        data-stale={stale() ? "" : undefined}
        data-restart={props.restart ? "" : undefined}
        data-armed={guard.armed() ? "" : undefined}
        disabled={guard.busy()}
        aria-busy={guard.busy()}
        class={`${props.buttonClass} gap-1.5 px-2 text-xs`}
        classList={{
          "opacity-50 cursor-wait": guard.busy(),
          // Armed: the pill itself says "the next press acts" — a faint accent
          // wash, no heavier text.
          "bg-accent/10": guard.armed(),
        }}
        style={{ color: "var(--color-fg-3, currentColor)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (props.restart === undefined) {
            props.onClick(e);
            return;
          }
          e.stopPropagation();
          lastClick = e;
          guard.press();
        }}
        aria-label={`${props.restart ? `${action()} — ` : ""}${label()} Bundle: ${props.bundle}`}
      >
        <AgentDistroLogo size={14} />
        <span classList={{ "opacity-75": stale() !== undefined }}>
          {props.profile}
        </span>
        <span class="opacity-60 tabular-nums">
          {agentBundleShortHash(props.bundle)}
        </span>
        <Show when={props.restart}>
          <span aria-hidden="true" class="h-3.5 w-px bg-current opacity-25" />
          <span
            data-testid="tile-agent-restart"
            class={
              guard.armed() && props.restart?.action.destructive
                ? "text-warning"
                : "text-accent"
            }
          >
            ↻ {action()}
          </span>
        </Show>
      </button>
    </Tip>
  );
};

export default AgentProfileChip;
