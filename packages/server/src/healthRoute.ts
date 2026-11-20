import { HttpRouter, HttpServerResponse } from "effect/http";

export const HEALTH_ROUTE_PATH = "/api/health";

export const HEALTH_BODY = "kolu";

export const healthRouteLayer = HttpRouter.add(
  "GET",
  HEALTH_ROUTE_PATH,
  HttpServerResponse.text(HEALTH_BODY, {
    contentType: "text/plain; charset=utf-8",
  }),
);
