/**
 * `@kolu/padi/preview` — the ONE range-capable, serve-dir-shaped byte read
 * behind the iframe binary preview, plus the realpath/symlink-escape guard it
 * injects into `@kolu/serve-dir`'s `serveFile`.
 *
 * ONE serve-dir read (`previewFile`), two forms, two callers:
 *   - `previewFile` (STREAMING `ServeResult`) — kolu-server's preview route
 *     (`server/src/iframePreviewRoute.ts`) backs its `/api/terminals/:host/:id/file/*`
 *     route onto it (forwarding the browser's `Range`), streaming disk→socket with
 *     bounded heap;
 *   - `readPreview` (BASE64 wire-form, = `previewFile` + buffer) —
 *     `padiSurface.procedures.preview.read` (`servePadi.ts`), the procedure a
 *     REMOTE consumer (W2) calls, where the body must serialize over the wire.
 *   So the HTTP bypass and the surface procedure are byte-identical by
 *   construction (same read), and the local route keeps serve-dir's streaming
 *   memory profile (the base64 form is wire-only).
 *
 * The guard (`previewRealpathGuard`) formerly lived ALSO in kolu-server
 * (`iframePreviewRoute.ts`); with the route re-backed here that copy retires and
 * this is the single home. `@kolu/padi` must never import from `packages/server`
 * (the dependency arrow points OUT), so the guard — a tiny pure adapter over
 * kolu-git's `assertRealpathUnder` — lives here beside the read it protects. Its
 * behaviour is unchanged: resolve symlinks and reject anything whose real path
 * escapes the root (a repo-local `leak.html -> /etc/passwd` an agent could
 * plant).
 */

import type { RealpathGuard, ServeResult } from "@kolu/serve-dir";
import { getHeaderCI, serveFile } from "@kolu/serve-dir";
import { Effect } from "effect";
import { assertRealpathUnder } from "kolu-git";
import { PreviewTooLarge } from "./errors.ts";

/** The filesystem-authority guard padi injects into `@kolu/serve-dir` for a
 *  given root: resolve symlinks and reject anything whose real path escapes the
 *  root. Wraps kolu-git's `assertRealpathUnder` into the `RealpathGuard` shape,
 *  matching kolu-server's retired `previewRealpathGuard` byte-for-byte. */
export function previewRealpathGuard(root: string): RealpathGuard {
  return (abs) =>
    Effect.promise(async () => (await assertRealpathUnder(root, abs)).ok);
}

/** The range-capable, serve-dir-shaped byte read behind the preview — the
 *  STREAMING form. Forwards an optional raw HTTP `Range` header to `serveFile`
 *  (206/416/200 all behave as the retired direct serve-dir bypass did)
 *  and injects the realpath guard (the `..`/`%2f`/symlink 403 stage the lexical
 *  guard inside `@kolu/serve-dir` can't cover). Returns serve-dir's `ServeResult`
 *  VERBATIM — a `ReadableStream` body on 2xx (bytes flow disk→socket with
 *  bounded heap; a multi-GB video never lands whole in memory, and the browser
 *  can abort early), a string on errors.
 *
 *  This is the in-process path kolu-server's preview route uses (it hands the
 *  streamed body straight to the HTTP response, byte-identical AND
 *  memory-identical to the old serve-dir route). {@link readPreview} wraps it for
 *  the WIRE (base64). */
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

/** The maximum body an unranged / open-ended {@link readPreview} will inline over
 *  the wire before failing fast. serve-dir streams the local HTTP route with a
 *  bounded heap, but the base64 WIRE form MUST materialize the body — so a huge
 *  file behind an unranged read would otherwise buffer whole into the daemon's
 *  heap (an OOM footgun for a remote W2 consumer of `preview.read`). 64 MiB
 *  comfortably covers an inline document/image preview; anything larger must be
 *  pulled with a bounded byte range. */
const MAX_INLINE_PREVIEW_BYTES = 64 * 1024 * 1024;

/** The DECLARED fault a caller sees when an unranged/open-ended preview would
 *  exceed {@link MAX_INLINE_PREVIEW_BYTES} — fail-fast, NEVER a silent
 *  truncation. The cap rides as typed data, so the message names the fix AND a
 *  client can compute a range from it rather than read a number out of prose. */
function previewTooLarge(): PreviewTooLarge {
  return new PreviewTooLarge({ limitBytes: MAX_INLINE_PREVIEW_BYTES });
}

/** Read `Content-Length` case-insensitively (serve-dir sets it on a 206, but
 *  deliberately OMITS it on a full 200 — so its absence never means "small").
 *  `getHeaderCI` — the inverse of the `ServeResult` header shape — lives in
 *  `@kolu/serve-dir` beside that shape. */
function contentLengthOf(headers: Record<string, string>): number | undefined {
  const v = getHeaderCI(headers, "content-length");
  return v === undefined ? undefined : Number(v);
}

/** Buffer a streamed body to base64, failing fast via {@link previewTooLarge}
 *  the moment the running total crosses {@link MAX_INLINE_PREVIEW_BYTES} — so a
 *  huge file never fully materializes into the heap (serve-dir omits
 *  Content-Length on a full 200, so counting the streamed bytes is the only
 *  pre-completion gate for that case). */
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
    // The cap is the ONLY thing this read raises, and it is a DECLARED fault —
    // so it goes to the failure channel typed. Anything else out of a
    // `ReadableStream` read is a defect and is re-thrown as one.
    catch: (err: unknown) => {
      if (err instanceof PreviewTooLarge) return err;
      throw err;
    },
  });
}

/** The WIRE form of {@link previewFile}: buffers the streamed body to base64 so
 *  it rides the `padiSurface.procedures.preview.read` procedure return. This is
 *  the ONLY buffering site — used by the surface procedure (which must serialize
 *  the body over the wire), NOT by the in-process HTTP route (which streams via
 *  {@link previewFile}). Status + headers come back verbatim from `serveFile`.
 *
 *  EVERY non-error body is CAPPED at {@link MAX_INLINE_PREVIEW_BYTES} by the
 *  RESOLVED byte count, not the range shape: a legitimately small bounded range
 *  (a `<video>` seek) buffers unchanged (byte-identical), but an unranged read,
 *  an open-ended `bytes=X-`, OR a huge bounded `bytes=0-999999999999` all resolve
 *  to ~the whole file and fail fast with a typed `PAYLOAD_TOO_LARGE` naming the
 *  fix (request a smaller range) rather than buffering an unbounded blob. Shape
 *  alone was the earlier bypass. This is why the local HTTP route must stream via
 *  {@link previewFile}, not call this. */
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
    // Error responses (400/403/404/416/500) come back as a small plain-text body.
    if (typeof body === "string") {
      return {
        status: r.status,
        headers: r.headers,
        bodyBase64: Buffer.from(body, "utf8").toString("base64"),
      };
    }
    // EVERY non-error body is capped identically — a bounded 206, an open-ended
    // 206, or a full 200. A caller-bounded range whose end is legitimately small
    // (a `<video>` seek) buffers unchanged, so seeking stays byte-identical; but a
    // huge BOUNDED range (`bytes=0-999999999999`) resolves to ~the whole file and
    // must NOT ride an uncapped `arrayBuffer()` — checking only the range *shape*
    // was the cap bypass. Prefer the `Content-Length` serve-dir sets on a 206 so an
    // over-cap read fails BEFORE any byte is read; a full 200 omits it, so the
    // capped stream reader (`bufferBase64Capped`) bounds the buffer instead.
    const declared = contentLengthOf(r.headers);
    if (declared !== undefined && declared > MAX_INLINE_PREVIEW_BYTES) {
      yield* Effect.promise(() => body.cancel());
      return yield* Effect.fail(previewTooLarge());
    }
    return {
      status: r.status,
      headers: r.headers,
      bodyBase64: yield* bufferBase64Capped(body),
    };
  });
}
