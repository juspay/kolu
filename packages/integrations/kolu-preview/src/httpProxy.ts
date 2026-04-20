/** Hono middleware that fetch-and-streams preview-subdomain requests to
 *  `127.0.0.1:<port>`. Installed early in the middleware chain so it
 *  shortcuts before any app route handler runs. */

import type { MiddlewareHandler } from "hono";
import { matchPreviewHost } from "./hostMatch.ts";
import { buildUpstreamHeaders, stripFramingHeaders } from "./headers.ts";
import { extractErrorCode, renderUpstreamErrorPage } from "./errorPage.ts";

export interface PreviewLogger {
  warn: (obj: unknown, msg: string) => void;
}

export interface PreviewProxyOptions {
  /** Caller tells us whether the browser sees HTTPS — we thread it back
   *  as X-Forwarded-Proto so dev servers generating absolute URLs match. */
  isTls: () => boolean;
  /** Warning logger for upstream unreachable. Logs at warn because this
   *  is an expected error class (dev server not running) rather than a
   *  server bug. */
  log: PreviewLogger;
}

export function previewHttpProxy(opts: PreviewProxyOptions): MiddlewareHandler {
  return async (c, next) => {
    const port = matchPreviewHost(c.req.header("host"));
    if (port === null) return next();

    const source = new URL(c.req.url);
    const path = `${source.pathname}${source.search}`;
    const upstreamHeaders = buildUpstreamHeaders(
      c.req.raw.headers,
      c.req.header("host") ?? "",
      opts.isTls() ? "https" : "http",
    );

    // Node's fetch is address-family-specific: `127.0.0.1` is IPv4 only.
    // Vite 5+ and some other dev servers default to `localhost`, which
    // on systems with `::1` ordered before `127.0.0.1` in DNS resolution
    // binds to IPv6 only. Try v4 first, fall back to v6 on ECONNREFUSED
    // so the user doesn't need to configure `--host 127.0.0.1` on their
    // dev server to make the preview work.
    const targets = [
      `http://127.0.0.1:${port}${path}`,
      `http://[::1]:${port}${path}`,
    ];
    const init: RequestInit = {
      method: c.req.method,
      headers: upstreamHeaders,
      body: c.req.raw.body,
      // Node's undici requires duplex: "half" when body is a stream.
      // Omitted on bodyless requests — undici rejects it there.
      ...(c.req.raw.body ? { duplex: "half" } : {}),
      redirect: "manual",
    } as RequestInit;

    let upstream: Response | undefined;
    let lastErr: unknown;
    for (const target of targets) {
      try {
        upstream = await fetch(target, init);
        break;
      } catch (err) {
        lastErr = err;
        if (extractErrorCode(err) !== "ECONNREFUSED") break;
      }
    }
    if (!upstream) {
      opts.log.warn(
        { err: lastErr, port },
        "preview proxy upstream unreachable",
      );
      const code = extractErrorCode(lastErr);
      return new Response(renderUpstreamErrorPage(port, code), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: stripFramingHeaders(upstream.headers),
    });
  };
}
