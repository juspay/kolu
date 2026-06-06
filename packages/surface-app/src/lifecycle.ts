/**
 * @kolu/surface-app/lifecycle — the non-component lifecycle calls.
 *
 * Framework-free (no JSX, no SolidJS): just the browser-side actions an app
 * runs at root setup, before any component mounts — retire a legacy service
 * worker, register the notification worker, or land the deployed build with a
 * plain reload. The `/solid` entrypoint re-exports them so `<SurfaceAppProvider>`
 * consumers reach them from one import; this subpath is the obvious home when
 * there's no component in scope (kolu calls `registerServiceWorker()` in
 * `index.tsx` at boot).
 */

/** Whether the SW API is exposed (any secure context — incl. localhost + the
 *  Chrome insecure-origin flag). The right gate for retirement: a worker on such
 *  an origin is removable here, where a `protocol === "https:"` check would
 *  wrongly skip it (the bug that orphaned kolu's worker). */
const swApiAvailable =
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** Unregister every service worker on this origin and delete its caches. Run on
 *  load so a browser left with a legacy worker self-heals; pairs with the
 *  package's self-destructing `SW_SOURCE`. No-op where the SW API isn't exposed. */
export function retireServiceWorker(): void {
  if (!swApiAvailable) return;
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) void r.unregister();
  });
  if (typeof caches !== "undefined") {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key);
    });
  }
}

/** Register the `/sw.js` worker (the fetch-less notification worker, when the
 *  server serves it via `installFreshStatic({ serviceWorker: "notify" })`). The
 *  notification path in an installed PWA needs an active registration —
 *  `ServiceWorkerRegistration.showNotification()` is the ONLY notification API
 *  that works in `standalone` display mode (the page-level `new Notification()`
 *  constructor is illegal there). This is the `registerServiceWorker()`
 *  counterpart to `retireServiceWorker()`: an app shows notifications OR retires
 *  its worker, never both. It also heals a legacy caching worker — registering at
 *  the same `/` scope replaces it, and the notification worker purges caches on
 *  activate. No-op (resolving `null`) where the SW API isn't exposed. */
export function registerServiceWorker(
  path = "/sw.js",
): Promise<ServiceWorkerRegistration | null> {
  if (!swApiAvailable) return Promise.resolve(null);
  return navigator.serviceWorker.register(path);
}

/** Apply the latest build: a plain reload. With a fetch-less SW (or none) and a
 *  `no-store` shell, this always fetches the current `index.html` — and thus the
 *  current bundle. */
export function reloadForUpdate(): void {
  location.reload();
}
