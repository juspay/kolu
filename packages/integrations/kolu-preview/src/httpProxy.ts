/** Hono middleware that fetch-and-streams preview-subdomain requests to
 *  `127.0.0.1:<port>`. Installed early in the middleware chain so it
 *  shortcuts before any app route handler runs. */

import type { MiddlewareHandler } from "hono";
import { matchPreviewHost } from "./hostMatch.ts";
import { buildUpstreamHeaders, stripFramingHeaders } from "./headers.ts";

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
    const target = `http://127.0.0.1:${port}${source.pathname}${source.search}`;
    const upstreamHeaders = buildUpstreamHeaders(
      c.req.raw.headers,
      c.req.header("host") ?? "",
      opts.isTls() ? "https" : "http",
    );

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: c.req.method,
        headers: upstreamHeaders,
        body: c.req.raw.body,
        // Node's undici requires duplex: "half" when body is a stream.
        // Omitted on bodyless requests — undici rejects it there.
        ...(c.req.raw.body ? { duplex: "half" } : {}),
        redirect: "manual",
      } as RequestInit);
    } catch (err) {
      opts.log.warn({ err, target }, "preview proxy upstream unreachable");
      return c.text(`preview: upstream 127.0.0.1:${port} unreachable`, 502);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: stripFramingHeaders(upstream.headers),
    });
  };
}
