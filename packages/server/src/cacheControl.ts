/**
 * HTTP `Cache-Control` policy for static assets. Pure path→directive map so
 * the server route file stays route-topology only.
 *
 * Three classes:
 * - Vite-hashed `/assets/*` — content-addressed, pin forever.
 * - SPA shell + service-worker scripts — must revalidate on every request so
 *   deploys roll out on first reload (Workbox precache can otherwise serve
 *   stale assets indefinitely; on HTTP deploys where SW is disabled by the
 *   secure-context rule, browser heuristic caching does the same).
 * - Everything else — no opinion, let the upstream default stand.
 */
export function getCacheControlHeader(path: string): string | null {
  if (path.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  if (
    path === "/" ||
    path === "/index.html" ||
    path === "/sw.js" ||
    path === "/registerSW.js" ||
    /^\/workbox-[^/]+\.js$/.test(path)
  ) {
    return "no-cache, must-revalidate";
  }
  return null;
}
