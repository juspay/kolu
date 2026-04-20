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

/** Node `fetch` wraps the underlying network error in `err.cause`; the
 *  `.code` there is the usual POSIX errno string (`ECONNREFUSED`, `EHOSTUNREACH`,
 *  etc.). Returns `undefined` when the error isn't a system error. */
function extractErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "cause" in err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "code" in cause) {
      const code = (cause as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
  }
  return undefined;
}

/** HTML shown inside the iframe when the upstream port refuses the dial.
 *  Intentionally more than a one-liner: the user's mental model is "I
 *  opened a browser tile and nothing loaded," so the page explicitly
 *  names the port, the errno, and the three common root causes. */
function renderUpstreamErrorPage(
  port: number,
  code: string | undefined,
): string {
  const codeLabel = code ?? "connection failed";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Preview unavailable — port ${port}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 560px;
      margin: 4rem auto;
      padding: 0 2rem;
      color: #1f2328;
      line-height: 1.5;
    }
    h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 0.75rem; }
    code { background: #f6f8fa; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.9em; }
    .errno { color: #cf222e; }
    ul { padding-left: 1.25rem; color: #57606a; font-size: 0.9rem; }
    li { margin: 0.35rem 0; }
    .footer { color: #8c959f; font-size: 0.8rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>Kolu preview: nothing listening on port <code>${port}</code></h1>
  <p>The proxy dialed both <code>127.0.0.1:${port}</code> and <code>[::1]:${port}</code> on this host and got <code class="errno">${codeLabel}</code>.</p>
  <p>Common causes:</p>
  <ul>
    <li>No dev server is running on port <code>${port}</code> yet — start it and this page should load on refresh.</li>
    <li>Dev server is running on a <em>different</em> machine than the Kolu process. The proxy can only reach services on the same host as Kolu.</li>
    <li>Dev server is bound to a non-loopback interface (e.g. your Tailscale IP directly) — bind it to <code>127.0.0.1</code> or <code>0.0.0.0</code> so the loopback dial reaches it.</li>
  </ul>
  <p class="footer">Kolu preview proxy (#633)</p>
</body>
</html>
`;
}
