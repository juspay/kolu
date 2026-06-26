/**
 * `POST /api/reconnect?host=<id>` — the failed-card Reconnect button's route.
 *
 * Extracted from `main.ts` as a standalone wiring so the recovery path (the
 * CSWSH Origin gate, the unknown-host 404, the fail-loud missing-session guard,
 * and the `session.reconnect()` side effect) can be exercised in isolation —
 * the route mutates host-session state, so each branch needs a test, not a
 * "watched it work" claim. `main()` calls `registerReconnectRoute(app, deps)`;
 * the route logic lives here once.
 */

import { gateHttpRpcOrigin } from "@kolu/surface/ws-origin";
import type { Context, Hono } from "hono";

/** The minimal slice of the host registry the reconnect route reads — narrowed
 *  from `HostRegistry` so a test can stub it without spawning real sessions. */
export interface ReconnectRegistry {
  has(host: string): boolean;
  getSession(host: string): { reconnect(): void } | undefined;
}

export interface ReconnectRouteDeps {
  registry: ReconnectRegistry;
  /** Allowed extra browser Origins (the same policy the `/rpc/ws` upgrade
   *  applies). Same-origin and non-browser (no Origin) traffic always passes. */
  allowedOrigins: readonly string[];
  log: (line: string) => void;
}

/** Wire `POST /api/reconnect` onto `app`. Mounting via a small handler (rather
 *  than an inline closure in `main`) is what makes the gate / 404 / rearm
 *  branches reachable from a route-level test. */
export function registerReconnectRoute(
  app: Hono,
  { registry, allowedOrigins, log }: ReconnectRouteDeps,
): void {
  app.post("/api/reconnect", (c) =>
    handleReconnect(c, { registry, allowedOrigins, log }),
  );
}

/** The route handler proper — exported so a test can call it against a stub
 *  `Context` without the full Hono router. Returns the `Response` to send. */
export function handleReconnect(
  c: Context,
  { registry, allowedOrigins, log }: ReconnectRouteDeps,
): Response {
  // CSWSH gate, the HTTP analogue of the `/rpc/ws` upgrade gate: this route
  // MUTATES host-session state (`session.reconnect()`), and a cross-site page
  // can issue a CORS-"simple" no-body POST here without a preflight. It can't
  // read the 403, but the gate is the whole point — the side effect below must
  // never run for a disallowed Origin.
  const rejected = gateHttpRpcOrigin(c.req.raw, {
    allowedOrigins,
    onReject: (origin) =>
      log(
        `rejecting reconnect POST: disallowed Origin ${JSON.stringify(origin)}`,
      ),
  });
  if (rejected) return rejected;
  const host = c.req.query("host");
  if (host === undefined || host.length === 0 || !registry.has(host)) {
    return c.json({ error: `unknown host: ${host ?? "<none>"}` }, 404);
  }
  // `has` just proved the host exists, and `has`/`getSession` read the SAME
  // `entries` map, so the session is present. Resolve `getSession`'s
  // `| undefined` with a thrown guard rather than a silent `?.`: were the
  // session ever absent, this route must CRASH (fail loud), never return
  // `{ ok: true }` while quietly skipping the reconnect.
  const session = registry.getSession(host);
  if (session === undefined)
    throw new Error(`reconnect: session missing for known host ${host}`);
  session.reconnect();
  log(`reconnect requested (host=${host})`);
  return c.json({ ok: true });
}
