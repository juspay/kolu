/** A catch-all `app.onError` that LOGS every uncaught route/middleware error
 *  before returning a 500 — so no fault reaches the client as Hono's default,
 *  UNLOGGED 500.
 *
 *  This closes a specific blind spot on the iframe-preview route. The route's own
 *  `try` maps a link fault during the remote arm's METADATA dials to a logged 503,
 *  but the streaming body is consumed LATER: for a `text/html` preview the
 *  artifact-sdk decorator (`mountArtifactSdk`) buffers the body via `res.text()`
 *  AFTER the handler has returned, so a chunk fault mid-stream throws INSIDE that
 *  middleware — past the route's `try`. Without a registered `onError`, Hono answers
 *  a bare 500 and the real link fault is never logged (the operator is blind). This
 *  routes those into the logged path — caught-error-must-surface, never a silent or
 *  invisible collapse. (A NON-html preview streams straight to the socket, where the
 *  same fault errors the stream and resets the connection — loud at the transport;
 *  this handler is what makes the html-decorated path equally loud AND logged.) */

import type { Context, Hono } from "hono";

/** The minimal logger shape the handler needs (pino's `error(obj, msg)`). */
export interface ErrorLogger {
  error(obj: unknown, msg?: string): void;
}

export function installRouteErrorLogging(app: Hono, log: ErrorLogger): void {
  app.onError((err: Error, c: Context) => {
    log.error(
      { err, method: c.req.method, path: c.req.path },
      "unhandled error serving request",
    );
    return c.text("internal server error", 500);
  });
}
