/** Server-side artifact-sdk seam, as TWO independent pieces on
 *  `effect/unstable/http`:
 *
 *    1. {@link artifactSdkBundleLayer} — a route layer serving the in-iframe
 *       bundle bytes (esbuild'd at startup, cached, hash-keyed via `?v=<hash>`).
 *    2. {@link withArtifactSdk} — a HANDLER COMBINATOR that intercepts a
 *       `text/html` 200 and splices the SDK `<script>` tag before `</body>`.
 *
 *  Why a combinator rather than the old prefix-glob middleware: Effect's router
 *  middleware (`HttpRouter.middleware`) is scoped to a LAYER, not to a path
 *  pattern, so the `htmlRoutePrefix` argument the Hono mount took could only be
 *  re-spelled as a lie — there is no per-prefix seam to hang it on. The
 *  decoration applies to exactly one route (kolu's iframe-preview byte route),
 *  so the honest shape is a function that wraps THAT handler: the coupling is
 *  visible at the one call site, the combinator is unit-testable with no router
 *  at all, and artifact-sdk stops owning a routing concept it never needed.
 *  `htmlRoutePrefix` (and Hono's "must end with `*`" convention) is gone.
 *
 *  `bundle.ts` and `inject.ts` are framework-free and unchanged. */

import { Data, Effect, Stream } from "effect";
import {
  Headers,
  type HttpBody,
  HttpRouter,
  HttpServerResponse,
} from "effect/unstable/http";
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

/** The cached bundle as an Effect. `getSdkBundle` memoizes across calls (and
 *  clears its slot on rejection), so this stays a plain lift. */
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

/** Read a response body as text. An `Empty` body is legitimately the empty
 *  string (a 200 `text/html` with no bytes still gets the SDK); a `Stream` is
 *  drained — a mid-stream fault surfaces as {@link ArtifactSdkError} rather
 *  than a truncated page. `Raw`/`FormData` cannot be `text/html` in this stack,
 *  so they FAIL LOUD instead of being waved through undecorated. */
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
        // Splicing the SDK <script> changes the body, so the two headers that
        // describe the ORIGINAL bytes must not ride along: serve-dir's strong
        // `ETag` would name a representation we no longer send, and its
        // `Content-Length` would be short. A strong validator must change when
        // the bytes change and we have no honest new one, so we emit NONE;
        // `Content-Length` is re-derived from the decorated body by the
        // response constructor, so dropping the stale one is enough. Every
        // OTHER header (cache-control, content-type, …) carries over verbatim
        // — and unlike Hono's `c.res` setter there is no aliasing footgun to
        // document, because an `HttpServerResponse` is immutable.
        return HttpServerResponse.text(
          decorateHtml(html, `${sdkScriptPath}?v=${hash}`),
          {
            status: 200,
            headers: Headers.removeMany(response.headers, [
              "etag",
              "content-length",
            ]),
            cookies: response.cookies,
          },
        );
      });
    });
