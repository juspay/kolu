/**
 * @kolu/surface-app — pure, framework-free kernels: the freshness contract,
 * the wire's shared vocabulary (paths, close codes, the dial URL), and the
 * fault printer.
 *
 * These have no dependency on Hono, SolidJS, or surface; they are the bits the
 * `/server` and `/solid` entrypoints (and your app) build on, and the only bits
 * worth unit-testing in isolation. The freshness contract they encode is the
 * hard-won lesson of the four-times-relitigated stale-client bug — see
 * `docs/cache-bug.md` and the Atlas note `docs/atlas/src/content/atlas/surface-app.mdx`.
 *
 * ## This file imports NOTHING, and that is a contract
 *
 * A Vite config imports it (kolu's own `vite.config.ts:2` takes `ASSET_DIR` and
 * `NOTIFICATION_SW_SOURCE` from here) and a Vite config is loaded by **Node's
 * ESM loader**, not by a bundler — the same boundary `./vite`'s header describes
 * for itself. Node cannot resolve this package's extensionless relative
 * imports, so ONE `from "./anything"` here — a re-export included — takes down
 * every consumer's dev server with `ERR_MODULE_NOT_FOUND`, and nothing in this
 * package's own unit tests can see it because vitest resolves them fine. It is
 * pinned by `nodeEsm.test.ts`, which READS this file and requires its relative
 * specifiers to be none — stricter than "Node can resolve them", and the cheap
 * twin of the `ci::dev-smoke` lane that caught it (that lane takes three minutes
 * and reads as a timeout waiting for localhost; this fails in milliseconds).
 */

/** Where the immutable, content-hashed assets live, and which paths are the
 *  never-cached SPA shell. Both are INPUTS (not baked-in) so a non-Vite build
 *  can override the convention. */
export interface FreshnessPaths {
  /** Prefix of content-hashed, `immutable` assets. Default: Vite's `/assets/`.
   *  It is the dist-relative directory too — see {@link assetDirOf}, which is
   *  what a Bun build reads to emit under the same prefix its server pins. */
  assetPrefix?: string;
  /** Paths served as the `no-store` SPA shell. Default: `["/", "/index.html"]`. */
  shellPaths?: string[];
}

/** The DEFAULT content-hashed asset directory, relative to the dist root
 *  (`assets`) — the on-disk counterpart to the `/assets/` request prefix below.
 *  A Bun- or Vite-built client that says nothing emits hashed bundles under
 *  `<dist>/${ASSET_DIR}/`; the server pins exactly that prefix `immutable`.
 *  Single-sourced here so the builder (`@kolu/surface-app/bun`) and the server
 *  can't disagree on where hashed assets live — and {@link assetDirOf} is the
 *  same agreement for an app that moves them somewhere else. */
export const ASSET_DIR = "assets";

/** The default request prefix of the immutable, content-hashed assets (Vite's
 *  `/assets/`, derived from `ASSET_DIR`) — the value `FreshnessPaths.assetPrefix`
 *  falls back to. Exported so the server can scope its `precompressed` static
 *  route to exactly this prefix (never the shell) without re-hardcoding the
 *  literal, keeping the "safe to precompress" set single-sourced with the
 *  immutable-asset taxonomy. */
export const DEFAULT_ASSET_PREFIX = `/${ASSET_DIR}/`;

/**
 * A hashed-asset request prefix, checked — the ONE place its shape is judged,
 * so a prefix a build refuses cannot be one a server accepts.
 *
 * WHY THE PREFIX IS SAYABLE AT ALL, since a knob here would otherwise be a
 * defect: an app whose root URL space is somebody ELSE's — olai serves a
 * person's own directory of files at `/`, so `/assets/notes.md` is a page a
 * reader can address — cannot have the bundle answer first, and a `/assets/*`
 * miss deliberately 404s rather than falling through to the shell (invariant
 * #1: an asset miss must never be served HTML). Moving the bundle under a
 * prefix of the app's own choosing is the only fix; `FreshnessPaths` has taken
 * that prefix as an input since the freshness contract was written, and the
 * Vite half honours it through Vite's own `build.assetsDir`. The Bun half is
 * what had no way to say it.
 *
 * Asserted rather than normalised, on this file's fail-fast stance. A prefix
 * that does not start and end with `/` makes `isImmutableAssetPath`'s
 * `startsWith` match a sibling directory (`/assetsX/`) or nothing at all; a
 * bare `/` puts the shell under the immutable contract (kolu#1319); an empty
 * segment or a `..` names no directory under the dist. Each is a
 * misconfiguration, not a degraded mode. Returns the prefix, so the check reads
 * as part of taking the value rather than as a statement standing beside it.
 */
export function assertAssetPrefix(
  assetPrefix: string = DEFAULT_ASSET_PREFIX,
): string {
  const wrong =
    !assetPrefix.startsWith("/") || !assetPrefix.endsWith("/")
      ? "must start and end with `/`"
      : assetPrefix === "/"
        ? "must not be the root, which would put the `no-store` shell under the immutable contract and pin returning browsers to a stale build (kolu#1319)"
        : assetPrefix.includes("//")
          ? "must not contain an empty segment"
          : assetPrefix.split("/").includes("..")
            ? "must not climb out of the dist with `..`"
            : /[?#]/.test(assetPrefix)
              ? "is a path prefix, so it carries no query and no fragment"
              : null;
  if (wrong !== null)
    throw new Error(`assetPrefix ${JSON.stringify(assetPrefix)} ${wrong}.`);
  return assetPrefix;
}

/**
 * …and the dist-relative DIRECTORY that prefix names, which is the same string
 * without its slashes.
 *
 * It is the same string because the static layer serves `<root>/<path>`: a
 * file requested at `/_app/assets/main-abc.js` is
 * `<dist>/_app/assets/main-abc.js` on disk and nowhere else. So a build that
 * emits under one directory and a server pinned to another prefix are not two
 * settings that disagree — they are one setting spelled twice, and this
 * derivation is what stops the second spelling existing.
 * `@kolu/surface-app/bun` reads it to choose its `outdir`, and it is the only
 * caller that needs the directory at all.
 */
export const assetDirOf = (assetPrefix?: string): string =>
  assertAssetPrefix(assetPrefix).slice(1, -1);

/** A `Content-Encoding` token this package will serve a build-time sibling for. */
export type PrecompressedEncoding = "br" | "zstd" | "gzip";
/** The file suffix carrying one encoding's bytes beside the identity asset. */
export type PrecompressedSuffix = ".br" | ".zst" | ".gz";

/** The build-time precompressed siblings: the `Content-Encoding` token a client
 *  offers, and the suffix that carries those bytes beside the identity asset.
 *  ONE table, read by both halves of the socket — `./server`'s `freshStaticLayer`
 *  walks it to negotiate, `./precompress` walks it to EMIT.
 *
 *  Order is the SERVER's preference when a client offers several (a browser
 *  sending `br, zstd, gzip` gets brotli); it is not a ranking of the encodings.
 *  The historical bug was about EXISTENCE, not order: the server has been able
 *  to serve `zstd` since it replaced Hono's `serve-static`, while every
 *  consumer's hand-rolled post-step wrote only `.br`/`.gz` — so `.zst` was never
 *  on disk anywhere and that arm of the negotiation was dead code in production.
 *  A table a builder cannot fail to read is what stops that recurring; the
 *  literal ROWS are pinned in `index.test.ts`, because a table that quietly
 *  loses a row would take the emitter down with it and no test would notice. */
export const PRECOMPRESSED_ENCODINGS: readonly (readonly [
  encoding: PrecompressedEncoding,
  suffix: PrecompressedSuffix,
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
 *  it runs before the module bundle reads it. Pure, and the path for a caller
 *  templating its own shell (`./client`'s note names it); the Bun builder goes
 *  through `injectShellHead` below, which writes this script and the preload
 *  links in one splice. The Vite path injects the same tag through
 *  `transformIndexHtml`. Throws when the template has no `<head>` rather than
 *  silently emitting a shell with no build identity. */
export function injectShellCommit(html: string, commit: string): string {
  return injectShellHead(html, { preloadHrefs: [], commit });
}

/** The `<link rel="modulepreload">` tags, one per href, in order (no hrefs ⇒ the
 *  empty string).
 *
 *  An href that is not a plain `/path` is REFUSED, not escaped: these are hashed
 *  build outputs named from the app's own source filenames, so a quote in one
 *  means something upstream is already wrong, and interpolating it would end the
 *  attribute early and ship a silently broken shell. (`shellCommitScript`
 *  escapes instead — a commit string is arbitrary by nature and it has no
 *  standing to refuse one.) That the target is a JS module at all is settled
 *  where the list is BUILT: `./modulePreload`'s walk refuses a static import
 *  that is not one, so by the time an href reaches this function the assertion
 *  `rel="modulepreload"` makes is already true. */
function modulePreloadLinks(hrefs: readonly string[]): string {
  return hrefs
    .map((href) => {
      if (!/^\/[\w./-]+$/.test(href))
        throw new Error(
          `@kolu/surface-app: refusing to write ${JSON.stringify(href)} into an href attribute — a preload URL must be a plain /path`,
        );
      return `<link rel="modulepreload" href="${href}">`;
    })
    .join("");
}

/** Everything this package puts in the shell's `<head>`, in the ONE order that
 *  is correct: the preload links FIRST — the point of the tags is to start those
 *  chunk fetches at the earliest byte the parser reaches, so nothing may push
 *  them later — then the build identity. Written in a single splice, so the
 *  order is stated here, once, instead of being the reverse of the order two
 *  injector calls happen to appear in.
 *
 *  `preloadHrefs` is `SurfaceClientBuildResult.preloadHrefs` — only the build can
 *  name those files (`./bun`). No preload hrefs ⇒ no preload tags: a shell whose
 *  entry split into nothing carries no trace of this, rather than an empty
 *  artifact in every shell that never splits. */
export function injectShellHead(
  html: string,
  { preloadHrefs, commit }: { preloadHrefs: readonly string[]; commit: string },
): string {
  return insertAfterHead(
    html,
    modulePreloadLinks(preloadHrefs) + shellCommitScript(commit),
  );
}

/** Insert `snippet` right after the shell's `<head>` open tag — the ONE place
 *  anything is added to the head, so no injector can drift into its own idea of
 *  where the head starts. */
function insertAfterHead(html: string, snippet: string): string {
  // Require a real `head` start tag with a tag-name boundary — `<head>` or
  // `<head …>` but NOT `<header>`/`<headless>`. A loose `/<head[^>]*>/` would
  // match `<header>` and inject at the wrong spot, defeating the fail-loud
  // contract for a shell that has no real `<head>`.
  const head = /<head(?:\s|>)/i.exec(html);
  if (!head) {
    throw new Error(
      "@kolu/surface-app: the HTML template has no <head> — the shell would carry no build identity, and the entry's static chunks would cost an extra round trip on first paint",
    );
  }
  const close = html.indexOf(">", head.index);
  if (close === -1) {
    throw new Error(
      "@kolu/surface-app: the HTML template has an unterminated <head> tag",
    );
  }
  const at = close + 1;
  return html.slice(0, at) + snippet + html.slice(at);
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

/** What a thrown value is, said in text a person can put in a bug report — the
 *  printer half of the fault surface (`SurfaceFaultBoundary` on `/solid` is the
 *  catching half). It is the one part of that surface that is not markup, so it
 *  is the part a Node test can pin: a fault card is only worth drawing if what
 *  it draws IS the fault, and the fault arrives as `unknown` — a render can
 *  throw a string, an `undefined`, a `DOMException`, anything.
 *
 *  The STACK when there is one, because the message alone ("undefined is not an
 *  object") names no file, and the whole reason a fault card exists is that the
 *  alternative was a dead tab with the truth in a console nobody opened. V8
 *  prints the header `name: message` as the stack's first line, so that case
 *  is not the message twice; a stack that has LOST the message gets it put
 *  back on the front rather than dropped. "Lost" is decided by whether the
 *  stack's first line IS the current header — EQUALITY, not a substring test:
 *  a short message ("app", "12") is routinely a substring of a Safari frame,
 *  and a shortened reassignment leaves a stale V8 header that contains the
 *  new message, so anything looser waves real losses through. A message-less
 *  Error falls back to the name-prefix test (its V8 header is the bare name);
 *  a multiline message can never equal one line, so it is prepended — the
 *  safe direction: at worst said twice, never dropped.
 *
 *  Never empty: a thrown value that says nothing about itself is still a
 *  fault, and an empty card would read as a page that broke for no reason. */
export const thrownText = (error: unknown): string => {
  if (error instanceof Error) {
    const named = `${error.name}: ${error.message}`;
    if (!error.stack) return named;
    const newline = error.stack.indexOf("\n");
    const firstLine =
      newline === -1 ? error.stack : error.stack.slice(0, newline);
    const carriesMessage =
      error.message === ""
        ? firstLine.startsWith(error.name)
        : firstLine === named;
    return carriesMessage ? error.stack : `${named}\n${error.stack}`;
  }
  const said = String(error);
  return said === ""
    ? "the page threw a value that says nothing about itself"
    : said;
};
