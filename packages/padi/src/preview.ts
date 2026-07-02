/**
 * `@kolu/padi/preview` — the ONE range-capable, serve-dir-shaped byte read
 * behind the iframe binary preview, plus the realpath/symlink-escape guard it
 * injects into `@kolu/serve-dir`'s `serveFile`.
 *
 * ONE serve-dir read (`previewFile`), two forms, two callers:
 *   - `previewFile` (STREAMING `ServeResult`) — kolu-server's Hono preview route
 *     (`server/src/index.ts`) re-backs its `/api/terminals/:id/file/*` mount onto
 *     it (forwarding the browser's `Range`) instead of a direct `createDirServer`,
 *     streaming disk→socket with bounded heap exactly as before;
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
import { serveFile } from "@kolu/serve-dir";
import { ORPCError } from "@orpc/server";
import { assertRealpathUnder } from "kolu-git";

/** The filesystem-authority guard padi injects into `@kolu/serve-dir` for a
 *  given root: resolve symlinks and reject anything whose real path escapes the
 *  root. Wraps kolu-git's `assertRealpathUnder` into the `RealpathGuard` shape,
 *  matching kolu-server's retired `previewRealpathGuard` byte-for-byte. */
export function previewRealpathGuard(root: string): RealpathGuard {
  return async (abs) => (await assertRealpathUnder(root, abs)).ok;
}

/** The range-capable, serve-dir-shaped byte read behind the preview — the
 *  STREAMING form. Forwards an optional raw HTTP `Range` header to `serveFile`
 *  (206/416/200 all behave as the retired direct `createDirServer` bypass did)
 *  and injects the realpath guard (the `..`/`%2f`/symlink 403 stage the lexical
 *  guard inside `@kolu/serve-dir` can't cover). Returns serve-dir's `ServeResult`
 *  VERBATIM — a `ReadableStream` body on 2xx (bytes flow disk→socket with
 *  bounded heap; a multi-GB video never lands whole in memory, and the browser
 *  can abort early), a string on errors.
 *
 *  This is the in-process path kolu-server's Hono preview route uses (it returns
 *  `new Response(r.body, r)` directly, byte-identical AND memory-identical to the
 *  old serve-dir route). {@link readPreview} wraps it for the WIRE (base64). */
export function previewFile(input: {
  repoPath: string;
  filePath: string;
  range?: string;
}): Promise<ServeResult> {
  const guard: RealpathGuard = previewRealpathGuard(input.repoPath);
  return serveFile(input.repoPath, input.filePath, input.range, guard);
}

/** The maximum body an unranged / open-ended {@link readPreview} will inline over
 *  the wire before failing fast. serve-dir streams the local HTTP route with a
 *  bounded heap, but the base64 WIRE form MUST materialize the body — so a huge
 *  file behind an unranged read would otherwise buffer whole into the daemon's
 *  heap (an OOM footgun for a remote W2 consumer of `preview.read`). 64 MiB
 *  comfortably covers an inline document/image preview; anything larger must be
 *  pulled with a bounded byte range. */
const MAX_INLINE_PREVIEW_BYTES = 64 * 1024 * 1024;

/** The typed fault a caller sees when an unranged/open-ended preview would exceed
 *  {@link MAX_INLINE_PREVIEW_BYTES} — fail-fast, NEVER a silent truncation. Names
 *  the fix: request a bounded byte range. */
function previewTooLarge(): ORPCError<"PAYLOAD_TOO_LARGE", undefined> {
  return new ORPCError("PAYLOAD_TOO_LARGE", {
    message:
      `Preview body exceeds the ${MAX_INLINE_PREVIEW_BYTES}-byte inline cap for ` +
      "an unranged read; request a bounded byte range (e.g. `bytes=0-…`) instead.",
  });
}

/** True when `range` is a single BOUNDED byte range (`bytes=<start>-<end>`, both
 *  ends present) — the one shape whose resolved body is bounded by the caller, so
 *  it rides the uncapped path unchanged. An unranged (absent), open-ended
 *  (`bytes=<start>-`), suffix (`bytes=-N`), or multi-range / malformed header is
 *  NOT bounded here: serve-dir may answer it with the whole (remaining) file, so
 *  it must ride the capped path. Deliberately a tiny lexical leaf — serve-dir's
 *  `parseByteRange` fills an open end from the file size, so it cannot answer "did
 *  the caller name an explicit end?". */
function isBoundedRange(range: string | undefined): boolean {
  return range !== undefined && /^bytes=\d+-\d+$/.test(range.trim());
}

/** Read `Content-Length` case-insensitively (serve-dir sets it on a 206, but
 *  deliberately OMITS it on a full 200 — so its absence never means "small"). */
function contentLengthOf(headers: Record<string, string>): number | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "content-length") return Number(v);
  }
  return undefined;
}

/** Buffer a streamed body to base64, failing fast via {@link previewTooLarge}
 *  the moment the running total crosses {@link MAX_INLINE_PREVIEW_BYTES} — so a
 *  huge file never fully materializes into the heap (serve-dir omits
 *  Content-Length on a full 200, so counting the streamed bytes is the only
 *  pre-completion gate for that case). */
async function bufferBase64Capped(body: ReadableStream): Promise<string> {
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
}

/** The WIRE form of {@link previewFile}: buffers the streamed body to base64 so
 *  it rides the `padiSurface.procedures.preview.read` procedure return. This is
 *  the ONLY buffering site — used by the surface procedure (which must serialize
 *  the body over the wire), NOT by the in-process HTTP route (which streams via
 *  {@link previewFile}). Status + headers come back verbatim from `serveFile`.
 *
 *  A BOUNDED range (`bytes=X-Y`) is bounded by the caller and rides through
 *  verbatim (byte-identical). An unranged or open-ended (`bytes=X-`) read may
 *  resolve to the whole (remaining) file, so it is CAPPED at
 *  {@link MAX_INLINE_PREVIEW_BYTES}: the daemon fails fast with a typed
 *  `PAYLOAD_TOO_LARGE` naming the fix (request a bounded range) rather than
 *  buffering an unbounded blob — the reason the local route must use
 *  {@link previewFile}, not this. */
export async function readPreview(input: {
  repoPath: string;
  filePath: string;
  range?: string;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
}> {
  const r = await previewFile(input);
  // Error responses (400/403/404/416/500) come back as a small plain-text body.
  if (typeof r.body === "string") {
    return {
      status: r.status,
      headers: r.headers,
      bodyBase64: Buffer.from(r.body, "utf8").toString("base64"),
    };
  }
  // A BOUNDED range (206) is bounded by the caller — serve it verbatim, exactly
  // as before (keeps `<video>` seek working; byte-identical).
  if (isBoundedRange(input.range)) {
    return {
      status: r.status,
      headers: r.headers,
      bodyBase64: Buffer.from(
        await new Response(r.body).arrayBuffer(),
      ).toString("base64"),
    };
  }
  // Unranged / open-ended: the resolved body may be the whole (remaining) file.
  // Prefer the Content-Length header when serve-dir set it (an open-ended 206) so
  // an over-cap read fails BEFORE any byte is read; otherwise (a full 200 has no
  // Content-Length) the capped stream reader bounds the buffer.
  const declared = contentLengthOf(r.headers);
  if (declared !== undefined && declared > MAX_INLINE_PREVIEW_BYTES) {
    await r.body.cancel();
    throw previewTooLarge();
  }
  return {
    status: r.status,
    headers: r.headers,
    bodyBase64: await bufferBase64Capped(r.body),
  };
}
