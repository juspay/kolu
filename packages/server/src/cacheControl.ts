/**
 * HTTP `Cache-Control` policy for static assets. Pure path→directive map so
 * the server route file stays route-topology only.
 *
 * Four classes:
 * - Vite-hashed `/assets/*` — content-addressed, pinned `immutable` forever.
 * - The SPA shell (`/`, `/index.html`) — `no-store`. `no-cache` was not enough:
 *   a bare-hostname HTTP/PWA client (no service worker, so no Workbox) was
 *   observed replaying a STALE cached `index.html` on a *normal* reload — only a
 *   hard reload cleared it — pinning the app to an old bundle across deploys.
 *   `no-store` removes the entry entirely so a normal reload can never replay a
 *   stale shell. The shell is ~1 KB, refetched per navigation — negligible.
 * - `/sw.js` — `no-cache` so the browser's service-worker update check always
 *   re-fetches it. kolu no longer uses a service worker; `/sw.js` is now a
 *   self-destructing worker that retires any SW an earlier build registered, and
 *   it only does its job if the update check isn't served a stale cached copy.
 * - Everything else — no opinion, let the upstream default stand.
 */
/** The SPA shell's cache directive — the single source of truth. `NO_STORE_PATHS`
 *  below is built from it, and the index.ts SPA-fallback stamps it on client-side
 *  routes (which aren't in `NO_STORE_PATHS`), so the shell policy lives in one place. */
export const SHELL_CACHE_CONTROL = "no-store";

/** A `/assets/*` miss that 404s must not be cached either; semantically distinct
 *  from the shell policy (don't cache a 404), so it carries its own name. */
export const ASSET_MISS_CACHE_CONTROL = "no-store";

const NO_STORE_PATHS = new Set(["/", "/index.html"]);
const REVALIDATE_PATHS = new Set(["/sw.js"]);

/** The content-hashed asset prefix — the one class `getCacheControlHeader`
 *  stamps `immutable`. A *miss* under it must 404, not fall through to the SPA
 *  shell: serving `index.html` (HTML) under a `.js` URL would cache the wrong
 *  MIME `immutable` for a year and break the next load. Kept beside the
 *  directive map so the two can't drift (see `isImmutableAssetPath`). */
const ASSET_PREFIX = "/assets/";

export function getCacheControlHeader(path: string): string | null {
  if (path.startsWith(ASSET_PREFIX)) {
    return "public, max-age=31536000, immutable";
  }
  if (NO_STORE_PATHS.has(path)) {
    return SHELL_CACHE_CONTROL;
  }
  if (REVALIDATE_PATHS.has(path)) {
    return "no-cache, must-revalidate";
  }
  return null;
}

/** True for a content-hashed `/assets/*` request. A miss here must 404 rather
 *  than fall through to the SPA-shell catch-all (see `getCacheControlHeader`). */
export function isImmutableAssetPath(path: string): boolean {
  return path.startsWith(ASSET_PREFIX);
}
