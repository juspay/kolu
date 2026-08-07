/** `/api/health` — kolu-server's liveness probe, and one of the most heavily
 *  pinned bytes in the repo. Four independent consumers read it:
 *
 *    - `packages/tests/features/smoke.feature` ("the response should be
 *      \"kolu\"") — e2e scenario text is immutable;
 *    - `packages/tests/devSmoke.ts` — the `ci::dev-smoke` readiness probe, which
 *      runs WITHOUT `KOLU_CLIENT_DIST`, so this route must exist with no static
 *      layer installed;
 *    - `packages/tests/support/hooks.ts` — every e2e run's server-ready wait;
 *    - `ci/mod.just`'s `smoke` recipe — the packaged binary's boot proof.
 *
 *  So the body is exactly `kolu` and the status is exactly 200, forever. This is
 *  a constant response with no dependencies: it answers as soon as the HTTP
 *  handler is attached, which is precisely what a readiness probe needs. */

import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

/** The probe path. */
export const HEALTH_ROUTE_PATH = "/api/health";

/** The probe body. Frozen by `smoke.feature`. */
export const HEALTH_BODY = "kolu";

export const healthRouteLayer = HttpRouter.add(
  "GET",
  HEALTH_ROUTE_PATH,
  HttpServerResponse.text(HEALTH_BODY, {
    contentType: "text/plain; charset=utf-8",
  }),
);
