/**
 * Full-viewport dim overlay for transport- and update-state. Dims everything
 * behind it but leaves clicks passing through to the app — the centered card
 * is the only interactive surface, so users can still scroll, read scrollback,
 * or open a different terminal underneath the dim.
 *
 * Two independent signals drive it:
 * - `lifecycle()` is `"disconnected"` — the WebSocket dropped; show
 *   "Reconnecting…".
 * - `updateReady()` — a fresh client build is ready; show the reload prompt.
 *   `pwa.ts` owns what "ready" means: with a service worker it is the accurate
 *   installed-and-waiting signal (race-free reload); without one (HTTP/LAN) it
 *   falls back to the server-restart signal. This overlay does not reason about
 *   service workers — it just renders the prompt when told to.
 *
 * The Reload button lives inside the card so the action is where the user's
 * eye already is, not tucked into a corner toast.
 */
import { type Component, Show } from "solid-js";
import { reloadForUpdate, updateReady } from "../pwa";
import { surface } from "../ui/Surface";
import { lifecycle } from "./rpc";

const chrome = surface();

const TransportOverlay: Component = () => {
  const disconnected = () => lifecycle().kind === "disconnected";

  return (
    <Show when={disconnected() || updateReady()}>
      <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center pointer-events-none">
        <div
          class={`${chrome.class} p-6 max-w-sm text-sm pointer-events-auto`}
          data-testid="transport-overlay"
        >
          <Show
            when={disconnected()}
            fallback={
              <>
                <div class="font-semibold text-fg mb-1">App updated</div>
                <div class="text-fg-3 mb-4">
                  Reload to apply the latest version.
                </div>
                <button
                  type="button"
                  class="bg-accent text-surface-1 font-semibold rounded px-3 py-1.5 hover:opacity-90"
                  onClick={reloadForUpdate}
                >
                  Reload
                </button>
              </>
            }
          >
            <div class="font-semibold text-fg mb-1">
              Disconnected from server
            </div>
            <div class="text-fg-3">Reconnecting…</div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default TransportOverlay;
