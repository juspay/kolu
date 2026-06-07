/** HTTP route serving repo files for the iframe-preview surface
 *  (`FsReadFileOutput.kind === "binary"`). URL contract (`buildIframePreviewUrl`,
 *  `TERMINAL_FILE_ROUTE_BASE`, `TERMINAL_FILE_ROUTE_FILE_SEGMENT`) lives in
 *  this module — `kolu-git/schemas` holds only the wire shape (`FsReadFileOutputSchema`).
 *
 *  Two-stage path-traversal guard:
 *    1. Inspect raw URL-decoded segments and reject `..` or empty parts
 *       *before* path.join — defense in depth against URL-encoded `..`
 *       and double-slash collapsing tricks.
 *    2. `resolveUnder` canonicalizes and re-verifies via `path.relative`
 *       (the established kolu-git guard pattern).
 *
 *  Content-Type is set explicitly per extension; `X-Content-Type-Options:
 *  nosniff` blocks the browser from second-guessing. Sandbox restrictions
 *  (`allow-scripts` only, no `allow-same-origin`) are the iframe element's
 *  responsibility — the route is plain HTTP. */

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { buildTerminalFileUrl } from "kolu-common/preview";
import { assertRealpathUnder, resolveUnder } from "kolu-git";

// The route-shape contract (`TERMINAL_FILE_ROUTE_BASE`,
// `TERMINAL_FILE_ROUTE_FILE_SEGMENT`, `buildTerminalFileUrl`) lives in
// `kolu-common/preview` so the client can build the same URLs (it resolves
// repo-relative Markdown image srcs). Re-exported here so the Hono route
// registration in `index.ts` keeps importing them from this module.
export {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";

/** Canonical URL shape for the iframe-served file route, used in
 *  `FsReadFileOutput.kind === "binary"` and matched by the Hono route in
 *  `index.ts`. `mtimeMs` is rounded down so a stable file always produces
 *  the same URL (browser caches the iframe content per URL). */
export function buildIframePreviewUrl(
  terminalId: string,
  filePath: string,
  mtimeMs: number,
): string {
  return `${buildTerminalFileUrl(terminalId, filePath)}?v=${Math.floor(mtimeMs)}`;
}

/** Content-Type per extension for files served by this route. Every
 *  extension in `BINARY_PREVIEWABLE_EXTENSIONS` (the node-free classifier in
 *  `kolu-common/preview` that decides `FsReadFileOutput.kind`) must have a
 *  real entry here, or the route serves it as `application/octet-stream` and
 *  the browser downloads it instead of rendering. That coverage invariant is
 *  asserted in `iframePreviewRoute.test.ts`. The extra `.css`/`.js`/font
 *  entries below are asset siblings a previewable HTML page references via
 *  relative `<link>`/`<script>`/`<img>` — not themselves previewable. */
const CONTENT_TYPES: Record<string, string> = {
  // Sandbox-previewable kinds.
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  // Video-previewable kinds (rendered with a <video> element). Range support
  // below lets the player seek; the explicit type keeps the browser from
  // sniffing/downloading.
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".ogv": "video/ogg",
  // Assets a previewable HTML page can reference via relative <link>/<script>/<img>.
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export type PathResolution =
  | { ok: true; abs: string; mime: string }
  | { ok: false; status: 400 | 403 | 404; reason: string };

/** Parse the URL tail, run both *lexical* guard stages, return the absolute
 *  file path or the HTTP status to respond with. Pure function — no I/O — so
 *  the Hono route stays a thin adapter and the guard is unit-testable.
 *
 *  Symlink resolution can't happen here (it touches the filesystem); it lives
 *  in `serveResolvedFile`, the I/O half, which rejects a repo-local symlink
 *  escaping the root with the same 403 the lexical stage uses. */
export function resolvePreviewPath(
  repoRoot: string,
  rawTail: string,
): PathResolution {
  if (rawTail.length === 0) return { ok: false, status: 404, reason: "empty" };

  // Stage 1: decode the whole tail FIRST, then split. Order matters:
  // splitting before decode would treat `foo%2f..%2fpasswd` as one segment
  // (slipping a `..` past the per-segment check). Decode-then-split turns
  // any URL-encoded slash into a real boundary so every component the
  // resolver will see gets validated. Catches `%2e%2e`, `%2f`, double
  // slashes, `.`, `..`, absolute segments — all rejected before path.join.
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawTail);
  } catch {
    return { ok: false, status: 400, reason: "malformed encoding" };
  }
  const segments = decoded.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      return { ok: false, status: 400, reason: "illegal segment" };
    }
    if (path.isAbsolute(seg)) {
      return { ok: false, status: 400, reason: "absolute segment" };
    }
  }
  const relPath = segments.join("/");

  // Stage 2: canonical resolve + relative-prefix check (kolu-git's lexical
  // guard). Stage 3 (symlink resolution) runs in `serveResolvedFile`.
  const resolved = resolveUnder(repoRoot, relPath);
  if (!resolved.ok) return { ok: false, status: 403, reason: "escapes root" };

  return {
    ok: true,
    abs: resolved.value.abs,
    mime: contentTypeForPath(relPath),
  };
}

export interface ServeResult {
  status: number;
  headers: Record<string, string>;
  /** `Uint8Array` covers `Buffer` (subclass) and satisfies `Response`'s
   *  `BodyInit` directly — `Buffer` alone confuses TS in the DOM-typed
   *  Response constructor. Strings come back for error responses. A
   *  `ReadableStream` is the ranged-media body: bytes flow straight from a
   *  bounded file handle to the socket, so a multi-GB video never lands in the
   *  server's heap (see the 206 branch in `serveResolvedFile`). */
  body: Uint8Array | string | ReadableStream;
}

/** Parse a single-range HTTP `Range: bytes=…` header against a known file
 *  size. The `<video>` element relies on byte ranges to seek (and Safari
 *  refuses to play media a server can't range-serve), so this is the seam
 *  that turns a route which only ever served whole files into one that can
 *  answer `206 Partial Content`.
 *
 *  Returns inclusive `{ start, end }` for a satisfiable single range,
 *  `"invalid"` when the range can't be satisfied (→ 416), or `null` to serve
 *  the whole file (no header, an open `bytes=-`, or a multi-range / malformed
 *  header we deliberately don't honor — falling back to a full 200 is always
 *  spec-valid). */
export function parseByteRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  // Single range only: `bytes=start-end`, `bytes=start-`, or `bytes=-suffix`.
  // A comma (multi-range) won't match, so we serve the whole file instead.
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  if (size === 0) return "invalid";

  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

/** Read the resolved file and assemble the HTTP response. Separated from
 *  `resolvePreviewPath` so the guard logic is testable without filesystem
 *  fixtures, and the I/O failure modes are testable without crafting URLs. */
export async function serveResolvedFile(
  res: PathResolution,
  root: string,
  rangeHeader?: string | null,
): Promise<ServeResult> {
  if (!res.ok) {
    return {
      status: res.status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: res.reason,
    };
  }
  // Stage 3: fs-authority check. `resolvePreviewPath` is lexical only, so a
  // repo-local `leak.html -> /etc/passwd` slips through it; resolve symlinks
  // and reject anything whose real path escapes the root before we read it.
  const authority = await assertRealpathUnder(root, res.abs);
  if (!authority.ok) {
    return {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "escapes root",
    };
  }
  try {
    const s = await stat(res.abs);
    if (!s.isFile()) {
      return {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "not a file",
      };
    }
    // `Accept-Ranges: bytes` advertises that this route can range-serve, which
    // is what lets a `<video>` element seek. The `?v=<mtime>` query is our
    // cache key, so a same-URL request can safely hit the browser cache;
    // mtime change → new URL → fresh fetch.
    const baseHeaders: Record<string, string> = {
      "Content-Type": res.mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      "Accept-Ranges": "bytes",
    };

    const range = parseByteRange(rangeHeader, s.size);
    if (range === "invalid") {
      return {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${s.size}` },
        body: "range not satisfiable",
      };
    }

    // A satisfiable range streams straight from a bounded file handle —
    // `createReadStream({ start, end })` only ever reads those bytes, so a
    // `Range: bytes=0-1` against a multi-GB video moves two bytes, not the
    // whole file through the heap. `Content-Length` is the range width, derived
    // from the same `s.size` that bounded the stream, so body and header can't
    // diverge. (`end` is inclusive for both the HTTP range and the fs option.)
    if (range) {
      const stream = createReadStream(res.abs, {
        start: range.start,
        end: range.end,
      });
      return {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${range.start}-${range.end}/${s.size}`,
          "Content-Length": String(range.end - range.start + 1),
        },
        body: Readable.toWeb(stream) as ReadableStream,
      };
    }
    // No range: the whole file is buffered (the original behaviour for HTML and
    // image previews). `Content-Length` comes from the buffer actually being
    // sent, not the earlier `stat` — if an agent rewrites the file between
    // `stat()` and `readFile()` the two could differ, producing a truncated
    // body or `ERR_CONTENT_LENGTH_MISMATCH` on this live-reloading route.
    const buf = await readFile(res.abs);
    return {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(buf.length) },
      body: buf,
    };
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "not found",
      };
    }
    // Unexpected I/O error (EACCES, EIO, …) — surface as 500 so it doesn't
    // masquerade as a missing file.
    return {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: e instanceof Error ? e.message : "internal error",
    };
  }
}
