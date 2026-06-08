/**
 * Full-viewport dim overlay for transport- and update-state. Dims everything
 * behind it but leaves clicks passing through to the app — the centered card
 * is the only interactive surface, so users can still scroll, read scrollback,
 * or open a different terminal underneath the dim.
 *
 * Two independent signals drive it, both from surface-app's headless model:
 * - `status()` is `"down"` — the WebSocket dropped; show "Reconnecting…".
 * - `updateReady()` — a fresh client build is ready; show the reload prompt.
 *   The skew-OR-restart rule (`"restarted"` status OR `stale()`) lives in
 *   surface-app's model beside the `reload()` it gates, so this consumer just
 *   reads the predicate. kolu has no service worker, so the reload is a plain
 *   `location.reload()` (surface-app's `reload()`) landing on the `no-store`
 *   shell → the current bundle.
 *
 * The Reload button lives inside the card so the action is where the user's
 * eye already is, not tucked into a corner toast.
 */
import { useSurfaceApp } from "@kolu/surface-app/solid";
import { type Component, Show } from "solid-js";
import { surface } from "../ui/Surface";

const chrome = surface();

const TransportOverlay: Component = () => {
  const pwa = useSurfaceApp();
  const disconnected = () => pwa.status() === "down";

  return (
    <Show when={disconnected() || pwa.updateReady()}>
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
                  onClick={() => pwa.reload()}
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
