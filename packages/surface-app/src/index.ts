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

/** The default request prefix of the immutable, content-hashed assets (Vite's
 *  `/assets/`, derived from `ASSET_DIR`) — the value `FreshnessPaths.assetPrefix`
 *  falls back to. Exported so the server can scope its `precompressed` static
 *  route to exactly this prefix (never the shell) without re-hardcoding the
 *  literal, keeping the "safe to precompress" set single-sourced with the
 *  immutable-asset taxonomy. */
export const DEFAULT_ASSET_PREFIX = `/${ASSET_DIR}/`;
/** The build-time precompressed siblings, in SERVER PREFERENCE ORDER: the
 *  `Content-Encoding` token a client offers, and the file suffix that carries
 *  those bytes beside the identity asset. ONE table, read by both halves of the
 *  socket — `./server`'s `freshStaticLayer` walks it to negotiate, `./precompress`
 *  walks it to EMIT. They lived apart once, and the gap was a silent bug: the
 *  server has preferred `zstd` since it replaced Hono's `serve-static`, while
 *  every consumer's hand-rolled post-step wrote only `.br`/`.gz` — so the
 *  preferred encoding was never on disk and the negotiation quietly fell through
 *  to second place. A table a builder cannot fail to read is what stops that
 *  recurring. */
export const PRECOMPRESSED_ENCODINGS: readonly (readonly [
  encoding: string,
  suffix: string,
])[] = [
  ["br", ".br"],
  ["zstd", ".zst"],
  ["gzip", ".gz"],
];

/** The default `no-store` shell paths `FreshnessPaths.shellPaths` falls back to.
 *  Exported so the server can assert its `precompressed` route (scoped to
 *  `assetPrefix`) never overlaps the shell — the mechanical half of the kolu#1319
 *  "never serve a compressed shell" invariant. */
export const DEFAULT_SHELL_PATHS = ["/", "/index.html"];

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

/** The global the no-store shell publishes the build commit on
 *  (`window.__SURFACE_APP_COMMIT__`). Build identity rides the SHELL, never a
 *  hashed `/assets/*` file: a commit stamped INSIDE the bundle rewrites the
 *  bytes of a file whose NAME — and so whose year-long `immutable` cache
 *  entry — doesn't change whenever two deploys differ only outside the client
 *  build (a docs-only commit), so every returning browser stays pinned on the
 *  old stamp, looks permanently stale, and the update prompt loops forever
 *  (kolu#1319). The shell is `no-store` — re-fetched on every load — so a
 *  commit carried here is always the deployed one, and the hashed bundle the
 *  shell names is paired with it by content, not by stamp. Read it via
 *  `shellCommit()` (`./lifecycle`). */
export const SHELL_COMMIT_GLOBAL = "__SURFACE_APP_COMMIT__";

/** The inline `<script>` that publishes `commit` on `SHELL_COMMIT_GLOBAL` —
 *  what `injectShellCommit` (and the `surfaceApp()` Vite plugin) puts in the
 *  shell, and what a Nix post-build stamp rewrites (kolu seds its placeholder
 *  in `dist/index.html` ONLY — never in `dist/assets/`). JSON-encoded with
 *  `<` escaped so an arbitrary commit string can't terminate the element. */
export function shellCommitScript(commit: string): string {
  return `<script>${shellCommitScriptBody(commit)}</script>`;
}

/** The inner text of `shellCommitScript` — `window.${SHELL_COMMIT_GLOBAL}=<literal>`,
 *  the `<script>`-less body both the Bun/Nix shell (via `shellCommitScript`) and
 *  the `/vite` plugin need. This is the ONE authoritative copy of the
 *  assignment shape and the `<`-escape that stops an arbitrary commit string
 *  from closing the element. `vite.ts` can't import it across Node's ESM
 *  boundary (see its header), so it carries a byte-identical inline copy that
 *  `vite.test.ts` pins to this function across adversarial commits. */
export function shellCommitScriptBody(commit: string): string {
  const literal = JSON.stringify(commit).replace(/</g, "\\u003c");
  return `window.${SHELL_COMMIT_GLOBAL}=${literal}`;
}

/** Inject the shell-commit script into an HTML shell, right after `<head>` so
 *  it runs before the module bundle reads it. Pure — the Bun builder
 *  (`./bun`) applies it to the template it rewrites; the Vite path injects the
 *  same tag through `transformIndexHtml`. Throws when the template has no
 *  `<head>` rather than silently emitting a shell with no build identity. */
export function injectShellCommit(html: string, commit: string): string {
  // Require a real `head` start tag with a tag-name boundary — `<head>` or
  // `<head …>` but NOT `<header>`/`<headless>`. A loose `/<head[^>]*>/` would
  // match `<header>` and inject at the wrong spot, defeating the fail-loud
  // contract for a shell that has no real `<head>`.
  const head = /<head(?:\s|>)/i.exec(html);
  if (!head) {
    throw new Error(
      "injectShellCommit: the HTML template has no <head> — the shell would carry no build identity",
    );
  }
  const close = html.indexOf(">", head.index);
  if (close === -1) {
    throw new Error(
      "injectShellCommit: the HTML template has an unterminated <head> tag",
    );
  }
  const at = close + 1;
  return html.slice(0, at) + shellCommitScript(commit) + html.slice(at);
}

/** The never-stale sentinel: the commit value that means "don't claim
 *  staleness." `resolveCommit` (`./vite`) falls back to it, `shellCommit`
 *  (`./lifecycle`) falls back to it, and `isCleanRef` treats it as not a clean
 *  ref — so a dev/stampless build on either side never false-positives the
 *  update prompt. The ONE authoritative copy: `lifecycle` imports it; `vite.ts`
 *  is self-contained (Node ESM) and pins its literal to this in `vite.test.ts`. */
export const DEV_COMMIT = "dev";

/** A clean, comparable git ref: a real SHA — not `dev`, not a `-dirty` tree.
 *  Staleness is only claimed between two clean refs, so a dev/dirty build on
 *  either side never false-positives. */
export const isCleanRef = (sha: string | undefined): sha is string =>
  !!sha && sha !== DEV_COMMIT && !sha.includes("-dirty");

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

/** The message type the PAGE posts back to the worker to ACK a delivered click.
 *  The worker retries `postMessage` (a message is dropped if the page hasn't
 *  installed its click listener yet — an open-but-still-LOADING window) until this
 *  ack arrives, then stops; if it never arrives, the worker falls back to the
 *  durable URL handoff (`NOTIFICATION_DATA_PARAM`) by navigating the window. Shared
 *  constant so the worker source and the page-side `onClick` can't drift. */
export const NOTIFICATION_ACK_TYPE = "notify-ack";

/** The URL query param the notification worker uses to hand a click payload to a
 *  COLD-started app (no window was open, so there is no client to `postMessage`).
 *  The worker JSON-encodes the notification's `data` into this param on the URL it
 *  opens; the page-side `onClick` reads it once at startup, routes it through the
 *  same validated path as a live click, then strips it. Without this, a one-action
 *  click on a closed PWA would open the app but DROP the routing payload. */
export const NOTIFICATION_DATA_PARAM = "__notify";

/** The URL query param carrying the click's unique `id` alongside the payload on
 *  the durable URL handoff. When the worker cannot confirm a live delivery and
 *  falls back to NAVIGATING the focused window, the reloaded page reads this id and
 *  skips routing if it already routed the same click live (a small sessionStorage
 *  FIFO survives the navigation) — so a live route followed by a fallback navigate
 *  can never fire the action twice. A cold-start window (a fresh tab) simply routes
 *  it once. Shared so the worker source and the page reader can't drift. */
export const NOTIFICATION_CLICK_ID_PARAM = "__notify_id";

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
 *  open app window and delivers the notification's `data` with an ACK handshake
 *  (`postMessage` retried until the page acks — so a still-LOADING window that has
 *  not installed its click listener yet does not silently drop the click; a durable
 *  URL-param navigate is the fallback if it never acks), or — with no window open —
 *  opens one with the payload in the URL (the cold-start handoff).
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
// Pending ACK waiters, keyed by the in-flight click \`id\`. Bounded to clicks
// currently being delivered: an entry is added when a delivery loop starts and
// removed the instant it is acked OR the loop gives up (\`finally\`), and an ACK for
// an \`id\` no loop is waiting on finds no waiter and is dropped — so the map never
// accumulates unsolicited or stale ids.
const notifyAckWaiters = new Map();
self.addEventListener("message", (event) => {
  const m = event.data;
  if (m && m.type === ${JSON.stringify(NOTIFICATION_ACK_TYPE)} && typeof m.id === "string") {
    const w = notifyAckWaiters.get(m.id);
    if (w) {
      notifyAckWaiters.delete(m.id);
      w();
    }
  }
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(focusApp(event.notification.data || {}));
});
async function focusApp(data) {
  const dataParam = ${JSON.stringify(NOTIFICATION_DATA_PARAM)};
  const idParam = ${JSON.stringify(NOTIFICATION_CLICK_ID_PARAM)};
  // One id per click — stamped on the live postMessage AND the durable URL handoff,
  // so the page dedups a live route against a fallback-navigate re-delivery.
  const id =
    self.crypto && self.crypto.randomUUID
      ? self.crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random();
  const url =
    "/?" + dataParam + "=" + encodeURIComponent(JSON.stringify(data)) +
    "&" + idParam + "=" + encodeURIComponent(id);
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const client = clients.find((c) => "focus" in c);
  if (!client) {
    // No window at all — cold start: open one with the routing payload encoded in
    // the URL so the page can pick it up (the one-action click survives a closed
    // PWA). The page reads and strips the params at startup.
    await self.clients.openWindow(url);
    return;
  }
  await client.focus();
  // Deliver to the (possibly still-LOADING) window with an ACK handshake. A bare
  // postMessage is LOST if the page hasn't installed its click listener yet, so
  // retry until the page acks (it dedups by \`id\` and routes once), then stop. A
  // fully-loaded window acks on the first try — no retries, no reload. The page acks
  // the EXACT delivering worker (via \`event.source\`), so an ack always reaches this
  // loop even mid worker-replacement.
  let acked = false;
  const ackP = new Promise((resolve) => {
    notifyAckWaiters.set(id, () => {
      acked = true;
      resolve();
    });
  });
  try {
    for (let i = 0; i < 20 && !acked; i++) {
      client.postMessage({ type: ${JSON.stringify(SW_MESSAGE_TYPE)}, data, id });
      await Promise.race([ackP, sleep(100)]);
    }
  } finally {
    notifyAckWaiters.delete(id);
  }
  if (acked) return;
  // Never acked within the retry horizon — the page never received/routed the live
  // message. Fall back to the DURABLE URL handoff: navigate the window so its startup
  // reader picks the payload up. The id rides along, so a page that DID route live
  // still dedups across the navigation. Report a failed navigation, never swallow it.
  try {
    await client.navigate(url);
  } catch (err) {
    console.warn("notify sw: fallback navigate failed", err);
  }
}
`;

// ── Stale-tab handshake (the restart axis's wire contract) ────────────────────
// A serving process has one identity — `surfaceProcessId()` from
// `@kolu/surface/identity`, which the framework-reserved `system/identity` member
// answers with. A tab open across a restart reconnects to the NEW process and
// replays its live subscriptions against state the fresh process never had. The
// handshake closes that window at the connection boundary: the client echoes its
// last-known id as a query param on every (re)connect (fed by `./connect`, not by
// app code); the server rejects a mismatch before the transport upgrades
// (`gateStaleSocket` in `/server`, the one door). These two framework-free
// constants are the shared vocabulary both ends — and both runtimes, Node and Bun —
// build on.
//
// The pure `rejectStaleProcess(claimedPid, liveId)` that used to sit here is GONE.
// Its second argument was the hazard it looked like a safeguard against: any id
// could be passed as "live", including one the wire never reports, and a gate
// comparing two unrelated strings rejects every reconnect or none. There is now one
// process id and one door that reads it.

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

/** The path a surface app's ONE websocket lives at — the single source for both
 *  legs. Every consumer used to spell this literal twice, at the server's
 *  `upgrade` handler and at the client's dial URL, which is one fact kept in step
 *  by hand. Both legs now read it here: `serveSurfaceApp` upgrades exactly here
 *  and nowhere else, and kolu's browser wire, its `wireCall` CLI dialler, the e2e
 *  harness's wire and this package's example all build their URL from it.
 *
 *  `serveSurfaceApp` compares `pathname` for EQUALITY, where a hand-written
 *  consumer typically wrote `startsWith("/rpc/ws")` — a deliberate tightening
 *  that a URL built from this constant can never trip, and a hand-typed one with
 *  a trailing slash can. */
export const SURFACE_WS_PATH = "/rpc/ws";

/** The websocket URL a surface app is dialled at, derived from the http(s) base
 *  it is served on. The ONE derivation of that fact: {@link SURFACE_WS_PATH}
 *  unified the path, but the scheme swap stayed copied — kolu's browser wire, its
 *  `wireCall` CLI dialler, the e2e harness's wire and this package's example each
 *  spelled `https: → wss:` by hand, and that mapping is the part that is easy to
 *  get wrong (get it wrong and a TLS-served app dials plaintext, which fails only
 *  in deployment).
 *
 *  Browser-safe: `URL` and nothing else, so the page's own
 *  `` `${location.protocol}//${location.host}` `` goes straight in. */
export const surfaceWsUrl = (httpBaseUrl: string): string => {
  const url = new URL(httpBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = SURFACE_WS_PATH;
  return url.toString();
};
