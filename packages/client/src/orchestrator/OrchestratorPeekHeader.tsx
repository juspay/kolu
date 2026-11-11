/** The peek pane's one line of chrome.
 *
 *  The pane under it is not a copy of a terminal — it IS the canvas, in its
 *  single-tile posture, showing whichever tile is active. That is why peeking
 *  costs nothing: landing on a terminal from the fleet, from a tool card or
 *  from the dock is the same `activate` every other surface uses, and the tile
 *  was already mounted, attached and sized. Nothing re-attaches, no xterm
 *  buffer is thrown away, and the PTY sees one resize — the real one, because
 *  the visible pane genuinely changed width.
 *
 *  `open maximized ›` leaves the mode with this terminal filling the workspace,
 *  and it asks for that through the one posture writer (`postureTo`) rather
 *  than flipping the bit itself: the writer leaves the orchestrator and lands
 *  on maximized together, so the exit shows the terminal you were watching
 *  rather than the canvas you left. */

import { type Component, Show } from "solid-js";
import { useViewPosture } from "../canvas/useViewPosture";

const OrchestratorPeekHeader: Component<{ name: string | undefined }> = (
  props,
) => {
  const posture = useViewPosture();

  return (
    <header class="flex items-center gap-2.5 px-3 py-1.5 bg-surface-1 border-b border-edge font-mono text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-fg-3">
      <span>PEEK</span>
      <Show when={props.name}>
        {(name) => (
          <span
            data-testid="orchestrator-peek-name"
            class="font-sans text-[0.75rem] font-semibold normal-case tracking-normal text-fg truncate"
          >
            {name()}
          </span>
        )}
      </Show>
      <Show when={props.name}>
        <button
          type="button"
          data-testid="orchestrator-peek-open-maximized"
          class="ml-auto font-sans text-[0.7rem] font-semibold normal-case tracking-normal text-accent cursor-pointer hover:underline"
          onClick={() => posture.postureTo(true)}
        >
          open maximized ›
        </button>
      </Show>
    </header>
  );
};

export default OrchestratorPeekHeader;
