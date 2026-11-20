import { useSurfaceApp } from "@kolu/surface-app/solid";
import { type Component, Show } from "solid-js";
import { surface } from "../ui/Surface";

const chrome = surface();

const TransportOverlay: Component = () => {
  const pwa = useSurfaceApp();
  const disconnected = () => pwa.presentingDown();

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
