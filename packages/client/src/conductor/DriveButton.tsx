/** TAKE OVER, OR HAND BACK — the one control that moves a work's terminal
 *  between the Conductor and you, wherever it is drawn: a terminal's row in a
 *  work, and the head of a live pane or a Look. Who drives the terminal
 *  decides which it is; nothing is drawn for a terminal nobody drives, so the
 *  caller does not draw this at all for one.
 *
 *  Each place keeps its own words around it (the head says who is driving);
 *  the press itself, its look and what it does are this part's. */

import { type Component, Show } from "solid-js";
import { useConductor } from "./useConductor";
import type { Lock } from "./workReadings";

/** The button's own look, in a row's smaller type. */
const CONTROL =
  "shrink-0 cursor-pointer whitespace-nowrap rounded-sm px-1.5 py-[0.1rem] font-mono text-[0.56rem] font-semibold uppercase tracking-[0.06em] transition-colors";

const DriveButton: Component<{
  /** The terminal, as a fleet ref. */
  terminal: string;
  /** Who drives it now. */
  driver: Lock;
  /** The test id's stem, per place: `<stem>-take-over`, `<stem>-hand-back`. */
  testId: string;
}> = (props) => {
  const conductor = useConductor();
  return (
    <Show
      when={props.driver === "conductor"}
      fallback={
        <button
          type="button"
          data-testid={`${props.testId}-hand-back`}
          class={`${CONTROL} bg-alert/20 text-alert hover:bg-alert/30`}
          onClick={() => conductor.handBack(props.terminal)}
        >
          Hand back
        </button>
      }
    >
      <button
        type="button"
        data-testid={`${props.testId}-take-over`}
        class={`${CONTROL} bg-conductor/20 text-conductor hover:bg-conductor/30`}
        onClick={() => conductor.takeOver(props.terminal)}
      >
        Take over
      </button>
    </Show>
  );
};

export default DriveButton;
