/** Resolve a user-entered URL to an `iframe src` (issue #633).
 *
 *  Phase 0: normalize only. Phase 1 will rewrite `http://localhost:NNNN` →
 *  `https://NNNN.preview.<host>/` through the Hono reverse proxy so that
 *  Vite HMR WebSockets and absolute asset paths just work. Phase 2 feeds
 *  user-selected URLs from terminal stdout scans through the same seam.
 *
 *  This single-file seam is the Lowy encapsulation of the "URL resolution
 *  strategy" volatility — later phases change `resolveTileUrl` only; no
 *  tile schema, no RPC contract, no consumer site moves.
 *
 *  Normalization detail: a protocol-less URL (`news.ycombinator.com`)
 *  becomes a *relative* iframe `src` against the current origin, which
 *  makes Kolu's SPA router serve Kolu itself inside the iframe — an
 *  infinite-recursion trap. Prepend `https://` when no scheme is present
 *  so the iframe loads the intended remote site. Inputs that already
 *  carry a scheme (`https:`, `http:`, `about:`, `data:`, `blob:`,
 *  `file:`) pass through unchanged. */
export function resolveTileUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") return trimmed;
  return hasScheme(trimmed) ? trimmed : `https://${trimmed}`;
}

/** RFC 3986 scheme: `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"`. */
function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+\-.]*:/i.test(url);
}
