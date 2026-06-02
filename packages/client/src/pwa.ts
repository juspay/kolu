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
import { lifecycle } from "./rpc/rpc";

/** Hourly backstop poll. The fast path is `checkForUpdate()` on server restart
 *  (wired in `App.tsx`): a Kolu deploy restarts the server, the WebSocket
 *  reconnects, and we nudge the worker to look for the new build immediately.
 *  This interval only matters for a tab left open with no reconnect. */
const UPDATE_POLL_MS = 60 * 60 * 1000;

/** Whether a service worker can register at all. This is exactly the gate
 *  `registerSW` itself checks (`"serviceWorker" in navigator`), which is only
 *  ever true in a secure context — so it's also `false` on plain HTTP (LAN
 *  mode). It is the single source of truth for "is the SW update path live?":
 *  when `false`, no SW callback ever fires, so `swUpdateReady()` stays `false`
 *  forever and the returned `updateServiceWorker` is an inert no-op. Callers
 *  branch on this, NOT on the truthiness of `updateServiceWorker` (which
 *  `registerSW` returns even with no SW present). */
export const serviceWorkerSupported =
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** True once a freshly-built service worker is installed and waiting — i.e. a
 *  new client build is ready and `reloadForUpdate()` will land on it. Only ever
 *  flips when a SW is present (it is driven by `onNeedRefresh`); on plain
 *  HTTP/LAN it stays `false`, which is why `updateReady()` falls back to the
 *  server-restart signal there. */
const [swUpdateReady, setSwUpdateReady] = createSignal(false);

/** Should the app offer a "reload to apply the latest build" prompt right now?
 *  The single accessor `TransportOverlay` reads — it never reasons about SW
 *  availability or lifecycle itself.
 *
 *  - With a SW: the accurate "installed-and-waiting" signal. A server restart
 *    that ships *unchanged* assets does not nag a reload, and clicking Reload is
 *    race-free (activates the waiting worker, reloads on `controllerchange`).
 *  - Without a SW (HTTP/LAN): no SW callback can fire, so fall back to the old
 *    heuristic — a server restart (new process id) likely means a deploy with
 *    new assets, so offer a plain reload. */
export function updateReady(): boolean {
  return serviceWorkerSupported
    ? swUpdateReady()
    : lifecycle().kind === "restarted";
}

/** Activates the waiting worker and reloads onto it; `registerSW`'s return.
 *  Assigned synchronously in `initPwa`. Note `registerSW` returns this function
 *  even when no service worker is present (plain HTTP/LAN): there it resolves to
 *  an inert no-op that never reloads. So `reloadForUpdate` must NOT decide which
 *  path to take from this being defined — it branches on `serviceWorkerSupported`. */
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
 *  precache. Without one (HTTP/LAN), `updateServiceWorker` is an inert no-op
 *  (see its doc), so we must call `location.reload()` ourselves — a plain
 *  reload is already fresh there: no worker intercepts it and the server serves
 *  the shell `no-cache`. */
export function reloadForUpdate(): void {
  if (serviceWorkerSupported && updateServiceWorker)
    void updateServiceWorker(true);
  else location.reload();
}
