/**
 * Full-viewport dim overlay for transport-fault states. Dims everything
 * behind it but leaves clicks passing through to the app — the centered
 * card is the only interactive surface, so users can still scroll, read
 * scrollback, or open a different terminal underneath the dim.
 *
 * Replaces three scattered sonner toasts ("Disconnected…", "Reconnected…",
 * "Server updated — Reload") with one piece of UI that pattern-matches
 * the lifecycle signal to content. The Reload button lives inside the
 * card so the action is where the user's eye already is, not tucked into
 * a corner toast.
 */
import { type Component, Show } from "solid-js";
import { match } from "ts-pattern";
import { lifecycle } from "./rpc";

const TransportOverlay: Component = () => {
  const visible = () => {
    const k = lifecycle().kind;
    return k === "disconnected" || k === "restarted";
  };

  return (
    <Show when={visible()}>
      <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center pointer-events-none">
        <div
          class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-6 max-w-sm text-sm pointer-events-auto"
          data-testid="transport-overlay"
        >
          {match(lifecycle())
            .with({ kind: "disconnected" }, () => (
              <>
                <div class="font-semibold text-fg mb-1">
                  Disconnected from server
                </div>
                <div class="text-fg-3">Reconnecting…</div>
              </>
            ))
            .with({ kind: "restarted" }, () => (
              <>
                <div class="font-semibold text-fg mb-1">Server updated</div>
                <div class="text-fg-3 mb-4">
                  Reload to apply the latest version.
                </div>
                <button
                  type="button"
                  class="bg-accent text-surface-1 font-semibold rounded px-3 py-1.5 hover:opacity-90"
                  onClick={async () => {
                    // Force the SW update to install *before* reload, so the
                    // single navigation below lands on the fresh SW. Without
                    // this, `location.reload()` serves old precached assets
                    // while the new SW is still installing — the user sees
                    // stale UI until a second reload. No-op on HTTP
                    // (serviceWorker is undefined in insecure contexts).
                    const reg =
                      await navigator.serviceWorker?.getRegistration();
                    await reg?.update();
                    location.reload();
                  }}
                >
                  Reload
                </button>
              </>
            ))
            .otherwise(() => null)}
        </div>
      </div>
    </Show>
  );
};

export default TransportOverlay;
