/**
 * Service-worker retirement + the "reload to apply the latest build" signal.
 *
 * kolu does NOT use a service worker. A SW buys an always-connected terminal app
 * nothing — it can't work offline (no live WebSocket = no app), and content-hashed
 * assets are already `immutable`-cached by the HTTP cache — while it reliably
 * produced stale-client-after-deploy bugs: the precache served an old build on a
 * normal reload, only a hard reload bypassed it (see `docs/cache-bug.md`).
 *
 * Earlier builds DID register one (via vite-plugin-pwa), so this module's job is
 * now twofold:
 *
 *  1. `retireServiceWorker()` — tear down any worker a previous build left
 *     registered, and delete its caches. Paired with the self-destructing
 *     `public/sw.js`, which the browser's own update check installs to unregister
 *     a worker even while it still controls the page (when the client JS can't
 *     run to do it). Together they retire a deployed SW with no user action.
 *  2. The freshness UX — `updateReady()` (should we prompt a reload?) and
 *     `reloadForUpdate()` (do it). With no SW, entry-point freshness is the
 *     server's `no-store` shell, so a plain `location.reload()` always lands on
 *     the current bundle.
 */

import { lifecycle, serverInfo } from "./rpc/rpc";
import { clientIsStale } from "./ui/commitRef";

/** Whether the browser exposes the service-worker API — true in any secure
 *  context, INCLUDING `http://localhost` and origins made secure via Chrome's
 *  insecure-origin flag. This is the right gate for retirement: a worker
 *  registered on such an origin is removable here, whereas a
 *  `location.protocol === "https:"` check would wrongly skip it (the exact bug
 *  that orphaned a worker on a flag-secured `http://` origin). On a genuinely
 *  insecure origin the API isn't exposed, so retirement is a no-op there. */
const serviceWorkerApiAvailable =
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** Unregister every service worker on this origin and delete its caches. Run on
 *  every load (`index.tsx`) so a browser left with a legacy worker self-heals.
 *  The self-destructing `public/sw.js` covers the case where that worker is still
 *  controlling the page when this can't yet run. A no-op where the SW API isn't
 *  exposed (plain HTTP/LAN — no worker can exist there). */
export function retireServiceWorker(): void {
  if (!serviceWorkerApiAvailable) return;
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) void r.unregister();
  });
  if (typeof caches !== "undefined") {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key);
    });
  }
}

/** Should the app offer a "reload to apply the latest build" prompt right now?
 *  `restarted` (new server process id) catches a deploy live but is transient —
 *  a backgrounded tab that missed the reconnect never sees it. `clientIsStale` is
 *  the durable backstop: whenever the running bundle's baked-in commit provably
 *  differs from the server's, the tab is out of date no matter when it connected
 *  (the same comparison behind the chrome bar's `≠ srv` badge). */
export function updateReady(): boolean {
  return (
    lifecycle().kind === "restarted" ||
    clientIsStale(serverInfo()?.commit, __KOLU_COMMIT__)
  );
}

/** Apply the latest build: a plain reload. With no service worker intercepting
 *  and the server serving the shell `no-store`, this always fetches the current
 *  `index.html` — and thus the current bundle. */
export function reloadForUpdate(): void {
  location.reload();
}
