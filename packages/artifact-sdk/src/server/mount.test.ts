/** The decoration combinator rewrites the HTML body (splices the SDK
 *  <script>), so it must not carry forward a strong validator of the
 *  ORIGINAL bytes. serve-dir stamps an `ETag` on every streamed 200/206; if
 *  the combinator preserved it, the decorated HTML would be served with a
 *  validator for a representation we no longer send. */

import { Effect, Stream } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import {
  type ArtifactSdkError,
  artifactSdkBundleLayer,
  withArtifactSdk,
} from "./index";

const decorate = withArtifactSdk("/sdk.js");

/** Render a response body back to text — the assertion surface for every case
 *  below, covering both body shapes the preview route can hand us (a streamed
 *  serve-dir read and an in-memory buffer). */
const bodyText = (
  response: HttpServerResponse.HttpServerResponse,
): Effect.Effect<string> => {
  const body = response.body;
  switch (body._tag) {
    case "Empty":
      return Effect.succeed("");
    case "Uint8Array":
      return Effect.succeed(new TextDecoder().decode(body.body));
    case "Stream":
      return body.stream.pipe(
        Stream.decodeText(),
        Stream.mkString,
        Effect.orDie,
      );
    default:
      return Effect.die(new Error(`unexpected body ${body._tag}`));
  }
};

/** A serve-dir-shaped HTML response: a STREAM body (bytes flow from a bounded
 *  file handle), a strong `ETag`, and a non-validator header. */
const htmlStreamResponse = (html: string) =>
  HttpServerResponse.stream(Stream.make(new TextEncoder().encode(html)), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      etag: '"orig-file-bytes"',
      "content-length": String(html.length),
      "cache-control": "private, max-age=60",
    },
  });

describe("withArtifactSdk HTML decoration", () => {
  it("drops the stale validators of the original bytes and injects the script", async () => {
    const response = await Effect.runPromise(
      decorate(
        Effect.succeed(htmlStreamResponse("<html><body>hi</body></html>")),
      ),
    );
    const body = await Effect.runPromise(bodyText(response));

    expect(response.headers.etag).toBeUndefined();
    expect(body).toContain('<script src="/sdk.js?v=');
    // The stale 28-byte `Content-Length` of the ORIGINAL bytes must not ride
    // along either; the response carries the DECORATED length instead.
    expect(response.headers["content-length"]).toBe(
      String(new TextEncoder().encode(body).length),
    );
    // Non-validator headers the combinator must still preserve.
    expect(response.headers["cache-control"]).toBe("private, max-age=60");
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
  });

  it("leaves non-HTML responses (and their ETag) untouched", async () => {
    const original = HttpServerResponse.stream(
      Stream.make(new TextEncoder().encode("rawbytes")),
      {
        status: 200,
        headers: { "content-type": "video/mp4", etag: '"vid"' },
      },
    );

    const response = await Effect.runPromise(
      decorate(Effect.succeed(original)),
    );

    expect(response).toBe(original);
    expect(response.headers.etag).toBe('"vid"');
    expect(await Effect.runPromise(bodyText(response))).toBe("rawbytes");
  });

  it("leaves a non-200 HTML response untouched (an error page is not a preview)", async () => {
    const original = HttpServerResponse.text("<html>nope</html>", {
      status: 404,
      headers: { "content-type": "text/html", etag: '"err"' },
    });

    const response = await Effect.runPromise(
      decorate(Effect.succeed(original)),
    );

    expect(response).toBe(original);
    expect(response.headers.etag).toBe('"err"');
  });

  // The blind spot the host's fault middleware exists for: a remote preview
  // whose per-chunk
  // dial faults mid-stream is drained HERE, after the handler returned. It must
  // FAIL LOUD (so the fault middleware logs it and answers 500) — never a
  // silently truncated page.
  it("fails loud when the HTML body faults mid-stream", async () => {
    const faulting = HttpServerResponse.stream(
      Stream.make(new TextEncoder().encode("<html>")).pipe(
        Stream.concat(
          Stream.fail(new Error("remote preview chunk bytes=6-11 faulted")),
        ),
      ),
      { status: 200, headers: { "content-type": "text/html" } },
    );

    const error: ArtifactSdkError = await Effect.runPromise(
      Effect.flip(decorate(Effect.succeed(faulting))),
    );

    expect(error._tag).toBe("ArtifactSdkError");
    expect(error.reason).toBe("html-body-unreadable");
    expect(String(error.cause)).toMatch(/faulted/);
  });
});

describe("artifactSdkBundleLayer", () => {
  it("serves the bundle immutably (the ?v=<hash> URL is what busts the cache)", async () => {
    const response = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(
          HttpRouter.toHttpEffect(
            artifactSdkBundleLayer({ sdkScriptPath: "/sdk.js" }),
          ),
          (handler) =>
            handler.pipe(
              Effect.provideService(
                HttpServerRequest.HttpServerRequest,
                HttpServerRequest.fromWeb(new Request("http://kolu/sdk.js")),
              ),
            ),
        ),
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/javascript; charset=utf-8",
    );
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await Effect.runPromise(bodyText(response))).toContain("kolu");
  });
});
