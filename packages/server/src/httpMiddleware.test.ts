import { Effect, Stream } from "effect";
import {
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { describe, expect, it, vi } from "vitest";
import { requestLogging, routeErrorLogging } from "./httpMiddleware.ts";

const encode = (s: string) => new TextEncoder().encode(s);

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

    expect(response.status).toBe(500);
    expect(bodyText(response)).toBe("internal server error");
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
    const log = { error: vi.fn() };
    const shell = HttpServerResponse.text("<!doctype html>", {
      headers: { "content-type": "text/html" },
    });

    const failure = await Effect.runPromise(
      withRequest(Effect.flip(routeErrorLogging(log)(Effect.fail(shell)))),
    );

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
