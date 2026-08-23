/**
 * Drive an app layer the way a Node request reaches it — the shared harness for
 * every test about what this package puts on the wire.
 *
 * It exists in its own file because two suites need it and they need it at
 * different resolutions: `server.test.ts` asserts headers and text, while
 * `dist.test.ts` has to compare COMPRESSED bodies byte for byte (a `.br` body
 * decoded as UTF-8 is not the bytes that were served). So the answer carries
 * `bytes`, and `text` is just that decoded.
 */

import type { Readable } from "node:stream";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, type FileSystem, type Layer, type Path, Stream } from "effect";
import {
  type HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

/** What a driven request answers with — the shape the old `app.request(...)`
 *  `Response` gave these tests, so the assertions stay about behaviour. */
export interface Answer {
  status: number;
  header: (name: string) => string | undefined;
  bytes: Buffer;
  text: string;
}

/** The bytes of a response body, whichever variant carries them. */
const bodyBytes = (
  response: HttpServerResponse.HttpServerResponse,
): Effect.Effect<Buffer> => {
  const body = response.body;
  switch (body._tag) {
    case "Empty":
      return Effect.succeed(Buffer.alloc(0));
    case "Uint8Array":
      return Effect.succeed(Buffer.from(body.body));
    case "Stream":
      return Stream.runFold(
        Stream.orDie(body.stream),
        () => [] as Buffer[],
        (acc, chunk) => [...acc, Buffer.from(chunk)],
      ).pipe(Effect.map(Buffer.concat));
    // A file response on Node is `Raw` around a node `Readable` — the platform
    // hands the stream straight to the socket.
    case "Raw":
      return Effect.promise(async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of body.body as Readable) {
          chunks.push(Buffer.from(chunk as Uint8Array));
        }
        return Buffer.concat(chunks);
      });
    // Not a body shape this harness knows how to read. Empty bytes would make a
    // decode assertion fail somewhere far from the cause — or, worse, pass by
    // comparing empty to empty. Die where the ignorance is.
    default:
      return Effect.die(
        new Error(
          `httpDrive: unhandled response body variant ${JSON.stringify(
            (body as { _tag: string })._tag,
          )} — teach this harness to read it rather than reading it as empty.`,
        ),
      );
  }
};

/**
 * A RAW request target (`request.url` is the untouched `IncomingMessage.url`,
 * never a WHATWG-parsed URL) through the real router, out an
 * `HttpServerResponse`. The platform services are the real Node ones — these
 * tests read real files off a real temp dist, exactly as the Hono ones did.
 */
export const drive = (
  appLayer: Layer.Layer<
    never,
    never,
    | HttpRouter.HttpRouter
    | FileSystem.FileSystem
    | Path.Path
    | HttpPlatform.HttpPlatform
  >,
  target: string,
  headers: Record<string, string> = {},
): Promise<Answer> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* HttpRouter.toHttpEffect(appLayer);
      const request = HttpServerRequest.fromWeb(
        new Request("http://test/", { headers }),
      ).modify({ url: target });
      const response = yield* app.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        // An unmatched route is a 404 here, the way the server's own error
        // handling renders it — never a failed test run.
        Effect.catch((error) =>
          error.reason._tag === "RouteNotFound"
            ? Effect.succeed(
                HttpServerResponse.text("not found", { status: 404 }),
              )
            : Effect.die(error),
        ),
      );
      const bytes = yield* bodyBytes(response);
      return {
        status: response.status,
        header: (name: string) => response.headers[name.toLowerCase()],
        bytes,
        text: bytes.toString("utf8"),
      };
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerHttpServices)),
  );
