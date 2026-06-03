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
import { lifecycle, serverInfo } from "./rpc/rpc";
import { clientIsStale } from "./ui/commitRef";

/** Hourly backstop poll. The fast path is `checkForUpdate()` on server restart
 *  (wired in `App.tsx`): a Kolu deploy restarts the server, the WebSocket
 *  reconnects, and we nudge the worker to look for the new build immediately.
 *  This interval only matters for a tab left open with no reconnect. */
const UPDATE_POLL_MS = 60 * 60 * 1000;

/** Whether the browser exposes the service-worker API at all — exactly
 *  `registerSW`'s own gate (`"serviceWorker" in navigator`), true in any secure
 *  context INCLUDING `http://localhost`. This is NOT "should the SW update path
 *  run" (that's `serviceWorkerSupported`, which is stricter). It answers only
 *  "can a worker be registered/unregistered here?", which is the right gate for
 *  two API-touching ops: NOT registering where a register would otherwise take
 *  effect, and tearing down a stale worker on a localhost dev origin. */
const serviceWorkerApiAvailable =
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** Whether the service-worker update path should run. Beyond the API being
 *  available (`serviceWorkerApiAvailable`), we ALSO require an HTTPS origin —
 *  deliberately excluding `http://localhost`, which is a secure context where a
 *  SW *would* register. Rationale: a SW only earns its keep on real HTTPS
 *  deploys (the race-free reload of #1125); on `http://localhost` it just adds a
 *  precache that can serve stale assets — the exact failure this area keeps
 *  hitting. Production bare-hostname HTTP (e.g. `http://host:7692`) is already
 *  excluded because the API isn't exposed outside a secure context. So the SW
 *  runs on HTTPS only; everywhere else falls to the no-SW path (durable
 *  stale-commit + restart prompt, plain `location.reload()` onto the `no-store`
 *  shell). This gates BOTH the update-path branching here AND `initPwa`'s
 *  registration — so on `http://localhost` we never register a worker whose
 *  precache the no-SW `reloadForUpdate()` would then race against. When `false`,
 *  no SW callback ever fires, `swUpdateReady()` stays `false`, and the returned
 *  `updateServiceWorker` is an inert no-op — callers branch on THIS, not on the
 *  truthiness of `updateServiceWorker` (which `registerSW` returns even with no
 *  SW present). */
const serviceWorkerSupported =
  serviceWorkerApiAvailable &&
  typeof location !== "undefined" &&
  location.protocol === "https:";

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
 *  - Without a SW (any non-HTTPS origin — plain HTTP, LAN, a bare-hostname
 *    deploy, or `http://localhost`; see `serviceWorkerSupported`): no SW callback
 *    can ever fire, so derive the prompt from two signals. `restarted` catches a
 *    deploy live — but it is transient, so a backgrounded tab that missed the
 *    reconnect never sees it. `clientIsStale` is the durable backstop: whenever
 *    the running bundle's baked-in commit provably differs from the server's, the
 *    tab is out of date no matter when it connected. `reloadForUpdate()` is a
 *    plain `location.reload()` here, and the server serves `index.html`
 *    `no-store`, so the reload always lands on the fresh bundle. */
export function updateReady(): boolean {
  if (serviceWorkerSupported) return swUpdateReady();
  return (
    lifecycle().kind === "restarted" ||
    clientIsStale(serverInfo()?.commit, __KOLU_COMMIT__)
  );
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

/** Dev-only: unregister any stale production service worker. A worker left over
 *  from a prod build would intercept dev-server requests and serve cached assets
 *  indefinitely, so we tear it down rather than register one. Guarded on
 *  `serviceWorkerApiAvailable`, NOT `serviceWorkerSupported`: the dev server
 *  runs on `http://localhost`, which fails the HTTPS gate but still exposes the
 *  SW API — so the stricter predicate would skip the very cleanup this exists
 *  for. On plain HTTP/LAN the API isn't exposed, so this stays inert there. */
export function unregisterStaleServiceWorkers(): void {
  if (!serviceWorkerApiAvailable) return;
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const r of registrations) r.unregister();
  });
}

/** Register the service worker and wire update detection. Call once at
 *  startup. No-op in dev: with `devOptions` disabled, `virtual:pwa-register`
 *  resolves to a stub whose `registerSW` does nothing.
 *
 *  Gated on `serviceWorkerSupported` (HTTPS only). `registerSW`'s own internal
 *  gate is just `"serviceWorker" in navigator`, which is also true on
 *  `http://localhost` — so a production build served over `http://localhost`
 *  would otherwise register a precaching worker even though every other path in
 *  this module treats that origin as no-SW. That mismatch is the bug: a
 *  registered precache with a `reloadForUpdate()` that does a plain
 *  `location.reload()` the precache can intercept and serve stale. So we simply
 *  don't register off HTTPS; the no-SW path (durable stale-commit prompt + plain
 *  reload onto the `no-store` shell) takes over. */
export function initPwa(): void {
  if (!serviceWorkerSupported) return;
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
        if (!navigator.onLine) return;
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
