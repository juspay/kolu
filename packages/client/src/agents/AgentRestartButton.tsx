/** The stale-agents Restart button beside the tile's agents pill. A plain shell
 *  restarts on the first click. A terminal with a LIVE agent (working, or
 *  awaiting you) is guarded: the first click only arms it — the label turns to
 *  "Kill agent and restart" for 5 s — and a second click inside that window
 *  restarts. Letting the window lapse disarms it. */

import { type Component, createSignal, onCleanup } from "solid-js";

/** How long an armed guard waits for the confirming click. */
export const RESTART_ARM_MS = 5000;

const AgentRestartButton: Component<{
  /** A live agent would be killed — the first click arms instead of acting. */
  guarded: boolean;
  /** The tile chrome's shared button class (`TILE_BUTTON_CLASS`). */
  buttonClass: string;
  /** Runs the restart. Receives the click so the tile chrome can select first. */
  onRestart: (e: MouseEvent) => void;
}> = (props) => {
  const [armed, setArmed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    setArmed(false);
  };
  onCleanup(disarm);
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    if (props.guarded && !armed()) {
      setArmed(true);
      timer = setTimeout(disarm, RESTART_ARM_MS);
      return;
    }
    disarm();
    props.onRestart(e);
  };
  return (
    <button
      type="button"
      data-testid="tile-agent-restart"
      data-armed={armed() ? "" : undefined}
      class={`${props.buttonClass} px-2 text-xs font-semibold`}
      classList={{ "text-warning": armed() }}
      style={armed() ? undefined : { color: "var(--color-fg-3, currentColor)" }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={click}
    >
      {armed() ? "Kill agent and restart" : "Restart"}
    </button>
  );
};

export default AgentRestartButton;
