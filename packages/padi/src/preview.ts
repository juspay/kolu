import { PreviewTooLarge } from "@kolu/padi-client/surface";
import type { RealpathGuard, ServeResult } from "@kolu/serve-dir";
import { getHeaderCI, serveFile } from "@kolu/serve-dir";
import { Effect } from "effect";
import { assertRealpathUnder } from "kolu-git";

export function previewRealpathGuard(root: string): RealpathGuard {
  return (abs) =>
    Effect.promise(async () => (await assertRealpathUnder(root, abs)).ok);
}

/** The range-capable, serve-dir-shaped byte read behind the preview — the
 *  STREAMING form. Forwards an optional raw HTTP `Range` header to `serveFile`
 *  (206/416/200) and injects the realpath guard. Returns serve-dir's
 *  `ServeResult` verbatim — a `ReadableStream` body on 2xx, a string on errors.
 *  {@link readPreview} wraps it for the wire (base64). */
export function previewFile(input: {
  repoPath: string;
  filePath: string;
  range?: string;
  /** Raw HTTP `If-Range` header — serve-dir honors the `range` only when this
   *  still matches the file's current strong `ETag`, else serves the full 200
   *  (RFC 9110 §13.1.3). Omitted = honor the range unconditionally. */
  ifRange?: string;
}): Effect.Effect<ServeResult> {
  const guard: RealpathGuard = previewRealpathGuard(input.repoPath);
  return serveFile(
    input.repoPath,
    input.filePath,
    input.range,
    guard,
    input.ifRange,
  );
}

const MAX_INLINE_PREVIEW_BYTES = 64 * 1024 * 1024;

function previewTooLarge(): PreviewTooLarge {
  return new PreviewTooLarge({ limitBytes: MAX_INLINE_PREVIEW_BYTES });
}

function resolvedLengthOf(headers: Record<string, string>): number | undefined {
  const v = getHeaderCI(headers, "content-length");
  return v === undefined ? undefined : Number(v);
}

function capByResolvedLength(
  headers: Record<string, string>,
  body: ReadableStream,
): Effect.Effect<void, PreviewTooLarge> {
  return Effect.gen(function* () {
    const resolved = resolvedLengthOf(headers);
    if (resolved === undefined || resolved <= MAX_INLINE_PREVIEW_BYTES) return;
    yield* Effect.promise(() => body.cancel());
    return yield* Effect.fail(previewTooLarge());
  });
}

function bufferBase64Capped(
  body: ReadableStream,
): Effect.Effect<string, PreviewTooLarge> {
  return Effect.tryPromise({
    try: async () => {
      const reader = body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_INLINE_PREVIEW_BYTES) {
          await reader.cancel();
          throw previewTooLarge();
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString("base64");
    },
    catch: (err: unknown) => {
      if (err instanceof PreviewTooLarge) return err;
      throw err;
    },
  });
}

export function readPreview(input: {
  repoPath: string;
  filePath: string;
  range?: string;
}): Effect.Effect<
  {
    status: number;
    headers: Record<string, string>;
    bodyBase64: string;
  },
  PreviewTooLarge
> {
  return Effect.gen(function* () {
    const r = yield* previewFile(input);
    // Bound to a local because a `yield*` between the narrowing and the use
    // widens a property access back to the union (the generator could resume
    // against different state, as far as the checker knows).
    const body = r.body;
    if (typeof body === "string") {
      return {
        status: r.status,
        headers: r.headers,
        bodyBase64: Buffer.from(body, "utf8").toString("base64"),
      };
    }
    yield* capByResolvedLength(r.headers, body);
    return {
      status: r.status,
      headers: r.headers,
      bodyBase64: yield* bufferBase64Capped(body),
    };
  });
}
