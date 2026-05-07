/**
 * HTTP `Cache-Control` policy for static assets. Pure path→directive map so
 * the server route file stays route-topology only.
 *
 * Three classes:
 * - Vite-hashed `/assets/*` — content-addressed, pin forever.
 * - SPA shell + fixed-name public assets — must revalidate on every request so
 *   deploys roll out on first reload. `/sw.js` is owned by an explicit legacy
 *   cleanup route, not static file policy.
 * - Everything else — no opinion, let the upstream default stand.
 */
const REVALIDATE_PATHS = new Set([
  "/",
  "/index.html",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/sounds/notification.mp3",
]);

export function getCacheControlHeader(path: string): string | null {
  if (path.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  if (REVALIDATE_PATHS.has(path)) {
    return "no-cache, must-revalidate";
  }
  return null;
}
