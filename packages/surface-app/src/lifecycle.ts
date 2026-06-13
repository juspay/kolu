/**
 * @kolu/surface-app/lifecycle — the non-component lifecycle calls.
 *
 * Framework-free (no JSX, no SolidJS): just the browser-side actions an app
 * runs at root setup, before any component mounts — retire a legacy service
 * worker, register the notification worker, or land the deployed build with a
 * cache-busting navigation (`reloadForUpdate`, below — not a plain reload; see
 * its doc). The `/solid` entrypoint re-exports them so `<SurfaceAppProvider>`
 * consumers reach them from one import; this subpath is the obvious home when
 * there's no component in scope (kolu calls `registerServiceWorker()` in
 * `index.tsx` at boot).
 */

import {
  deadTransportError,
  SURFACE_TRANSPORT_RETIRED,
} from "@kolu/surface/client";
import { SHELL_COMMIT_GLOBAL } from "./index";

/** Permanently retire a transport the server rejected as stale (a tab bound to a
 *  previous process). The app's reload affordance is now the only way forward, so
 *  neither a reconnecting wrapper's offline buffer nor oRPC's pending peers may
 *  grow unbounded behind it. Two side-effects, both required for the surface
 *  family's transport (partysocket + oRPC):
 *
 *   - `close()` stops auto-reconnect — partysocket flips `_shouldReconnect` to
 *     false, so it won't re-present the same dead `pid` and be re-rejected in a
 *     loop. A fresh page resets it.
 *   - REPLACING `send` with a throwing stub makes oRPC's `ClientPeer` REJECT each
 *     later request. A `send` that returns normally looks dispatched, then awaits
 *     a response that never arrives (the socket is closed and won't reconnect, so
 *     no close event settles the peer either) — every post-stale call would hang
 *     forever, accumulating unresolved peers; partysocket would also enqueue it
 *     into an unbounded offline buffer (`maxEnqueuedMessages: Infinity`). The
 *     throw rejects through the caller's existing error path instead.
 *
 *  The throw is an `ORPCError` (via `deadTransportError`), NOT a plain `Error`:
 *  the surface family's shared retry fence (`shouldNotRetryORPCError`) only treats
 *  an `ORPCError` as non-retriable. A plain throw would still look like a retriable
 *  transport error, so a streaming consumer on `STREAM_RETRY` (infinite retries)
 *  would re-subscribe forever — and for the terminal attach stream, each retry
 *  fires `onRetry` → `terminal.reset()`, repeatedly clearing the readable buffer
 *  behind the reload overlay. The non-retry shape settles the retired tab instead.
 *
 *  Fire it off the lifecycle's `restarted` event whose `transport` is `"closed"`.
 *  Takes a structural `{ close, send }` (not the concrete socket type) so the
 *  transport library never leaks across the package boundary; `send` is typed
 *  `unknown` because it is overwritten, never called. Framework-free (zero
 *  SolidJS): pure transport manipulation, so it lives beside the other root-setup
 *  primitives rather than behind the reactive `/solid` entry. */
export function retireSocket(ws: { close(): void; send: unknown }): void {
  ws.close();
  ws.send = () => {
    throw deadTransportError(
      SURFACE_TRANSPORT_RETIRED,
      "surface-app: server restarted — reload required (stale tab)",
    );
  };
}

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
  if (typeof window === "undefined") return "dev";
  const commit = (window as unknown as Record<string, unknown>)[
    SHELL_COMMIT_GLOBAL
  ];
  return typeof commit === "string" && commit !== "" ? commit : "dev";
}
