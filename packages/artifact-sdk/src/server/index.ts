/** Self-contained server-side mount for the artifact-sdk. One call from
 *  the host server attaches both responsibilities:
 *
 *    1. GET `<sdkScriptPath>` — serves the in-iframe bundle bytes
 *       (esbuild'd at startup, cached, hash-keyed via `?v=<hash>` query).
 *    2. Hono middleware on `<htmlRoutePrefix>*` — runs AFTER the host
 *       route handler, intercepts `text/html` responses, and splices the
 *       SDK `<script>` tag before `</body>`.
 *
 *  The host server (`packages/server/src/index.ts`) only sees this
 *  module's API. The iframe-preview byte route is left untouched —
 *  artifact-sdk wraps it from outside via the middleware seam. */

import type { Hono } from "hono";
import { getSdkBundle } from "./bundle";
import { decorateHtml } from "./inject";

export interface MountOptions {
  /** Path the SDK bundle is served from. Browser-visible — the URL is
   *  injected verbatim (plus `?v=<hash>`) into HTML responses. */
  sdkScriptPath: string;
  /** Glob pattern for routes whose HTML responses should get the SDK
   *  injected. Must end with `*` (Hono path convention). */
  htmlRoutePrefix: string;
}

/** Wire the artifact-sdk into a Hono app. Idempotent — call once at
 *  server boot, before route registration order matters (the bundle
 *  route uses a literal path so registration order doesn't shadow it). */
export function mountArtifactSdk(app: Hono, opts: MountOptions): void {
  app.get(opts.sdkScriptPath, async () => {
    const { code } = await getSdkBundle();
    return new Response(code, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        // Hash-keyed via `?v=<hash>` in the injected <script src>, so
        // immutable long-term caching is safe — a new bundle gets a
        // new URL.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });

  app.use(opts.htmlRoutePrefix, async (c, next) => {
    await next();
    const res = c.res;
    if (res.status !== 200) return;
    const mime = res.headers.get("content-type") ?? "";
    if (!mime.toLowerCase().startsWith("text/html")) return;
    const body = await res.text();
    const { hash } = await getSdkBundle();
    const decorated = decorateHtml(body, `${opts.sdkScriptPath}?v=${hash}`);
    // Preserve all original headers (Content-Type, X-Content-Type-Options,
    // Cache-Control) — body length changed but Hono doesn't set
    // Content-Length on string responses, so no header drift.
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    c.res = new Response(decorated, { status: 200, headers });
  });
}
