/**
 * @kolu/surface-app — pure, framework-free kernels of the freshness contract.
 *
 * These have no dependency on Hono, SolidJS, or surface; they are the bits the
 * `/server` and `/solid` entrypoints (and your app) build on, and the only bits
 * worth unit-testing in isolation. The freshness contract they encode is the
 * hard-won lesson of the four-times-relitigated stale-client bug — see
 * `docs/cache-bug.md` and the Atlas note `docs/atlas/src/content/atlas/surface-app.mdx`.
 */

/** Where the immutable, content-hashed assets live, and which paths are the
 *  never-cached SPA shell. Both are INPUTS (not baked-in) so a non-Vite build
 *  can override the convention. */
export interface FreshnessPaths {
  /** Prefix of content-hashed, `immutable` assets. Default: Vite's `/assets/`. */
  assetPrefix?: string;
  /** Paths served as the `no-store` SPA shell. Default: `["/", "/index.html"]`. */
  shellPaths?: string[];
}

/** The content-hashed asset directory, relative to the dist root (`assets`) —
 *  the on-disk counterpart to the `/assets/` request prefix below. A Bun- or
 *  Vite-built client emits hashed bundles under `<dist>/${ASSET_DIR}/`; the
 *  server pins exactly that prefix `immutable`. Single-sourced here so the
 *  builder (`@kolu/surface-app/bun`) and the server can't disagree on where
 *  hashed assets live. */
export const ASSET_DIR = "assets";

const DEFAULT_ASSET_PREFIX = `/${ASSET_DIR}/`;
const DEFAULT_SHELL_PATHS = ["/", "/index.html"];

/** The SPA shell directive — `no-store`, never `no-cache`. A normal reload must
 *  not be able to replay a cached shell (a pre-`no-store` entry with a 1970
 *  `Last-Modified` earns years of heuristic freshness). */
export const SHELL_CACHE_CONTROL = "no-store";
/** A `/assets/*` miss must 404 and that 404 must not be cached either. */
export const ASSET_MISS_CACHE_CONTROL = "no-store";

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache, must-revalidate";

/** True for a content-hashed `/assets/*` request. A miss here must 404 rather
 *  than fall through to the SPA shell — index.html under a `.js` URL is the
 *  wrong MIME and would be cached `immutable` for a year, poisoning the next load. */
export function isImmutableAssetPath(
  path: string,
  paths: FreshnessPaths = {},
): boolean {
  return path.startsWith(paths.assetPrefix ?? DEFAULT_ASSET_PREFIX);
}

/** The path → `Cache-Control` map. `immutable` ONLY for content-hashed assets;
 *  `no-store` for the shell; `no-cache` for `/sw.js` (so the self-destructing
 *  worker is always re-fetched); no opinion otherwise. Note `immutable` presumes
 *  hashed filenames — an unhashed shell asset never matches the asset prefix and
 *  so never gets pinned. */
export function cacheControlFor(
  path: string,
  paths: FreshnessPaths = {},
): string | null {
  if (isImmutableAssetPath(path, paths)) return IMMUTABLE;
  if ((paths.shellPaths ?? DEFAULT_SHELL_PATHS).includes(path)) {
    return SHELL_CACHE_CONTROL;
  }
  if (path === "/sw.js") return REVALIDATE;
  return null;
}

/** A clean, comparable git ref: a real SHA — not `dev`, not a `-dirty` tree.
 *  Staleness is only claimed between two clean refs, so a dev/dirty build on
 *  either side never false-positives. */
export const isCleanRef = (sha: string | undefined): sha is string =>
  !!sha && sha !== "dev" && !sha.includes("-dirty");

/** True when this browser's build provably differs from the server's: both are
 *  clean refs and they disagree. */
export const clientIsStale = (
  serverCommit: string | undefined,
  clientCommit: string | undefined,
): boolean =>
  isCleanRef(serverCommit) &&
  isCleanRef(clientCommit) &&
  serverCommit !== clientCommit;

/** The self-destructing service worker — the DEFAULT `/sw.js` source for the
 *  no-worker class of app. It exists ONLY to retire a worker an earlier build of
 *  a consumer left registered — the browser's own update check installs it, and on
 *  activation it deletes caches, unregisters itself, and reloads controlled tabs.
 *  Pair with `retireServiceWorker()` (the page-side call). The `/sw.js` route
 *  serves this constant verbatim (see `installFreshStatic` in `./server`), so
 *  there is no separate served file and no lockstep test to maintain.
 *
 *  An app that needs notifications opts into `NOTIFICATION_SW_SOURCE` instead
 *  (`installFreshStatic({ serviceWorker: "notify" })` + `registerServiceWorker()`). */
export const SW_SOURCE = `// @kolu/surface-app: self-destructing service worker (retires a legacy worker).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(retire()));
async function retire() {
  const keys = await caches.keys().catch(() => []);
  await Promise.all(keys.map((key) => caches.delete(key)));
  await self.registration.unregister();
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.navigate(client.url);
}
`;

/** The notification service worker — the opt-in `/sw.js` source for an app that
 *  shows OS notifications (`ServiceWorkerRegistration.showNotification`, the ONLY
 *  notification path that works in an installed PWA — the page-level
 *  `new Notification()` constructor is an illegal constructor in `standalone`
 *  display mode on Chromium).
 *
 *  It is **deliberately fetch-less**: it registers NO `fetch` handler, so it
 *  never intercepts a navigation or asset request and thus *cannot* serve a stale
 *  shell. That is what keeps it compatible with the freshness contract — the
 *  contract bans a *caching* worker, and a worker with no `fetch` handler does
 *  zero caching. On `activate` it still purges any cache a legacy worker left and
 *  `clients.claim()`s, so registering it over an old caching worker heals the
 *  stale-shell bug the same way the self-destructing worker did. `notificationclick`
 *  focuses an open app window (and `postMessage`s the notification's `data` so the
 *  page can route the click — e.g. activate the right terminal) or opens one.
 *
 *  Pair with `registerServiceWorker()` (the page-side call) and
 *  `installFreshStatic({ serviceWorker: "notify" })` (the server side). */
export const NOTIFICATION_SW_SOURCE = `// @kolu/surface-app: notification service worker (fetch-less — never caches).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(takeover()));
async function takeover() {
  const keys = await caches.keys().catch(() => []);
  await Promise.all(keys.map((key) => caches.delete(key)));
  await self.clients.claim();
}
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(focusApp(event.notification.data || {}));
});
async function focusApp(data) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const client = clients.find((c) => "focus" in c);
  if (client) {
    await client.focus();
    client.postMessage({ type: "notificationclick", data });
  } else {
    await self.clients.openWindow(data.url || "/");
  }
}
`;
