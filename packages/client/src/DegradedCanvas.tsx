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
 * B3 makes it self-healing: a one-click "Restart kaval" recycles the daemon to
 * the current build and restores the session (the server captured it before the
 * recycle, so a failed respawn leaves the restore card — never an empty canvas).
 */

import { type Component, Show } from "solid-js";
import { restartKaval } from "./useDaemonStatus";
import { WarningIcon } from "./ui/Icons";

/** The daemon's down-sub-union — the only states that render this surface.
 *  `downState()` in useDaemonStatus.ts is the single source that narrows the
 *  4-state `DaemonState` to exactly these. */
const DegradedCanvas: Component<{ state: "dead" | "degraded" }> = (props) => {
  const isDead = () => props.state === "dead";
  return (
    <div
      data-testid="degraded-canvas"
      data-daemon-state={props.state}
      class="relative flex-1 min-h-0 flex items-center justify-center canvas-grid-bg"
    >
      <div class="mx-6 max-w-md rounded-xl border border-danger/50 bg-danger/5 px-6 py-5">
        <div class="flex items-start gap-3">
          <WarningIcon class="mt-0.5 h-6 w-6 shrink-0 text-danger" />
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
              Your saved session is preserved — restart kaval to bring it back,
              and your terminals are offered for restore once it’s healthy.
            </p>
            <button
              type="button"
              onClick={() => void restartKaval()}
              data-testid="degraded-restart"
              class="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface-1 transition-colors hover:bg-accent/90"
            >
              Restart kaval
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DegradedCanvas;
