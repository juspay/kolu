/**
 * PWA service-worker lifecycle boundary. Owns registration, update detection,
 * and the "a fresh client build is ready, reload to apply it" signal — so the
 * rest of the app (the `TransportOverlay` card, the reconnect nudge in
 * `App.tsx`) never touches `navigator.serviceWorker` or Workbox directly.
 *
 * Why this is no longer hand-rolled SW juggling: the previous version did
 * `registration.update()` then an immediate `location.reload()`, assuming that
 * `update()` resolving meant the new worker was controlling the page. It
 * doesn't — `update()` resolves once the new worker is *fetched*, long before
 * it activates and claims clients, so the reload was still served by the *old*
 * worker's precache. That is the "stale assets until a force reload" bug: a
 * normal reload raced the activation and lost.
 *
 * The fix hands the lifecycle to `vite-plugin-pwa`'s `registerSW` in `prompt`
 * mode. A new build installs and then *waits* (it does not auto-reload the
 * tab). `onNeedRefresh` fires once it is installed-and-waiting, flipping
 * `swUpdateReady()` so `TransportOverlay` can offer Reload. The reload itself
 * goes through `updateServiceWorker(true)` (the function `registerSW` returns),
 * which messages the waiting worker to `skipWaiting`; with `clientsClaim` on it
 * then takes control, and workbox-window reloads the page on `controllerchange`
 * — i.e. only once the new worker actually controls the page. No `update()`/
 * reload race, no manual `controllerchange` bookkeeping.
 */

import { createSignal } from "solid-js";
import { registerSW } from "virtual:pwa-register";

/** Hourly backstop poll. The fast path is `checkForUpdate()` on server restart
 *  (wired in `App.tsx`): a Kolu deploy restarts the server, the WebSocket
 *  reconnects, and we nudge the worker to look for the new build immediately.
 *  This interval only matters for a tab left open with no reconnect. */
const UPDATE_POLL_MS = 60 * 60 * 1000;

/** True once a freshly-built service worker is installed and waiting — i.e. a
 *  new client build is ready and `reloadForUpdate()` will land on it. Read by
 *  `TransportOverlay` to surface the reload prompt. */
const [swUpdateReady, setSwUpdateReady] = createSignal(false);
export { swUpdateReady };

/** Activates the waiting worker and reloads onto it; `registerSW`'s return.
 *  Assigned synchronously in `initPwa`, so it is defined before any callback
 *  (and thus before `swUpdateReady()` can be true). `undefined` only on plain
 *  HTTP (LAN mode), where the secure-context rule disables service workers. */
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;

/** Latest registration, captured at register time so `checkForUpdate()` can
 *  poke it on demand. `undefined` until registration resolves. */
let registration: ServiceWorkerRegistration | undefined;

/** Register the service worker and wire update detection. Call once at
 *  startup. No-op in dev: with `devOptions` disabled, `virtual:pwa-register`
 *  resolves to a stub whose `registerSW` does nothing. */
export function initPwa(): void {
  updateServiceWorker = registerSW({
    immediate: true,
    // A fresh build is installed and waiting. Surface the prompt rather than
    // reloading a live terminal session; the user picks the moment via
    // `TransportOverlay`'s Reload button (-> reloadForUpdate).
    onNeedRefresh() {
      setSwUpdateReady(true);
    },
    onRegisteredSW(_swScriptUrl, reg) {
      registration = reg;
      if (!reg) return;
      setInterval(() => {
        // Skip while offline — a failed fetch would needlessly churn. Errors
        // (e.g. the server momentarily down mid-deploy) are swallowed; the next
        // poll or the reconnect nudge retries.
        if (typeof navigator !== "undefined" && navigator.onLine === false)
          return;
        void reg.update().catch(() => {});
      }, UPDATE_POLL_MS);
    },
    onRegisterError(err) {
      console.warn("Service worker registration failed:", err);
    },
  });
}

/** Nudge the worker to check for a new build right now. Wired to the
 *  server-restart signal so a deploy is detected the instant the WebSocket
 *  reconnects, rather than waiting for the hourly poll. Errors are swallowed —
 *  detection is best-effort and the poll is the backstop. */
export function checkForUpdate(): void {
  void registration?.update().catch(() => {});
}

/** Apply the waiting build and reload. With a service worker, this skips
 *  waiting and reloads on `controllerchange` — race-free, never the stale
 *  precache. Without one (HTTP/LAN), a plain reload is already fresh: no worker
 *  intercepts it and the server serves the shell `no-cache`. */
export function reloadForUpdate(): void {
  if (updateServiceWorker) void updateServiceWorker(true);
  else location.reload();
}
