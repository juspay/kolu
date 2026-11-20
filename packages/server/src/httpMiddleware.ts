import type { Logger } from "@kolu/log";
import type { SurfaceAppHttpMiddleware } from "@kolu/surface-app/serve";
import { Cause, Effect } from "effect";
import {
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

export type KoluHttpMiddleware = SurfaceAppHttpMiddleware;

const causeCarriesItsOwnResponse = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.length > 0 &&
  cause.reasons.every(
    (reason) =>
      reason._tag === "Fail" &&
      (HttpServerError.isHttpServerError(reason.error) ||
        HttpServerResponse.isHttpServerResponse(reason.error)),
  );

export const routeErrorLogging =
  (log: Pick<Logger, "error">): KoluHttpMiddleware =>
  (httpApp) =>
    Effect.catchCause(httpApp, (cause) => {
      if (Cause.hasInterruptsOnly(cause) || causeCarriesItsOwnResponse(cause)) {
        return Effect.failCause(cause);
      }
      return Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
        Effect.sync(() => {
          log.error(
            {
              err: Cause.squash(cause),
              method: request.method,
              url: request.url,
            },
            "unhandled error serving request",
          );
          return HttpServerResponse.text("internal server error", {
            status: 500,
          });
        }),
      );
    });

export const requestLogging =
  (log: Pick<Logger, "debug">): KoluHttpMiddleware =>
  (httpApp) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      log.debug(
        { req: { method: request.method, url: request.url } },
        "http request",
      );
      const response = yield* httpApp;
      log.debug({ res: { status: response.status } }, "http response");
      return response;
    });

export const koluHttpMiddleware = (
  log: Pick<Logger, "debug" | "error">,
): KoluHttpMiddleware => {
  const withErrors = routeErrorLogging(log);
  const withRequests = requestLogging(log);
  return (httpApp) => withRequests(withErrors(httpApp));
};
