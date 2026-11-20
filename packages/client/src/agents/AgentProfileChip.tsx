import { type Component, onMount, Show } from "solid-js";
import type { TerminalAgents } from "@kolu/agent-distro/schema";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import Tip from "../ui/Tip";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import { agentBundleShortHash } from "@kolu/agent-distro/bundle";
import {
  agentChipLabel,
  agentChipProfile,
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
  agents: TerminalAgents;
  /** The tile chrome's shared button class (`TILE_BUTTON_CLASS`). */
  buttonClass: string;
  /** A click on a pill that is not restarting (opens Settings). */
  onClick: (e: MouseEvent) => void;
  /** This terminal's agents against what a new one gets (default current). */
  staleness?: AgentStaleness;
  /** The terminal's host, named as the host tab names it (`agentsWhere`). */
  where: string;
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
      ? agentChipLabel(props.agents)
      : agentStaleLabel(s, props.where);
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
        data-profile={agentChipProfile(props.agents)}
        data-hash={agentBundleShortHash(props.agents.bundle)}
        data-stale={stale() ? "" : undefined}
        data-restart={props.restart ? "" : undefined}
        data-armed={guard.armed() ? "" : undefined}
        disabled={guard.busy()}
        aria-busy={guard.busy()}
        class={`${props.buttonClass} gap-1.5 px-2 text-xs`}
        classList={{
          "opacity-50 cursor-wait": guard.busy(),
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
        aria-label={`${props.restart ? `${action()} — ` : ""}${label()} Package: ${props.agents.bundle}`}
      >
        <AgentDistroLogo size={14} />
        <Show when={agentChipProfile(props.agents)}>
          {(profile) => (
            <span
              data-testid="tile-agent-profile"
              classList={{ "opacity-75": stale() !== undefined }}
            >
              {profile()}
            </span>
          )}
        </Show>
        <span class="opacity-60 tabular-nums">
          {agentBundleShortHash(props.agents.bundle)}
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
