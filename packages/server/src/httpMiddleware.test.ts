/** `routeErrorLogging` — the catch-all that makes a fault raised AFTER a route
 *  handler produced its response (the artifact-sdk HTML decorator draining a
 *  faulting preview stream) a LOGGED 500 instead of an unlogged one; and the
 *  guard that keeps a router's own answers (404, 400) out of that path.
 *
 *  Plus `requestLogging` — the `hono-pino` replacement. */

import { Effect, Stream } from "effect";
import {
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";
import { requestLogging, routeErrorLogging } from "./httpMiddleware.ts";

const encode = (s: string) => new TextEncoder().encode(s);

/** A `text/html` body that yields one chunk then FAULTS — mimics a remote
 *  preview whose per-chunk dial drops mid-stream. */
const faultingHtml = () =>
  HttpServerResponse.stream(
    Stream.make(encode("<html>")).pipe(
      Stream.concat(
        Stream.fail(
          new Error("remote preview chunk bytes=6-11 faulted mid-stream"),
        ),
      ),
    ),
    { status: 200, headers: { "content-type": "text/html" } },
  );

/** Mimic the artifact-sdk decorator seam: after the route produced its response,
 *  drain any `text/html` body (which FAULTS if the stream errored) and re-emit
 *  it. Hand-rolled rather than importing `withArtifactSdk` so this test pins the
 *  MIDDLEWARE, not the decorator. */
const draining = (
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse>,
) =>
  Effect.flatMap(handler, (response) =>
    response.body._tag === "Stream" &&
    (response.headers["content-type"] ?? "").startsWith("text/html")
      ? Effect.map(
          Stream.mkString(Stream.decodeText(response.body.stream)),
          (html) => HttpServerResponse.text(html, { status: 200 }),
        )
      : Effect.succeed(response),
  );

const withRequest = <A, E>(
  effect: Effect.Effect<A, E, HttpServerRequest.HttpServerRequest>,
  path = "/api/terminals/local/abc/file/page.html",
) =>
  Effect.provideService(
    effect,
    HttpServerRequest.HttpServerRequest,
    HttpServerRequest.fromWeb(new Request(`http://kolu${path}`)),
  );

/** Read a response body back to text. */
const bodyText = (response: HttpServerResponse.HttpServerResponse): string =>
  response.body._tag === "Uint8Array"
    ? new TextDecoder().decode(response.body.body)
    : `<${response.body._tag}>`;

describe("routeErrorLogging", () => {
  it("LOGS + 500s a fault raised after the handler returned (the decorator draining a faulting stream)", async () => {
    const log = { error: vi.fn() };

    const response = await Effect.runPromise(
      withRequest(
        routeErrorLogging(log)(draining(Effect.succeed(faultingHtml()))),
      ),
    );

    // Loud to the client...
    expect(response.status).toBe(500);
    expect(bodyText(response)).toBe("internal server error");
    // ...AND logged. Without the middleware, Effect answers a bare 500 through
    // its default reporter (console) and the real link fault never reaches pino.
    expect(log.error).toHaveBeenCalledOnce();
    const [payload, message] = log.error.mock.calls[0] as [
      { err: unknown; method: string; url: string },
      string,
    ];
    expect(String(payload.err)).toMatch(/faulted mid-stream/);
    expect(payload.method).toBe("GET");
    expect(payload.url).toContain("/file/page.html");
    expect(message).toBe("unhandled error serving request");
  });

  it("passes a clean response through untouched (only faults are intercepted)", async () => {
    const log = { error: vi.fn() };
    const ok = HttpServerResponse.text("fine");

    const response = await Effect.runPromise(
      withRequest(routeErrorLogging(log)(Effect.succeed(ok))),
    );

    expect(response).toBe(ok);
    expect(log.error).not.toHaveBeenCalled();
  });

  // The router's own answers already carry a status through Effect's
  // `Respondable` protocol. Swallowing them here would turn every unmatched path
  // into a logged 500 — and kill the 404 `ci::dev-smoke` relies on when no static
  // layer is installed.
  it("re-raises a router answer (404) instead of logging it as a fault", async () => {
    const log = { error: vi.fn() };
    const notFound = Effect.flatMap(
      HttpServerRequest.HttpServerRequest,
      (request) =>
        Effect.fail(
          new HttpServerError.HttpServerError({
            reason: new HttpServerError.RouteNotFound({ request }),
          }),
        ),
    );

    const failure = await Effect.runPromise(
      withRequest(Effect.flip(routeErrorLogging(log)(notFound))),
    );

    expect(HttpServerError.isHttpServerError(failure)).toBe(true);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("re-raises a RESPONSE delivered through the failure channel — never a 500 over a real answer", async () => {
    // The second `Respondable` shape: a handler may FAIL with a fully-formed
    // `HttpServerResponse`, which the machinery downstream then sends. Treating
    // that as an unhandled fault replaces a real answer with `500 internal
    // server error`.
    //
    // Found in production shape, not in theory: `GET /` — the SPA shell, an
    // index.html file stream — arrived here exactly this way under load, and the
    // browser got an error page for a request the server had already prepared.
    // Pre-fix this test fails with `status 500` and a logged "unhandled error
    // serving request".
    const log = { error: vi.fn() };
    const shell = HttpServerResponse.text("<!doctype html>", {
      headers: { "content-type": "text/html" },
    });

    const failure = await Effect.runPromise(
      withRequest(Effect.flip(routeErrorLogging(log)(Effect.fail(shell)))),
    );

    // Re-raised verbatim, so the response the handler built is the one that goes
    // out — identity, not a copy.
    expect(failure).toBe(shell);
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("requestLogging", () => {
  it("logs one debug line per request and one per response", async () => {
    const log = { debug: vi.fn() };

    await Effect.runPromise(
      withRequest(
        requestLogging(log)(Effect.succeed(HttpServerResponse.empty())),
        "/api/health",
      ),
    );

    expect(log.debug).toHaveBeenCalledTimes(2);
    const [req] = log.debug.mock.calls[0] as [{ req: { method: string } }];
    const [res] = log.debug.mock.calls[1] as [{ res: { status: number } }];
    expect(req.req.method).toBe("GET");
    expect(res.res.status).toBe(204);
  });
});
