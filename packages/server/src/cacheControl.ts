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
 * - Service-worker scripts (`/sw.js`, `/registerSW.js`, `workbox-*`) —
 *   `no-cache` so a deploy's new worker is picked up on first reload, while
 *   staying cacheable-but-revalidated so the SW byte-comparison update path
 *   keeps working on secure-context deploys.
 * - Everything else — no opinion, let the upstream default stand.
 */
const NO_STORE_PATHS = new Set(["/", "/index.html"]);
const REVALIDATE_PATHS = new Set(["/sw.js", "/registerSW.js"]);
const WORKBOX_CHUNK = /^\/workbox-[^/]+\.js$/;

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
    return "no-store";
  }
  if (REVALIDATE_PATHS.has(path) || WORKBOX_CHUNK.test(path)) {
    return "no-cache, must-revalidate";
  }
  return null;
}

/** True for a content-hashed `/assets/*` request. A miss here must 404 rather
 *  than fall through to the SPA-shell catch-all (see `getCacheControlHeader`). */
export function isImmutableAssetPath(path: string): boolean {
  return path.startsWith(ASSET_PREFIX);
}
