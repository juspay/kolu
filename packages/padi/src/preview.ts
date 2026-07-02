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

/** The WIRE form of {@link previewFile}: buffers the streamed body to base64 so
 *  it rides the `padiSurface.procedures.preview.read` procedure return. This is
 *  the ONLY buffering site — used by the surface procedure (which must serialize
 *  the body over the wire), NOT by the in-process HTTP route (which streams via
 *  {@link previewFile}). Status + headers come back verbatim from `serveFile`.
 *
 *  A ranged (`bytes=X-Y`) read stays bounded; an open-ended (`bytes=X-`) or
 *  unranged read materializes the whole (remaining) file — acceptable over the
 *  wire (a remote consumer has no zero-copy stream anyway), but the reason the
 *  local route must use {@link previewFile}, not this. */
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
  const bodyBase64 =
    typeof r.body === "string"
      ? Buffer.from(r.body, "utf8").toString("base64")
      : Buffer.from(await new Response(r.body).arrayBuffer()).toString(
          "base64",
        );
  return { status: r.status, headers: r.headers, bodyBase64 };
}
