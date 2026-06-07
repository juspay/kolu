/** Agnostic, fetch-native directory file server: given an ABSOLUTE root, answer
 *  a request for a file under it with a streaming byte-range `Response`. The
 *  whole module is `(root, relPath, request) -> Response` — it knows nothing
 *  about terminals, git, or kolu, so it's publishable as `@kolu/serve-dir` once
 *  a second consumer appears. The kolu glue stays in the consumer:
 *    - WHICH root (a terminal's repo root / `$PWD`) is injected by the caller
 *      (`index.ts`), never decided here;
 *    - the artifact-sdk `<script>` injection is an orthogonal *downstream*
 *      middleware that rewrites the HTML `Response` this returns — it composes
 *      for free precisely because `fetch` returns a real Fetch `Response` and
 *      omits `Content-Length` on full 200s (see the 200 branch);
 *    - the per-terminal preview URL shape (`?v=<mtime>`) lives in
 *      `iframePreviewRoute.ts`.
 *
 *  Why this isn't an off-the-shelf static server: the shape needed here is a
 *  function that RETURNS a `Response`. Every static-serve package
 *  (`send`/`serve-static`/`@fastify/static`/`@hono/node-server` serveStatic/…)
 *  is the inverse — a middleware bound to a fixed root that writes straight to a
 *  Node socket, so it can neither take a per-request absolute root nor compose
 *  with a downstream body transform. A 20-agent prior-art survey
 *  (`docs/atlas/src/content/atlas/electricity.mdx`) confirmed none fit; this
 *  ~`createReadStream({start,end}) -> Readable.toWeb -> Response` shape is the
 *  only one that does (what Deno `@std/http` and SvelteKit/Vite converge on).
 *
 *  Path safety is LEXICAL only: decode-then-split rejects `..`/empty/absolute
 *  segments (defense against URL-encoded `..` and `%2f` smuggling), then a
 *  `path.relative` containment check. The realpath/symlink-escape stage the old
 *  route carried (kolu-git `assertRealpathUnder`) is intentionally NOT here yet
 *  — to be reintroduced as an *injected* guard so this primitive stays agnostic.
 *  Until then a repo-local symlink pointing outside the root is followed. */

import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const TEXT_PLAIN = { "Content-Type": "text/plain; charset=utf-8" };

/** Content-Type per extension. A file with no entry serves as
 *  `application/octet-stream` (the browser downloads rather than renders), so
 *  every previewable kind must have a real entry — the coverage invariant for
 *  kolu's `BINARY_PREVIEWABLE_EXTENSIONS` is asserted in `serveDir.test.ts`.
 *  The `.css`/`.js`/font entries are asset siblings a previewable HTML page
 *  references via relative `<link>`/`<script>`/`<img>`. */
const CONTENT_TYPES: Record<string, string> = {
  // Sandbox-previewable kinds.
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  // Video-previewable kinds (rendered with a <video> element). The range
  // support below lets the player seek; the explicit type keeps the browser
  // from sniffing/downloading.
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
  | { ok: false; status: 400 | 404; reason: string };

/** Resolve a raw URL tail to an absolute path under `root`, lexically. Pure (no
 *  I/O) so the guard is unit-testable. Decode the whole tail FIRST, then split:
 *  splitting before decode would treat `foo%2f..%2fpasswd` as one segment and
 *  slip a `..` past the per-segment check; decode-then-split turns any encoded
 *  slash into a real boundary so every component is validated. The trailing
 *  `path.relative` check is belt-and-suspenders containment now that segments
 *  are individually rejected. */
export function resolvePathUnder(
  root: string,
  rawTail: string,
): PathResolution {
  if (rawTail.length === 0) return { ok: false, status: 404, reason: "empty" };

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
  const abs = path.join(root, relPath);
  const rel = path.relative(root, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, status: 400, reason: "escapes root" };
  }

  return { ok: true, abs, mime: contentTypeForPath(relPath) };
}

export interface ServeResult {
  status: number;
  headers: Record<string, string>;
  /** `Uint8Array` covers `Buffer` (subclass) and satisfies `Response`'s
   *  `BodyInit` directly — `Buffer` alone confuses TS in the DOM-typed
   *  `Response` constructor. Strings come back for error responses. A
   *  `ReadableStream` is the ranged-media body: bytes flow straight from a
   *  bounded file handle to the socket, so a multi-GB video never lands in the
   *  server's heap (see the 206 branch in `serveFile`). */
  body: Uint8Array | string | ReadableStream;
}

/** Parse a single-range HTTP `Range: bytes=…` header against a known file
 *  size. The `<video>` element relies on byte ranges to seek (and Safari
 *  refuses to play media a server can't range-serve), so this is the seam that
 *  lets the responder answer `206 Partial Content`.
 *
 *  Returns inclusive `{ start, end }` for a satisfiable single range,
 *  `"invalid"` when the range can't be satisfied (→ 416), or `null` to serve
 *  the whole file (no header, an open `bytes=-`, or a multi-range / malformed
 *  header we deliberately don't honor — falling back to a full 200 is always
 *  spec-valid).
 *
 *  Hand-rolled on purpose — NOT a candidate for `range-parser`. A 20-agent
 *  prior-art survey (`docs/atlas/src/content/atlas/electricity.mdx`) found no
 *  library fits this route, and `range-parser` specifically would *regress* two
 *  RFC-9110 behaviors this gets right: the suffix floor below
 *  (`Math.max(0, size - suffix)` serves the whole file when the suffix exceeds
 *  the size; `range-parser` returns -1 → a spurious 416) and the deliberate
 *  multi-range → full-200 collapse. Adopting it would relocate, not shrink, the
 *  logic AND reintroduce a known correctness bug. */
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

/** Read the resolved file and assemble the HTTP response (the I/O half).
 *  Separated from `resolvePathUnder` so the guard is testable without fixtures
 *  and the I/O failure modes are testable without crafting URLs. */
export async function serveFile(
  root: string,
  rawTail: string,
  rangeHeader?: string | null,
): Promise<ServeResult> {
  const res = resolvePathUnder(root, rawTail);
  if (!res.ok) {
    return { status: res.status, headers: TEXT_PLAIN, body: res.reason };
  }
  try {
    // `Accept-Ranges: bytes` advertises that this route can range-serve, which
    // is what lets a `<video>` element seek.
    const baseHeaders: Record<string, string> = {
      "Content-Type": res.mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      "Accept-Ranges": "bytes",
    };

    // A Range request streams from a single open file handle: `open` →
    // `handle.stat()` (for the size that drives range math AND the headers) →
    // `handle.createReadStream`. Deriving the size and the bytes from the *same*
    // open file description — rather than a `stat(path)` then a separate
    // `createReadStream(path)` — tightens the stat/read race on a live-reloading
    // root: the handle pins one inode, so an *atomic* replace
    // (write-temp-then-rename) leaves the already-sized headers and the streamed
    // body describing one consistent file. Open/stat failures throw here and map
    // to 404/500 below, *before* any 206 is returned.
    if (rangeHeader) {
      const handle = await open(res.abs, "r");
      // Set once the handle is handed off to a ReadableStream that owns its
      // lifecycle; every other exit closes the handle in `finally`.
      let streamed = false;
      try {
        const s = await handle.stat();
        if (!s.isFile()) {
          return { status: 404, headers: TEXT_PLAIN, body: "not a file" };
        }
        const range = parseByteRange(rangeHeader, s.size);
        if (range === "invalid") {
          return {
            status: 416,
            headers: { ...baseHeaders, "Content-Range": `bytes */${s.size}` },
            body: "range not satisfiable",
          };
        }
        if (range) {
          // `createReadStream({ start, end })` reads only those bytes, so a
          // `Range: bytes=0-1` against a multi-GB video moves two bytes, not the
          // whole file, through the heap. The stream owns `handle` and closes it
          // on end/error (`autoClose` defaults on), so we skip the `finally`.
          const stream = handle.createReadStream({
            start: range.start,
            end: range.end,
          });
          streamed = true;
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
        // `range === null`: header present but not a single satisfiable range
        // (open `bytes=-`, multi-range, malformed). Fall through to a full 200,
        // reusing the handle we already opened. No `Content-Length` — see below.
        const buf = await handle.readFile();
        return { status: 200, headers: { ...baseHeaders }, body: buf };
      } finally {
        if (!streamed) await handle.close();
      }
    }

    // No Range header: buffer the whole file (the original behaviour for HTML
    // and image previews). Deliberately set NO `Content-Length` — the runtime
    // derives it from the bytes actually written to the socket. Load-bearing:
    // (1) a downstream HTML-transform middleware (kolu's artifact-sdk decorator)
    // may splice bytes into a text/html response *after* this returns; a
    // Content-Length pinned to the pre-splice size truncates the injected body.
    // (2) deriving from the sent bytes is race-free on a live-reloading root,
    // where a stat and a later read could disagree. The 206 branch above DOES
    // set Content-Length: a partial response must, and it's never decorated
    // (an HTML transform only touches status 200).
    const s = await stat(res.abs);
    if (!s.isFile()) {
      return { status: 404, headers: TEXT_PLAIN, body: "not a file" };
    }
    const buf = await readFile(res.abs);
    return { status: 200, headers: { ...baseHeaders }, body: buf };
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: 404, headers: TEXT_PLAIN, body: "not found" };
    }
    // Unexpected I/O error (EACCES, EIO, …) — surface as 500 so it doesn't
    // masquerade as a missing file.
    return {
      status: 500,
      headers: TEXT_PLAIN,
      body: e instanceof Error ? e.message : "internal error",
    };
  }
}

/** The receptacle: bind an absolute `root`, get a fetch-native file responder.
 *  `fetch(relPath, request)` resolves the tail under `root` and returns a
 *  streaming-range `Response` (200 | 206 | 416 | 404 | 500). The caller injects
 *  the root and may wrap the returned `Response` with downstream middleware. */
export function createDirServer(root: string): {
  fetch: (relPath: string, request: Request) => Promise<Response>;
} {
  return {
    async fetch(relPath, request) {
      const r = await serveFile(root, relPath, request.headers.get("range"));
      // `Buffer` (a `Uint8Array<ArrayBufferLike>`) is a runtime-valid
      // `BodyInit`, but lib.dom narrows `BodyInit` to `Uint8Array<ArrayBuffer>`;
      // node-server forwards the buffer unchanged, so cast at the boundary.
      return new Response(r.body as BodyInit, {
        status: r.status,
        headers: r.headers,
      });
    },
  };
}
