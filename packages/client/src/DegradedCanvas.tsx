/** Degraded canvas — shown when the canvas is empty *because the PTY-host
 *  daemon is down*, not because the user has no terminals.
 *
 *  This exists to kill the empty-canvas lie from the R4c production incident
 *  (#1034): when the daemon died the terminal list went empty and the benign
 *  `EmptyState` ("you have no terminals") rendered — indistinguishable from a
 *  permanently-lost session. Here we say the honest thing: the daemon is down,
 *  your terminals and session are *preserved*, and offer the recovery paths
 *  (restart the daemon, or restore the saved session).
 *
 *  It is a pure projection of `daemonState()` — NO local "dismissed" state.
 *  When the daemon respawns the server re-yields `daemonStatus`/`terminalList`
 *  and this unmounts on its own (see App.tsx's canvasEmptyKind). Adding a
 *  dismiss signal would let the canvas lie in the other direction (claim live
 *  while dead), so don't. */

import type { SavedSession } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { match } from "ts-pattern";
import EmptyState from "./EmptyState";
import { surface } from "./ui/Surface";

const chrome = surface();

interface DegradedCanvasProps {
  /** "degraded" = daemon is dead (loud, recoverable). "connecting" = daemon
   *  health not yet known after boot (quiet pending, no actions). */
  kind: "degraded" | "connecting";
  savedSession?: SavedSession;
  isRestoring?: boolean;
  onRestore?: (options: { resumeIds: ReadonlySet<string> }) => void;
  /** Opens the restart-daemon confirm (same hook the ChromeBar chip uses). */
  onRequestDaemonRestart: () => void;
}

const DegradedCanvas: Component<DegradedCanvasProps> = (props) => {
  return (
    <div
      data-testid="degraded-canvas"
      data-state={props.kind}
      class="flex items-center justify-center h-full"
    >
      {match(props.kind)
        .with("connecting", () => (
          <div class="flex items-center gap-2 text-fg-3 text-sm">
            <span class="inline-block w-2 h-2 rounded-full bg-warning animate-pulse" />
            Connecting to local PTY daemon…
          </div>
        ))
        .with("degraded", () => (
          <div class={`${chrome.class} p-5 max-w-md w-full`}>
            <p class="text-sm font-semibold text-danger mb-1">
              Terminals temporarily unavailable
            </p>
            <p class="text-sm text-fg-2 mb-4">
              The local PTY daemon disconnected. Your terminals and session are
              preserved — they'll reattach once it's back.
            </p>
            <button
              type="button"
              data-testid="degraded-restart"
              class="w-full px-3 py-2 text-sm rounded-xl bg-accent text-surface-1 font-medium hover:brightness-110 transition-all"
              onClick={() => props.onRequestDaemonRestart()}
            >
              Restart local PTY daemon
            </button>
            <Show when={props.savedSession}>
              <div class="mt-5 pt-5 border-t border-edge">
                <EmptyState
                  savedSession={props.savedSession}
                  isRestoring={props.isRestoring}
                  onRestore={props.onRestore}
                />
              </div>
            </Show>
          </div>
        ))
        .exhaustive()}
    </div>
  );
};

export default DegradedCanvas;
