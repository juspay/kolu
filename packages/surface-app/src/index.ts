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

/** The query param a cache-busting reload appends to escape a *poisoned* shell
 *  cache entry. `SHELL_CACHE_CONTROL` (above) stops NEW poisoning, but a browser
 *  that cached `/` in a pre-`no-store` era keeps serving that stale entry on a
 *  normal reload (years of heuristic freshness) WITHOUT revalidating — so a plain
 *  `location.reload()` can never reach the `no-store` shell and the update prompt
 *  loops forever (see `docs/cache-bug.md`). The value is irrelevant to
 *  correctness: its only job is to make the URL a key the poisoned bare-`/` entry
 *  can't satisfy. */
export const CACHE_BUST_PARAM = "v";

/** `href` with `CACHE_BUST_PARAM` set to `token` — the navigation target that
 *  forces a poisoned browser past its stale `/` entry to the network (→ the
 *  `no-store` shell → the current bundle). `set` (not `append`) so a tab that
 *  busts repeatedly keeps a single param. Pure, so the navigation decision is
 *  unit-tested without a DOM; `reloadForUpdate` supplies a fresh token and applies
 *  the result with `location.replace`. */
export function cacheBustedShellUrl(href: string, token: string): string {
  const url = new URL(href);
  url.searchParams.set(CACHE_BUST_PARAM, token);
  return url.href;
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

/** The `postMessage` discriminator the notification worker stamps on the click
 *  envelope it sends to the page (`{ type: SW_MESSAGE_TYPE, data }`). This is the
 *  receptacle's stable contract: the worker source below interpolates this same
 *  constant, and the page-side listener imports it to match — so a rename here is
 *  a compile error on the page instead of a silently-dropped click. */
export const SW_MESSAGE_TYPE = "notificationclick";

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
 *  stale-shell bug the same way the self-destructing worker did. Crucially, when
 *  it actually finds caches to purge — the tell-tale of a legacy *caching* worker
 *  that was just controlling these tabs and may have served them a stale shell —
 *  it also navigates the open window clients, so a tab still running the old
 *  in-memory build lands on the fresh shell with no user action (the same
 *  no-reload-needed guarantee `SW_SOURCE` gives). A clean first install finds no
 *  caches, so it never reloads a tab gratuitously. `notificationclick` focuses an
 *  open app window (and `postMessage`s the notification's `data` so the page can
 *  route the click — e.g. activate the right terminal) or opens one.
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
  // Caches present means a legacy *caching* worker was just controlling these
  // tabs — the navigation that triggered this activation may have been served a
  // stale shell from its cache. Reload the open windows onto the fresh shell so
  // retirement needs no user action (matching SW_SOURCE). A clean first install
  // finds no caches and skips this, so it never reloads a tab gratuitously.
  if (keys.length > 0) {
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) client.navigate(client.url);
  }
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
    client.postMessage({ type: ${JSON.stringify(SW_MESSAGE_TYPE)}, data });
  } else {
    await self.clients.openWindow("/");
  }
}
`;

// ── Stale-tab handshake (the restart axis's wire contract) ────────────────────
// A surface app mints a fresh `processId` per boot (see `serverIdentity` in
// `/server`). A tab open across a restart reconnects to the NEW process and
// replays its live subscriptions against state the fresh process never had. The
// handshake closes that window at the connection boundary: the client echoes its
// last-known id as a query param on every (re)connect; the server rejects a
// mismatch before the transport upgrades. These three framework-free pieces are
// the shared contract both ends (and both runtimes — Node and Bun) build on; the
// per-runtime extraction and the close itself stay in the consumer.

/** WebSocket URL query param carrying the client's last-known server
 *  `processId`. The client echoes it on every (re)connect so the server can
 *  recognize a stale tab reconnecting to a RESTARTED instance at the handshake —
 *  before any live subscription replays. Absent on the first connect (the client
 *  hasn't observed an identity yet). */
export const SERVER_PROCESS_ID_PARAM = "pid";

/** WebSocket close code the server uses to reject a client bound to a previous
 *  process (its `pid` no longer matches the live `processId`). In the application
 *  range (4000–4999, per RFC 6455 §7.4.2). */
export const STALE_PROCESS_CLOSE_CODE = 4001;

/** The pure stale-tab decision: does a reconnecting client's claimed processId
 *  belong to a previous instance? `true` → reject it (the caller closes with
 *  `STALE_PROCESS_CLOSE_CODE`); `false` → let the handshake proceed. An absent
 *  `claimedPid` (the first-ever connect, before the client observed an identity)
 *  always passes. A total function of two strings — no transport, no request
 *  object — so it's identically callable from a Node `IncomingMessage` host and a
 *  Bun Fetch-`Request` host; each extracts `claimedPid` with
 *  `SERVER_PROCESS_ID_PARAM` off its own request and applies the close itself.
 *  `liveId` MUST be the same id the `identity.info` probe reports (see
 *  `serverIdentity`), or the gate compares against an id the client never saw. */
export function rejectStaleProcess(
  claimedPid: string | null,
  liveId: string,
): boolean {
  return claimedPid !== null && claimedPid !== liveId;
}
