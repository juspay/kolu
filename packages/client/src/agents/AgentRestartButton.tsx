/** The stale-agents Restart button beside the tile's agents pill. A plain shell
 *  restarts on the first click. A terminal with a LIVE agent (working, or
 *  awaiting you) is guarded: the first click only arms it — the label turns to
 *  the caller's `armedLabel` ("Restart agent", or "Kill agent and restart" when
 *  agents are now off) for 5 s — and a second click inside that window
 *  restarts. Letting the window lapse, or the agent going quiet, disarms it.
 *
 *  While a restart is in flight the button is disabled, so a double click is
 *  one restart, not two. */

import {
  type Component,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

/** How long an armed guard waits for the confirming click. */
export const RESTART_ARM_MS = 5000;

const AgentRestartButton: Component<{
  /** A live agent — the first click arms instead of acting. */
  guarded: boolean;
  /** The armed label: what the second click does to the agent. */
  armedLabel: string;
  /** The tile chrome's shared button class (`TILE_BUTTON_CLASS`). */
  buttonClass: string;
  /** Runs the restart; settles when it has. Receives the click so the tile
   *  chrome can select first. */
  onRestart: (e: MouseEvent) => Promise<unknown>;
}> = (props) => {
  const [armed, setArmed] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    setArmed(false);
  };
  onCleanup(disarm);
  // The agent went quiet while armed: there is nothing left to warn about.
  createEffect(
    on(
      () => props.guarded,
      (guarded) => {
        if (!guarded) disarm();
      },
      { defer: true },
    ),
  );
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    if (busy()) return;
    if (props.guarded && !armed()) {
      setArmed(true);
      timer = setTimeout(disarm, RESTART_ARM_MS);
      return;
    }
    disarm();
    setBusy(true);
    void props.onRestart(e).finally(() => setBusy(false));
  };
  return (
    <button
      type="button"
      data-testid="tile-agent-restart"
      data-armed={armed() ? "" : undefined}
      disabled={busy()}
      aria-busy={busy()}
      class={`${props.buttonClass} px-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-50`}
      classList={{ "text-warning": armed() }}
      style={armed() ? undefined : { color: "var(--color-fg-3, currentColor)" }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={click}
    >
      {armed() ? props.armedLabel : "Restart"}
    </button>
  );
};

export default AgentRestartButton;
