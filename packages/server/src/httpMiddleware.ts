/** kolu-server's HTTP middleware — the ONE bridge between the serving stack and
 *  pino. Two halves, composed by {@link koluHttpMiddleware}:
 *
 *  1. {@link routeErrorLogging} — the successor to Hono's catch-all `app.onError`.
 *     Every uncaught route fault is LOGGED before a 500 goes out, so no fault
 *     reaches the client as an unlogged, unexplained error.
 *
 *     This closes a specific blind spot on the iframe-preview route. The route's
 *     own `try` maps a link fault during the remote arm's METADATA dials to a
 *     logged 503, but the streaming body is consumed LATER: for a `text/html`
 *     preview the artifact-sdk decorator (`withArtifactSdk`) drains the body
 *     AFTER the route handler produced its response, so a chunk fault surfaces
 *     there — past the route's `try`. Without this, Effect answers a bare 500
 *     through its default `ErrorReporter` (console, not pino) and the real link
 *     fault never reaches the operator's log. (A NON-html preview streams
 *     straight to the socket, where the same fault errors the stream and resets
 *     the connection — loud at the transport; this is what makes the
 *     html-decorated path equally loud AND logged.)
 *
 *  2. {@link requestLogging} — the successor to `hono-pino`: one debug line per
 *     request and one per response, same shape as before.
 *
 *  **Why middleware rather than an `ErrorReporter.layer` / `Logger.layer`.** A
 *  process-wide bridge would also reroute every non-HTTP Effect log line in
 *  kolu-server (the RPC fibers, the padi binder, the reactor) through a second
 *  sink at levels nobody chose — a much larger behavioural change than the one
 *  this wave is making, and one the daemons' distinct fault dispositions would
 *  have to be re-argued against. Middleware keeps the pino logger an INJECTED
 *  sink, scoped to the HTTP surface where the blind spot actually lives, and
 *  directly testable (see `httpMiddleware.test.ts`). If a process-wide reporter
 *  is ever wanted, it is additive to this, not a replacement. */

import type { Logger } from "@kolu/log";
import { Cause, Effect } from "effect";
import {
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

/** The middleware shape, spelled PRECISELY rather than as Effect's own
 *  `HttpMiddleware` interface.
 *
 *  `HttpMiddleware` answers `Effect<HttpServerResponse, any, any>` — it erases
 *  the wrapped app's error and service channels. That erasure is not free at the
 *  composition root: `NodeHttpServer.makeHandler` derives its own requirement
 *  from the MIDDLEWARE's result, so an `any` there surfaces as an `any`
 *  requirement on the whole handler, which the boot then cannot discharge (an
 *  `any` requirement is not `never`, so it fails to run). Stating the
 *  transformation exactly keeps it honest: these middlewares change neither the
 *  error type nor the response type, and add exactly ONE requirement —
 *  `HttpServerRequest`, which the node handler provides per request. */
export type KoluHttpMiddleware = <E, R>(
  httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
>;

/** A cause the ROUTER already has an answer for, in either of the two shapes
 *  Effect's `Respondable` protocol uses:
 *
 *  - an `HttpServerError` — `RouteNotFound` → 404, `RequestParseError` → 400 and
 *    friends carry their own status;
 *  - an `HttpServerResponse` ITSELF, which is respondable and is how a handler
 *    delivers a fully-formed response through the FAILURE channel.
 *
 *  Both pass straight through to the machinery that knows what to do with them.
 *  Logging either as an unhandled fault would turn a 404 into an error line and,
 *  worse, swap a real response for a 500.
 *
 *  The second arm is not hypothetical: `GET /` (the SPA shell) intermittently
 *  arrived here as a Fail carrying its own `HttpServerResponse` — the index.html
 *  file stream, fully formed — and this middleware answered 500, so the browser
 *  got an error page for a request the server had successfully prepared. It is
 *  load-dependent, which is why it hid: never reproduced on an idle box, and
 *  reproduced under CPU saturation inside the adoption VM test, where each 500
 *  also cost the boot poll a retry cycle against its 180s budget. */
const routerAnswered = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.length > 0 &&
  cause.reasons.every(
    (reason) =>
      reason._tag === "Fail" &&
      (HttpServerError.isHttpServerError(reason.error) ||
        HttpServerResponse.isHttpServerResponse(reason.error)),
  );

/** Log every uncaught route fault through pino, then answer a 500. */
export const routeErrorLogging =
  (log: Pick<Logger, "error">): KoluHttpMiddleware =>
  (httpApp) =>
    Effect.catchCause(httpApp, (cause) => {
      // An interrupt is a client that hung up (or our own shutdown), not a
      // fault — Effect maps it to 499/503 itself.
      if (Cause.hasInterruptsOnly(cause) || routerAnswered(cause)) {
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

/** One debug line per request and per response — the `hono-pino` shape, kept so
 *  an operator reading `--verbose` output sees what they saw before.
 *
 *  The response line is skipped for the failures {@link routeErrorLogging}
 *  deliberately re-raises (a 404, a 400 the router answers): their status is
 *  minted downstream, past every middleware, so nothing here can see it. Real
 *  faults DO get a response line, because the fault middleware turns them into a
 *  500 response before this one observes it — which is why the two compose in
 *  that order. Stated because it is a choice, not an oversight. */
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

/** The middleware kolu-server hands its node request handler: the request log
 *  OUTSIDE the fault log, so a faulting request still logs the 500 it produced
 *  rather than dropping its response line. */
export const koluHttpMiddleware = (
  log: Pick<Logger, "debug" | "error">,
): KoluHttpMiddleware => {
  const withErrors = routeErrorLogging(log);
  const withRequests = requestLogging(log);
  return (httpApp) => withRequests(withErrors(httpApp));
};
