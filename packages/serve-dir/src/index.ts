/** `@kolu/serve-dir` — agnostic, fetch-native directory file server: given an
 *  ABSOLUTE root, answer a request for a file under it with a streaming
 *  byte-range `Response`. The whole package is `(root, relPath, request) ->
 *  Response` — it knows nothing about terminals, git, or kolu (zero *workspace*
 *  deps — `node:fs`/`node:path`/`node:stream` plus the focused `mrmime` MIME
 *  table), so any app serving files from a dynamic absolute root can plug in.
 *  The consumer keeps its own glue:
 *    - WHICH root (e.g. a terminal's repo root / `$PWD`) is injected by the
 *      caller, never decided here;
 *    - any response transform (e.g. kolu's artifact-sdk `<script>` injection)
 *      is an orthogonal *downstream* middleware that rewrites the HTML
 *      `Response` this returns — it composes for free precisely because `fetch`
 *      returns a real Fetch `Response` and omits `Content-Length` on full 200s
 *      (see the 200 branch);
 *    - any URL contract (e.g. kolu's `?v=<mtime>` cache key) lives in the
 *      consumer.
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
 *  Path safety is two-stage by volatility. Stage 1 is LEXICAL and lives here:
 *  decode-then-split rejects `..`/empty/absolute segments (defense against
 *  URL-encoded `..` and `%2f` smuggling), then a `path.relative` containment
 *  check — pure and universal, so it's built in. Stage 2 is the
 *  realpath/symlink-escape check: it touches the filesystem and encodes the
 *  consumer's threat model, so it is NOT hard-coded here — it's an INJECTED
 *  `realpathGuard` the caller passes (e.g. kolu wires its git
 *  `assertRealpathUnder`), keeping this package agnostic. When supplied, the
 *  guard runs *before* any `open`/`stat`/`readFile`, so a planted symlink
 *  pointing outside the root (`leak.html -> /etc/passwd`) is rejected with 403
 *  before a single byte is read; omitting it keeps lexical-only behavior. */

import { open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { lookup } from "mrmime";

const TEXT_PLAIN = { "Content-Type": "text/plain; charset=utf-8" };

/** Content-Type for a path. Backed by `mrmime`'s complete IANA-derived table
 *  (the same one Vite/sirv use), so this is "any file → its real MIME", NOT a
 *  curated subset of any consumer's previewable set: a consumer adding a format
 *  to *its* classifier needs no edit here — mrmime already knows it. A file with
 *  no known type serves as `application/octet-stream` (the browser downloads
 *  rather than renders).
 *
 *  serve-dir's deviations from mrmime's defaults: (1) a tiny `OVERRIDES` map for
 *  generic extensions mrmime happens to omit (`.m4v`, `.ico`) — these are
 *  universal formats any file server should type, NOT a consumer's preview list;
 *  (2) append an explicit `; charset=utf-8` to text-bearing types (any
 *  `text/...`, plus the `javascript`/`json` subtypes) so non-ASCII renders. */
const OVERRIDES: Record<string, string> = {
  m4v: "video/mp4",
  ico: "image/x-icon",
};

export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = OVERRIDES[ext] ?? lookup(filePath) ?? "application/octet-stream";
  return /^text\/|\/(javascript|json)$/.test(mime)
    ? `${mime}; charset=utf-8`
    : mime;
}

export type PathResolution =
  | { ok: true; abs: string; mime: string }
  | { ok: false; status: 400 | 403 | 404; reason: string };

/** Filesystem-authority guard, injected by the caller so this primitive stays
 *  agnostic. Given the lexically-validated absolute path, resolve `true` to
 *  allow the read or `false` to reject it as a 403 (a symlink whose real target
 *  escapes the root). The kolu caller wires in kolu-git's `assertRealpathUnder`;
 *  callers with no symlink concern omit it (lexical guard only). */
export type RealpathGuard = (abs: string) => Promise<boolean>;

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
  /** A `ReadableStream` is the success body (200 and 206 alike): bytes flow
   *  straight from a bounded file handle to the socket, so a multi-GB video
   *  never lands in the server's heap, whether the client sent a Range header or
   *  not (see `serveFile`). Strings come back for error responses (400/403/404/
   *  416/500). */
  body: string | ReadableStream;
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
  realpathGuard?: RealpathGuard,
): Promise<ServeResult> {
  const res = resolvePathUnder(root, rawTail);
  if (!res.ok) {
    return { status: res.status, headers: TEXT_PLAIN, body: res.reason };
  }
  // Stage 2 (injected): filesystem-authority check. `resolvePathUnder` is
  // lexical only, so a repo-local `leak.html -> /etc/passwd` slips through it;
  // the caller's guard resolves symlinks and rejects anything whose real path
  // escapes the root, BEFORE any open/stat/read below.
  if (realpathGuard && !(await realpathGuard(res.abs))) {
    return { status: 403, headers: TEXT_PLAIN, body: "escapes root" };
  }
  // Every successful response — 200 and 206 alike — streams from a single open
  // file handle: `open` → `handle.stat()` (the size that drives range math AND
  // the headers) → `handle.createReadStream`. Deriving the size and the bytes
  // from the *same* open file description — rather than a `stat(path)` then a
  // separate `createReadStream(path)` — tightens the stat/read race on a
  // live-reloading root: the handle pins one inode, so an *atomic* replace
  // (write-temp-then-rename) leaves the already-sized headers and the streamed
  // body describing one consistent file. Open/stat failures throw here and map
  // to 404/500 below, *before* any 200/206 is returned.
  //
  // Streaming the full 200 (not just the ranged 206) is the load-bearing reason
  // a multi-GB video never lands in the server heap: a client that omits a Range
  // header — or sends a multi-range one we collapse to 200 — would otherwise
  // force the whole file through `readFile`. The downstream HTML decorator still
  // works because it consumes only `text/html` (via `res.text()`), and a
  // `ReadableStream` body answers `.text()` just as a buffer does.
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // `Accept-Ranges: bytes` advertises that this route can range-serve, which
    // is what lets a `<video>` element seek.
    const baseHeaders: Record<string, string> = {
      "Content-Type": res.mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      "Accept-Ranges": "bytes",
    };

    handle = await open(res.abs, "r");
    // Handle ownership is a value carried by each exit, not a flag over time.
    // The stat/isFile check is the only window where a throw can leak the
    // handle before a stream takes ownership, so it alone closes on throw.
    // After it, every exit decides explicitly: the non-streaming 404/416
    // branches close the handle before returning; the streaming 200/206
    // branches hand it to `Readable.toWeb`, whose underlying createReadStream
    // owns the lifecycle (`autoClose` defaults on, closing on end/error).
    let s: Awaited<ReturnType<typeof handle.stat>>;
    try {
      s = await handle.stat();
    } catch (e) {
      await handle.close();
      throw e;
    }
    if (!s.isFile()) {
      await handle.close();
      return { status: 404, headers: TEXT_PLAIN, body: "not a file" };
    }

    const streamBody = (start?: number, end?: number): ReadableStream => {
      const stream = handle!.createReadStream(
        start === undefined ? {} : { start, end },
      );
      return Readable.toWeb(stream) as ReadableStream;
    };

    const range = rangeHeader ? parseByteRange(rangeHeader, s.size) : null;
    if (range === "invalid") {
      await handle.close();
      return {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${s.size}` },
        body: "range not satisfiable",
      };
    }
    if (range) {
      // `createReadStream({ start, end })` reads only those bytes, so a
      // `Range: bytes=0-1` against a multi-GB video moves two bytes, not the
      // whole file, through the heap.
      return {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${range.start}-${range.end}/${s.size}`,
          "Content-Length": String(range.end - range.start + 1),
        },
        body: streamBody(range.start, range.end),
      };
    }

    // Full 200: no Range header, or a header we collapse to the whole file
    // (open `bytes=-`, multi-range, malformed). Stream it too — see the
    // heap note above. Deliberately set NO `Content-Length`; the runtime
    // derives it from the bytes actually written to the socket. Load-bearing:
    // (1) a downstream HTML-transform middleware (kolu's artifact-sdk
    // decorator) may splice bytes into a text/html response *after* this
    // returns; a Content-Length pinned to the pre-splice size truncates the
    // injected body. (2) deriving from the sent bytes is race-free on a
    // live-reloading root, where a stat and a later read could disagree. The
    // 206 branch above DOES set Content-Length: a partial response must, and
    // it's never decorated (an HTML transform only touches status 200).
    return { status: 200, headers: { ...baseHeaders }, body: streamBody() };
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
 *  streaming-range `Response` (200 | 206 | 416 | 403 | 404 | 500). The caller
 *  injects the root, the optional symlink-escape `realpathGuard` (see
 *  `RealpathGuard`), and may wrap the returned `Response` with downstream
 *  middleware. */
export function createDirServer(
  root: string,
  realpathGuard?: RealpathGuard,
): {
  fetch: (relPath: string, request: Request) => Promise<Response>;
} {
  return {
    async fetch(relPath, request) {
      const r = await serveFile(
        root,
        relPath,
        request.headers.get("range"),
        realpathGuard,
      );
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
