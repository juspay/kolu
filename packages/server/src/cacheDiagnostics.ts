/**
 * Request-time cache diagnostics for the stale-client investigation.
 *
 * A bare-hostname HTTP/PWA client (no service worker, no Workbox) was replaying
 * a STALE `index.html` on a *normal* reload — only a hard reload cleared it. The
 * server provably returns a fresh, `no-store` shell on every request and sits
 * behind no caching proxy, so the staleness lives entirely in the browser's
 * HTTP cache.
 *
 * This middleware logs the cache-relevant facts for shell navigations and asset
 * misses at INFO, so a deployed build shows EXACTLY what a browser does on a
 * normal (cmd+R) vs hard (cmd+Shift+R) reload. The decisive signal is whether a
 * normal reload even reaches the server for `/`: if no `cache-diag` line appears
 * for a reload that rendered a stale bundle, the browser replayed a cached shell
 * without revalidating — which the `no-store` shell directive then prevents.
 *
 * Low volume: one line per navigation / shell / asset-miss, never per asset hit.
 * Tail it with `journalctl --user -u kolu -f | grep cache-diag`. Remove once the
 * cache behavior is confirmed fixed.
 */

import type { MiddlewareHandler } from "hono";
import { isImmutableAssetPath, isShellPath } from "./cacheControl.ts";
import { log } from "./log.ts";

export const cacheDiagnostics: MiddlewareHandler = async (c, next) => {
  await next();
  const path = c.req.path;
  const isShell = isShellPath(path);
  const isNavigation = c.req.header("sec-fetch-mode") === "navigate";
  const isAssetMiss = isImmutableAssetPath(path) && c.res.status === 404;
  if (!isShell && !isNavigation && !isAssetMiss) return;
  log.info(
    {
      cacheDiag: {
        method: c.req.method,
        path,
        status: c.res.status,
        resCacheControl: c.res.headers.get("cache-control"),
        reqCacheControl: c.req.header("cache-control") ?? null,
        pragma: c.req.header("pragma") ?? null,
        ifNoneMatch: c.req.header("if-none-match") ?? null,
        ifModifiedSince: c.req.header("if-modified-since") ?? null,
        secFetchMode: c.req.header("sec-fetch-mode") ?? null,
        secFetchDest: c.req.header("sec-fetch-dest") ?? null,
        ua: c.req.header("user-agent") ?? null,
      },
    },
    "cache-diag",
  );
};
