/** `/api/health` is read by four independent consumers (see `healthRoute.ts`),
 *  two of which — `smoke.feature` and the packaged-binary `ci::smoke` recipe —
 *  are frozen text. This is the cheap, local proof that the bytes they expect
 *  are the bytes the route serves. */

import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import { HEALTH_ROUTE_PATH, healthRouteLayer } from "./healthRoute.ts";

describe("healthRouteLayer", () => {
  it(`answers 200 "kolu" at ${HEALTH_ROUTE_PATH}`, async () => {
    const response = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(HttpRouter.toHttpEffect(healthRouteLayer), (handler) =>
          Effect.provideService(
            handler,
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(
              new Request(`http://kolu${HEALTH_ROUTE_PATH}`),
            ),
          ),
        ),
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.body._tag).toBe("Uint8Array");
    if (response.body._tag !== "Uint8Array") throw new Error("unreachable");
    expect(new TextDecoder().decode(response.body.body)).toBe("kolu");
  });
});
