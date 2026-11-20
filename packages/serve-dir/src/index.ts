import type { BigIntStats, promises as fsPromises } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Effect, Exit } from "effect";
import { lookup } from "mrmime";

const TEXT_PLAIN = { "Content-Type": "text/plain; charset=utf-8" };
const RE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

const MRMIME_GAP_MIME: Record<string, string> = {
  m4v: "video/mp4",
  ico: "image/x-icon",
};

export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime =
    MRMIME_GAP_MIME[ext] ?? lookup(filePath) ?? "application/octet-stream";
  const textBearing =
    mime.startsWith("text/") ||
    mime.endsWith("/javascript") ||
    mime.endsWith("/json");
  return textBearing ? `${mime}; charset=utf-8` : mime;
}

/** The path portion of a request URL WITHOUT WHATWG normalization — the RAW,
 *  still-encoded tail `serveFile` needs. Slice this, do
 *  NOT pass `new URL(rawUrl).pathname`: `URL` runs WHATWG path normalization,
 *  which COLLAPSES dot segments (`…/foo/%2e%2e/secret` and `…/foo/../secret`
 *  both become `…/secret`) BEFORE `resolvePathUnder`'s per-segment `..` check
 *  ever sees them — so a consumer slicing via `URL` reopens the very
 *  directory-traversal hole the lexical guard exists to close. Decoding helpers
 *  (`decodeURI`/`decodeURIComponent`, or a router that pre-decodes its params —
 *  `HttpRouter.params["*"]` is `decodeURIComponent`d by the matcher)
 *  are equally unsafe: `resolvePathUnder` decodes exactly once internally, so a
 *  pre-decode double-decodes `%`-bearing filenames and erases `%2f` segment
 *  boundaries.
 *
 *  So this slices the raw string instead: drop the `scheme://authority` prefix
 *  (absolute-form `scheme://host/path`; origin-form `/path?query` already
 *  starts with `/`), then cut at the first `?` (query) or `#` (fragment). The
 *  `..`/`%2f`/`%`-bearing bytes survive untouched for serve-dir's single
 *  decode-then-split to be the sole, authoritative normalization. */
export function rawPathname(rawUrl: string): string {
  const afterAuthority = rawUrl.replace(/^[a-zA-Z][\w+.-]*:\/\/[^/]*/, "");
  const search = afterAuthority.search(/[?#]/);
  return search === -1 ? afterAuthority : afterAuthority.slice(0, search);
}

export type PathResolution =
  | { ok: true; abs: string; mime: string }
  | { ok: false; status: 400 | 403 | 404; reason: string };

/** Filesystem-authority guard, injected by the caller so this primitive stays
 *  agnostic. Given the lexically-validated absolute path, yield `true` to allow
 *  the read or `false` to reject it as a 403 (a symlink whose real target
 *  escapes the root). The kolu caller wires in kolu-git's `assertRealpathUnder`;
 *  callers with no symlink concern omit it (lexical guard only).
 *
 *  It yields an `Effect` rather than a `Promise` because it runs INSIDE
 *  `serveFile`'s scope: a caller that interrupts the read (a browser abandoning
 *  a video seek) must interrupt the guard's own filesystem walk too, and an
 *  AbortSignal cannot be threaded through a bare `Promise` face. */
export type RealpathGuard = (abs: string) => Effect.Effect<boolean>;

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
  const m = RE_BYTE_RANGE.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  if (size === 0) return "invalid";

  let start: number;
  let end: number;
  if (rawStart === "") {
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

/** Shape a resolved byte range into its HTTP response HEAD — the status +
 *  range headers a preview yields for a given (resolved range, total size).
 *  This is the response-SHAPING half of serve-dir's range contract, the
 *  consumer of `parseByteRange`'s output: a `null` range (whole file) is a full
 *  `200` carrying serve-dir's base headers UNCHANGED — deliberately NO
 *  `Content-Length` (the runtime derives it from the streamed bytes; see the
 *  200 branch in `serveFile`) — while a satisfiable `{ start, end }` is a `206`
 *  extending the base set with `Content-Range: bytes <start>-<end>/<size>` and
 *  `Content-Length`.
 *
 *  Owning it here keeps the response shape ONE source of truth: `serveFile`
 *  (local disk) and any remote arm that re-serves these bytes over the wire both
 *  consume it, so they can differ ONLY in where the body comes from, never in the
 *  status/header shape. */
export function rangeResponseHead(
  resolved: { start: number; end: number } | null,
  size: number,
  baseHeaders: Record<string, string>,
): { status: number; headers: Record<string, string> } {
  if (resolved === null) return { status: 200, headers: baseHeaders };
  return {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Range": `bytes ${resolved.start}-${resolved.end}/${size}`,
      "Content-Length": String(resolved.end - resolved.start + 1),
    },
  };
}

/** Read one header by CASE-INSENSITIVE name from a `ServeResult`-shaped header
 *  record — the single INVERSE of the header shape `serveFile` / `rangeResponseHead`
 *  produce (`Content-Type`, `Content-Range`, `Content-Length`, `ETag`, …). Lives
 *  here beside the shape it reads so a re-serving arm that parses these headers
 *  back doesn't re-roll the lookup per call site. `undefined` when absent. */
export function getHeaderCI(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function fileETag(s: { size: bigint; mtimeNs: bigint; ino: bigint }): string {
  return `"${s.size.toString(16)}-${s.mtimeNs.toString(16)}-${s.ino.toString(16)}"`;
}

type Served =
  | { readonly handle: "owned-by-stream"; readonly result: ServeResult }
  | { readonly handle: "retained"; readonly result: ServeResult };

function openUnderGuard(
  abs: string,
  realpathGuard: RealpathGuard | undefined,
): Effect.Effect<fsPromises.FileHandle | null, unknown> {
  return Effect.gen(function* () {
    if (realpathGuard && !(yield* realpathGuard(abs))) return null;
    return yield* Effect.tryPromise({
      try: () => open(abs, "r"),
      catch: (e: unknown) => e,
    });
  });
}

function statForResponse(
  handle: fsPromises.FileHandle,
): Effect.Effect<{ size: number; etag: string } | null, unknown> {
  return Effect.map(
    Effect.tryPromise({
      try: () => handle.stat({ bigint: true }),
      catch: (e: unknown) => e,
    }),
    (s: BigIntStats) =>
      s.isFile() ? { size: Number(s.size), etag: fileETag(s) } : null,
  );
}

function bytesFrom(
  handle: fsPromises.FileHandle,
  range: { start: number; end: number } | null,
): ReadableStream {
  const stream = handle.createReadStream(
    range === null ? {} : { start: range.start, end: range.end },
  );
  return Readable.toWeb(stream) as ReadableStream;
}

/** Read the resolved file and assemble the HTTP response (the I/O half).
 *
 *  The error channel is `never` on purpose: an HTTP status IS this function's
 *  success value, so a missing file (404) and an unreadable one (500) are
 *  answers, not failures. Nothing is swallowed — every I/O error reaches the
 *  caller as the status and message it maps to. */
export function serveFile(
  root: string,
  rawTail: string,
  rangeHeader?: string | null,
  realpathGuard?: RealpathGuard,
  ifRangeHeader?: string | null,
): Effect.Effect<ServeResult> {
  const res = resolvePathUnder(root, rawTail);
  if (!res.ok) {
    return Effect.succeed({
      status: res.status,
      headers: TEXT_PLAIN,
      body: res.reason,
    });
  }
  const served = Effect.acquireUseRelease(
    openUnderGuard(res.abs, realpathGuard),
    (handle) =>
      handle === null
        ? Effect.succeed<Served>({
            handle: "retained",
            result: { status: 403, headers: TEXT_PLAIN, body: "escapes root" },
          })
        : serveOpenFile(handle, res.mime, rangeHeader, ifRangeHeader),
    (handle, exit) =>
      handle === null ||
      (Exit.isSuccess(exit) && exit.value.handle === "owned-by-stream")
        ? Effect.void
        : Effect.tryPromise({
            try: () => handle.close(),
            catch: (e: unknown) => e,
          }),
  );

  return served.pipe(
    Effect.map((s) => s.result),
    Effect.catch((e: unknown) => {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return Effect.succeed<ServeResult>({
          status: 404,
          headers: TEXT_PLAIN,
          body: "not found",
        });
      }
      return Effect.succeed<ServeResult>({
        status: 500,
        headers: TEXT_PLAIN,
        body: e instanceof Error ? e.message : "internal error",
      });
    }),
  );
}

function serveOpenFile(
  handle: fsPromises.FileHandle,
  mime: string,
  rangeHeader: string | null | undefined,
  ifRangeHeader: string | null | undefined,
): Effect.Effect<Served, unknown> {
  return Effect.gen(function* () {
    const stat = yield* statForResponse(handle);
    if (stat === null) {
      return {
        handle: "retained",
        result: { status: 404, headers: TEXT_PLAIN, body: "not a file" },
      } as const;
    }

    const baseHeaders: Record<string, string> = {
      "Content-Type": mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      "Accept-Ranges": "bytes",
      ETag: stat.etag,
    };

    const honorRange = !ifRangeHeader || ifRangeHeader.trim() === stat.etag;
    const effectiveRange = honorRange ? rangeHeader : null;
    const range = effectiveRange
      ? parseByteRange(effectiveRange, stat.size)
      : null;
    if (range === "invalid") {
      return {
        handle: "retained",
        result: {
          status: 416,
          headers: {
            ...TEXT_PLAIN,
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes */${stat.size}`,
          },
          body: "range not satisfiable",
        },
      } as const;
    }

    const { status, headers } = rangeResponseHead(
      range,
      stat.size,
      baseHeaders,
    );
    return {
      handle: "owned-by-stream",
      result: { status, headers, body: bytesFrom(handle, range) },
    } as const;
  });
}
