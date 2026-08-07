/**
 * @kolu/surface-app/lifecycle — the non-component lifecycle calls.
 *
 * Framework-free (no JSX, no SolidJS): just the browser-side actions an app
 * runs at root setup, before any component mounts — retire a legacy service
 * worker, register the notification worker, or land the deployed build with a
 * cache-busting navigation (`reloadForUpdate`, below — not a plain reload; see
 * its doc). The `/solid` entrypoint re-exports them so `<SurfaceAppProvider>`
 * consumers reach them from one import; this subpath is the obvious home when
 * there's no component in scope (kolu, and any browser consumer, calls
 * `registerOrRetireServiceWorker()` here at boot).
 */

import { DEV_COMMIT, SHELL_COMMIT_GLOBAL } from "./index";

// `retireSocket` is GONE (PLAN D5 / review #5). It used to close a stale-rejected
// partysocket and POISON its `send` with a throwing `ORPCError`, because oRPC's
// `ClientPeer` would otherwise await a response that could never arrive and
// partysocket would keep re-presenting the same dead `pid`. Both reasons died with
// the transport: `websocketLink`'s terminal-close classifier (fed
// `isStaleProcessClose` by `./connect`) HALTS the retry schedule on the stale close
// and fails every in-flight and future call with `SurfaceTransportRetired` — a
// declared, non-retriable surface error the face's fence refuses to retry. There is
// no send to poison and nothing for a consumer to retire; the wire reports the
// terminal `WireStatus` `"retired"` and `createServerLifecycle` reads it as
// `restarted` / `transport: "closed"`.

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

/** Boot-time composition of the two leaves above: register the notification
 *  worker, and if registration fails (e.g. dev, where `/sw.js` isn't served)
 *  fall back to `retireServiceWorker()` so the origin is still left with NO
 *  caching worker — never just "no OS banner" while a legacy stale-serving
 *  worker lingers. This IS the register-or-retire invariant the two leaves'
 *  docstrings describe ("an app shows notifications OR retires its worker, never
 *  both") — owned here as ONE primitive rather than re-authored per surface, so a
 *  change to the policy (the log, the fallback) lands in one place. Every root
 *  setup that wants notifications calls this; the granular
 *  `registerServiceWorker`/`retireServiceWorker` remain the escape hatch for an
 *  app that needs to compose them differently. Returns the settled promise so a
 *  test (or a caller that wants to) can await the policy; root setup `void`s it. */
export function registerOrRetireServiceWorker(path = "/sw.js"): Promise<void> {
  return registerServiceWorker(path).then(
    () => {},
    (err) => {
      console.debug(
        "notification worker registration failed, retiring any SW:",
        err,
      );
      retireServiceWorker();
    },
  );
}

/** Apply the latest build with a plain `location.reload()`. A normal reload
 *  always REVALIDATES the `no-store` shell with the server (browsers bypass
 *  cache freshness for the main document on reload), so the reloaded page IS
 *  the deployed shell — and the hashed `/assets/*` bundle it names is the
 *  deployed bundle, identical-by-content wherever the `immutable` cache serves
 *  it. The infinite "App updated" loop this call was once blamed for was never
 *  the reload's fault: the commit stamp used to ride INSIDE the immutable
 *  bundle, so a stamp-only deploy changed the bytes under an unchanged
 *  filename and returning browsers stayed pinned on the old stamp
 *  (kolu#1319). Identity now rides the shell (`SHELL_COMMIT_GLOBAL`), making a
 *  plain reload sufficient; the cache-busting `?__surface_app_fresh`
 *  navigation (#1278) targeted a layer that was never stale — and, by landing
 *  on a different cache key, skipped revalidating the bare-`/` entry it meant
 *  to escape — so it is retired (`lifecycle.test.ts` pins the plain reload). */
export function reloadForUpdate(): void {
  location.reload();
}

/** This client's build commit, read off the shell global the build injected
 *  (`SHELL_COMMIT_GLOBAL` — see `./index` for why identity rides the
 *  `no-store` shell and never a hashed asset; kolu#1319). Falls back to
 *  `"dev"` when the shell carries no stamp (a dev server, a test DOM):
 *  `clientIsStale` treats `"dev"` as never-stale, so a missing stamp can't
 *  false-positive the update prompt. Pass it to the provider —
 *  `clientCommit={shellCommit()}`. */
export function shellCommit(): string {
  if (typeof window === "undefined") return DEV_COMMIT;
  const commit = (window as unknown as Record<string, unknown>)[
    SHELL_COMMIT_GLOBAL
  ];
  return typeof commit === "string" && commit !== "" ? commit : DEV_COMMIT;
}
