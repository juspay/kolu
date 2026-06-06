/**
 * @kolu/surface-app/lifecycle — the non-component lifecycle calls.
 *
 * Framework-free (no JSX, no SolidJS): just the browser-side actions an app
 * runs at root setup, before any component mounts — retire a legacy service
 * worker, or land the deployed build with a plain reload. The `/solid`
 * entrypoint re-exports both so `<SurfaceAppProvider>` consumers reach them
 * from one import; this subpath is the obvious home when there's no component
 * in scope (kolu calls `retireServiceWorker()` in `index.tsx` at boot).
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

/** Apply the latest build: a plain reload. With no SW and a `no-store` shell,
 *  this always fetches the current `index.html` — and thus the current bundle. */
export function reloadForUpdate(): void {
  location.reload();
}
