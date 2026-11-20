import { Data, Effect, Stream } from "effect";
import {
  Headers,
  type HttpBody,
  HttpRouter,
  HttpServerResponse,
} from "effect/http";
import { getSdkBundle } from "./bundle";
import { decorateHtml } from "./inject";

/** A browser-visible absolute path. Spelled as the router's own `PathInput`
 *  shape so the SAME string can be registered as a route AND injected verbatim
 *  into HTML — no cast, no second validation. */
export type SdkScriptPath = `/${string}`;

/** The one declared fault of this module. Both arms are OPERATIONAL failures
 *  (the boot-time esbuild bundle rejecting; an HTML body that faults or cannot
 *  be read as text) — never a silent skip. It reaches kolu-server's HTTP fault
 *  middleware, which logs it through pino and answers a 500, so the real cause
 *  is visible instead of collapsing into a short body. */
export class ArtifactSdkError extends Data.TaggedError("ArtifactSdkError")<{
  readonly reason: "bundle-build-failed" | "html-body-unreadable";
  readonly cause: unknown;
}> {}

const sdkBundle = Effect.tryPromise({
  try: () => getSdkBundle(),
  catch: (cause) =>
    new ArtifactSdkError({ reason: "bundle-build-failed", cause }),
});

/** Serve the SDK bundle at `sdkScriptPath`.
 *
 *  Immutable long-term caching is safe because the injected `<script src>`
 *  carries `?v=<hash>` — a new bundle gets a new URL. */
export const artifactSdkBundleLayer = (opts: {
  readonly sdkScriptPath: SdkScriptPath;
}) =>
  HttpRouter.add(
    "GET",
    opts.sdkScriptPath,
    Effect.map(sdkBundle, ({ code }) =>
      HttpServerResponse.text(code, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=31536000, immutable",
        },
      }),
    ),
  );

const bodyText = (
  body: HttpBody.HttpBody,
): Effect.Effect<string, ArtifactSdkError> => {
  switch (body._tag) {
    case "Empty":
      return Effect.succeed("");
    case "Uint8Array":
      return Effect.succeed(new TextDecoder().decode(body.body));
    case "Stream":
      return body.stream.pipe(
        Stream.decodeText(),
        Stream.mkString,
        Effect.mapError(
          (cause) =>
            new ArtifactSdkError({ reason: "html-body-unreadable", cause }),
        ),
      );
    default:
      return Effect.fail(
        new ArtifactSdkError({
          reason: "html-body-unreadable",
          cause: new Error(
            `artifact-sdk: a text/html response carried an unreadable ${body._tag} body`,
          ),
        }),
      );
  }
};

const dropStaleValidators = (headers: Headers.Headers): Headers.Headers =>
  Headers.removeMany(headers, ["etag", "content-length"]);

/** Wrap a route handler so its `text/html` 200s carry the SDK `<script>`.
 *
 *  Everything else passes through untouched: a non-200 (an error page, a 416),
 *  and any non-HTML content type (the video/image/PDF preview arms). */
export const withArtifactSdk =
  (sdkScriptPath: SdkScriptPath) =>
  <E, R>(
    handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ): Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E | ArtifactSdkError,
    R
  > =>
    Effect.flatMap(handler, (response) => {
      if (response.status !== 200) return Effect.succeed(response);
      const mime = response.headers["content-type"] ?? "";
      if (!mime.toLowerCase().startsWith("text/html")) {
        return Effect.succeed(response);
      }
      return Effect.gen(function* () {
        const html = yield* bodyText(response.body);
        const { hash } = yield* sdkBundle;
        return HttpServerResponse.text(
          decorateHtml(html, `${sdkScriptPath}?v=${hash}`),
          {
            status: 200,
            headers: dropStaleValidators(response.headers),
            cookies: response.cookies,
          },
        );
      });
    });
