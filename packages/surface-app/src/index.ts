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

const DEFAULT_ASSET_PREFIX = "/assets/";
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

/** The self-destructing service worker, as a string the app writes to its
 *  public dir at `/sw.js` (served `no-cache`, see `cacheControlFor`). surface-app
 *  ships NO worker; this one exists ONLY to retire a worker an earlier build of a
 *  consumer left registered — the browser's own update check installs it, and on
 *  activation it deletes caches, unregisters itself, and reloads controlled tabs.
 *  Keep the served copy in lockstep with this constant (a test should assert it). */
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
