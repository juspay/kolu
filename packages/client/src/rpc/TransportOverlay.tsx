/**
 * Full-viewport dim overlay for transport- and update-state. Dims everything
 * behind it but leaves clicks passing through to the app — the centered card
 * is the only interactive surface, so users can still scroll, read scrollback,
 * or open a different terminal underneath the dim.
 *
 * Two independent signals drive it:
 * - `lifecycle()` is `"disconnected"` — the WebSocket dropped; show
 *   "Reconnecting…".
 * - `swUpdateReady()` — a freshly-built service worker is installed and
 *   waiting; show the reload prompt. This is the accurate "new build is ready"
 *   trigger: a server restart with unchanged assets no longer nags a reload,
 *   and clicking Reload is race-free — it activates the waiting worker and
 *   reloads only once that worker controls the page (see `pwa.ts`).
 *
 * The Reload button lives inside the card so the action is where the user's
 * eye already is, not tucked into a corner toast.
 */
import { type Component, Show } from "solid-js";
import { reloadForUpdate, swUpdateReady } from "../pwa";
import { surface } from "../ui/Surface";
import { lifecycle } from "./rpc";

const chrome = surface();

const TransportOverlay: Component = () => {
  const disconnected = () => lifecycle().kind === "disconnected";

  return (
    <Show when={disconnected() || swUpdateReady()}>
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
