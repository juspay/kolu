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

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveUnder } from "kolu-git";

/** Base URL for the iframe-preview file route. Used by both
 *  `buildIframePreviewUrl` (server emits URLs in this shape) and the Hono
 *  route registration in `index.ts` (matches incoming requests against the
 *  same shape). One constant → renames touch one place. */
export const TERMINAL_FILE_ROUTE_BASE = "/api/terminals";

/** Path suffix relative to `TERMINAL_FILE_ROUTE_BASE` for per-terminal file
 *  serving. Concatenated as `${BASE}/${terminalId}/file/${path}`. */
export const TERMINAL_FILE_ROUTE_FILE_SEGMENT = "file";

/** Canonical URL shape for the iframe-served file route, used in
 *  `FsReadFileOutput.kind === "binary"` and matched by the Hono route in
 *  `index.ts`. `mtimeMs` is rounded down so a stable file always produces
 *  the same URL (browser caches the iframe content per URL). */
export function buildIframePreviewUrl(
  terminalId: string,
  filePath: string,
  mtimeMs: number,
): string {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `${TERMINAL_FILE_ROUTE_BASE}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/${encodedPath}?v=${Math.floor(mtimeMs)}`;
}

/** Content-Type per extension for files served by this route. Every
 *  extension in `BINARY_PREVIEWABLE_EXTENSIONS` (the node-free classifier in
 *  `kolu-git/previewable` that decides `FsReadFileOutput.kind`) must have a
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

/** Parse the URL tail, run both guard stages, return the absolute file path
 *  or the HTTP status to respond with. Pure function — no I/O — so the
 *  Hono route stays a thin adapter and the guard is unit-testable. */
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

  // Stage 2: canonical resolve + relative-prefix check (kolu-git's guard).
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
   *  Response constructor. Strings come back for error responses. */
  body: Uint8Array | string;
}

/** Read the resolved file and assemble the HTTP response. Separated from
 *  `resolvePreviewPath` so the guard logic is testable without filesystem
 *  fixtures, and the I/O failure modes are testable without crafting URLs. */
export async function serveResolvedFile(
  res: PathResolution,
): Promise<ServeResult> {
  if (!res.ok) {
    return {
      status: res.status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: res.reason,
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
    const buf = await readFile(res.abs);
    return {
      status: 200,
      headers: {
        "Content-Type": res.mime,
        "X-Content-Type-Options": "nosniff",
        // Browsers cache aggressively — the URL's `?v=<mtime>` query is the
        // cache key on our side, so a same-URL request can safely hit the
        // browser cache. mtime change → new URL → fresh fetch.
        "Cache-Control": "private, max-age=60",
      },
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
