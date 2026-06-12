/**
 * DegradedCanvas — the honest "the terminal daemon is down" surface.
 *
 * B2's empty-canvas-lie fix: when kaval (the pty-host daemon) is `dead` (never
 * came up at boot) or `degraded` (died mid-session), the canvas must say so —
 * NOT show the same "you have no terminals" welcome that a healthy, empty kolu
 * shows. #1034's worst lie was a respawn-timeout leaving a user staring at an
 * empty canvas indistinguishable from a fresh start, their 20-terminal session
 * seemingly gone. This surface is visibly distinct: a warning-toned card naming
 * the real problem.
 *
 * B2 is honest but not yet self-healing — a one-click "Restart kaval" affordance
 * (and the session-restore it drives) is B3's supervised restart. Here we tell
 * the user what happened and that their saved session is safe.
 */

import { type Component, Show } from "solid-js";
import type { DaemonState } from "kolu-common/surface";

const DegradedCanvas: Component<{ state: DaemonState }> = (props) => {
  const isDead = () => props.state === "dead";
  return (
    <div
      data-testid="degraded-canvas"
      data-daemon-state={props.state}
      class="relative flex-1 min-h-0 flex items-center justify-center canvas-grid-bg"
    >
      <div class="mx-6 max-w-md rounded-xl border border-danger/50 bg-danger/5 px-6 py-5">
        <div class="flex items-start gap-3">
          <svg
            class="mt-0.5 h-6 w-6 shrink-0 text-danger"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-fg">
              {isDead()
                ? "kaval didn’t start"
                : "kaval — your terminal daemon — stopped"}
            </h2>
            <p class="mt-1.5 text-sm leading-relaxed text-fg-2">
              <span class="font-mono text-fg">kaval</span> is the process that
              owns your shells.{" "}
              <Show
                when={isDead()}
                fallback="It went away, so the terminals it was running ended."
              >
                It couldn’t be started, so no terminals can run yet.
              </Show>{" "}
              This isn’t an empty workspace — it’s a daemon that needs to come
              back.
            </p>
            <p class="mt-2 text-xs leading-relaxed text-fg-3">
              Your saved session is preserved. Restart kolu to bring kaval back;
              your terminals are offered for restore once it’s healthy. (A
              one-click restart lands in a later release.)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DegradedCanvas;
