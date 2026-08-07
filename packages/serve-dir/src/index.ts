/** `@kolu/serve-dir` — agnostic, fetch-native directory file server: given an
 *  ABSOLUTE root, answer a request for a file under it with a streaming
 *  byte-range `ServeResult`. The whole package is `(root, relPath, range) ->
 *  Effect<ServeResult>` — it knows nothing about terminals, git, or kolu (zero
 *  *workspace* deps — `node:fs`/`node:path`/`node:stream`, the focused `mrmime`
 *  MIME table, and `effect` for the I/O half's lifetime and error vocabulary),
 *  so any app serving files from a dynamic absolute root can plug in.
 *  The consumer keeps its own glue:
 *    - WHICH root (e.g. a terminal's repo root / `$PWD`) is injected by the
 *      caller, never decided here;
 *    - which HTTP runtime the `ServeResult` becomes (a Fetch `Response`, an
 *      `HttpServerResponse`, a base64 wire frame) is the CALLER's — this
 *      package deliberately stops at `{status, headers, body}` with a
 *      `ReadableStream` body, the one shape all three accept;
 *    - any response transform (e.g. kolu's artifact-sdk `<script>` injection)
 *      is an orthogonal *downstream* middleware that rewrites the HTML body —
 *      it composes for free precisely because the body is a stream and full
 *      200s omit `Content-Length` (see the 200 branch);
 *    - any URL contract (e.g. kolu's `?v=<tag>` cache key) lives in the
 *      consumer.
 *
 *  Why this isn't an off-the-shelf static server: the shape needed here is a
 *  function that RETURNS a response value. Every static-serve package
 *  (`send`/`serve-static`/`@fastify/static`/`@hono/node-server` serveStatic/…)
 *  is the inverse — a middleware bound to a fixed root that writes straight to a
 *  Node socket, so it can neither take a per-request absolute root nor compose
 *  with a downstream body transform. A 20-agent prior-art survey
 *  (`docs/atlas/src/content/atlas/electricity.mdx`) confirmed none fit; this
 *  ~`createReadStream({start,end}) -> Readable.toWeb -> {status,headers,body}`
 *  shape is the only one that does (what Deno `@std/http` and SvelteKit/Vite
 *  converge on).
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

import type { BigIntStats, promises as fsPromises } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Effect, Exit } from "effect";
import { lookup } from "mrmime";

const TEXT_PLAIN = { "Content-Type": "text/plain; charset=utf-8" };
const RE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

/** Content-Type for a path. Backed by `mrmime`'s complete IANA-derived table
 *  (the same one Vite/sirv use), so this is "any file → its real MIME", NOT a
 *  curated subset of any consumer's previewable set: for every format mrmime
 *  knows, a consumer adding it to *its* classifier needs no edit here — mrmime
 *  already types it, so the ext↔MIME coupling is dissolved. A file with no known
 *  type serves as `application/octet-stream` (the browser downloads rather than
 *  renders).
 *
 *  serve-dir's deviations from mrmime's defaults: (1) a tiny `OVERRIDES` map for
 *  generic extensions mrmime happens to omit (`.m4v`, `.ico`) — these are
 *  universal formats any file server should type, NOT a consumer's preview list;
 *  (2) append an explicit `; charset=utf-8` to text-bearing types (any
 *  `text/...`, plus the `javascript`/`json` subtypes) so non-ASCII renders.
 *
 *  The mrmime gap set (`.m4v`/`.ico`, and any future classifier entry mrmime
 *  doesn't know) is the one case the coupling is NOT dissolved but
 *  contained-by-test: the MIME lives here, the consumer's classifier asserts the
 *  appliance, and the two must co-vary. Drop an `OVERRIDES` row and the
 *  classifier still serves a `<video>`/`<img>`, but this returns
 *  `application/octet-stream` → silent download. The coverage invariant in the
 *  consumer's `iframePreviewRoute.test.ts` is load-bearing for exactly that
 *  axis, not a thin sanity check. */
const OVERRIDES: Record<string, string> = {
  m4v: "video/mp4",
  ico: "image/x-icon",
};

export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = OVERRIDES[ext] ?? lookup(filePath) ?? "application/octet-stream";
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
  // `search` is -1 when neither `?` nor `#` is present, so `slice(0, -1)` would
  // be wrong — guard it explicitly.
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
  // Single range only: `bytes=start-end`, `bytes=start-`, or `bytes=-suffix`.
  // A comma (multi-range) won't match, so we serve the whole file instead.
  const m = RE_BYTE_RANGE.exec(header.trim());
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

/** A strong content validator (`ETag`) for an open file's CURRENT bytes, derived
 *  from the same `stat` that sizes the response: size + **nanosecond** mtime + inode.
 *  Two reads of the SAME unchanged file yield the SAME token; ANY change bumps it —
 *  an in-place write or an atomic same-size replace both move `mtimeNs`, and a
 *  replace also swaps the `inode`. Nanosecond mtime (not millisecond) is what makes
 *  it a genuinely STRONG validator: a same-size in-place rewrite within the same
 *  millisecond still changes `mtimeNs`, so it is caught — a millisecond-rounded token
 *  would miss that sub-ms window. serve-dir honors `If-Range` against this token (see
 *  `serveFile`) but never returns 304. Its other purpose: a re-serving arm that
 *  reassembles ONE response from MULTIPLE reads — kolu's remote-bound preview, which
 *  dials `preview.read` in bounded chunks — proves every chunk came from a single
 *  file snapshot and fails LOUD otherwise. It is the cross-read analogue of the
 *  single-open-handle invariant a local `serveFile` gets for free (one handle pins
 *  one inode for the whole body); across an RPC boundary the handle can't be shared,
 *  so the validator carries the identity in its place. */
function fileETag(s: { size: bigint; mtimeNs: bigint; ino: bigint }): string {
  return `"${s.size.toString(16)}-${s.mtimeNs.toString(16)}-${s.ino.toString(16)}"`;
}

/** A file handle plus WHO owns it once the body below is done with it. The
 *  streaming exits hand the handle to `Readable.toWeb` (whose `createReadStream`
 *  owns the lifecycle — `autoClose` defaults on); every other exit leaves it to
 *  the finalizer. Ownership is carried by the exit VALUE rather than by a
 *  boolean over time, so there is no window in which the two disagree — and
 *  because the finalizer is the one that closes, an INTERRUPT (a browser
 *  abandoning a seek between the open and the first byte) closes it too, which
 *  the hand-unwound version could not do. */
interface Served {
  readonly result: ServeResult;
  /** True when `result.body` is a stream that has taken the handle over. */
  readonly streams: boolean;
}

/** Read the resolved file and assemble the HTTP response (the I/O half).
 *  Separated from `resolvePathUnder` so the guard is testable without fixtures
 *  and the I/O failure modes are testable without crafting URLs.
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
  // Every successful response — 200 and 206 alike — streams from a single open
  // file handle: `open` → `handle.stat()` (the size that drives range math AND
  // the headers) → `handle.createReadStream`. Deriving the size and the bytes
  // from the *same* open file description — rather than a `stat(path)` then a
  // separate `createReadStream(path)` — tightens the stat/read race on a
  // live-reloading root: the handle pins one inode, so an *atomic* replace
  // (write-temp-then-rename) leaves the already-sized headers and the streamed
  // body describing one consistent file. Open/stat failures fail this effect and
  // map to 404/500 below, *before* any 200/206 is returned.
  //
  // Streaming the full 200 (not just the ranged 206) is the load-bearing reason
  // a multi-GB video never lands in the server heap: a client that omits a Range
  // header — or sends a multi-range one we collapse to 200 — would otherwise
  // force the whole file through `readFile`. The downstream HTML decorator still
  // works because it consumes only `text/html` (via `res.text()`), and a
  // `ReadableStream` body answers `.text()` just as a buffer does.
  const served = Effect.acquireUseRelease(
    // Stage 2 (injected): filesystem-authority check, INSIDE the acquire so it
    // runs before a descriptor exists. `resolvePathUnder` is lexical only, so a
    // repo-local `leak.html -> /etc/passwd` slips through it; the caller's guard
    // resolves symlinks and rejects anything whose real path escapes the root,
    // BEFORE any open/stat/read below. A rejection is a 403 ANSWER, not an
    // error, so it rides the acquire's success channel as a handle-less
    // `Served` the use step passes straight through.
    Effect.gen(function* () {
      if (realpathGuard && !(yield* realpathGuard(res.abs))) {
        return null;
      }
      // `catch: (e) => e` keeps the raw node error — the ENOENT/EACCES `code`
      // below is what picks 404 from 500, and the default `UnknownError`
      // wrapper would erase it.
      return yield* Effect.tryPromise({
        try: () => open(res.abs, "r"),
        catch: (e: unknown) => e,
      });
    }),
    (handle) =>
      handle === null
        ? Effect.succeed<Served>({
            result: { status: 403, headers: TEXT_PLAIN, body: "escapes root" },
            streams: false,
          })
        : serveOpenFile(handle, res.mime, rangeHeader, ifRangeHeader),
    (handle, exit) =>
      // The handle closes here on EVERY exit that did not hand it to a stream:
      // the 404/416 answers, a failure, and — new under Effect — an interrupt.
      // A close that itself fails still fails this effect (and lands as a 500
      // below), exactly as the hand-unwound `await handle.close()` did on the
      // non-streaming branches.
      handle === null || (Exit.isSuccess(exit) && exit.value.streams)
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
      // Unexpected I/O error (EACCES, EIO, …) — surface as 500 so it doesn't
      // masquerade as a missing file.
      return Effect.succeed<ServeResult>({
        status: 500,
        headers: TEXT_PLAIN,
        body: e instanceof Error ? e.message : "internal error",
      });
    }),
  );
}

/** The response for an ALREADY-OPEN handle: stat it, shape the headers, decide
 *  the byte source. Split out so `serveFile` above reads as the resource
 *  lifetime it is, and so every exit here says in its `streams` flag whether it
 *  handed the descriptor to a stream — the ownership question the caller's
 *  finalizer asks. */
function serveOpenFile(
  handle: fsPromises.FileHandle,
  mime: string,
  rangeHeader: string | null | undefined,
  ifRangeHeader: string | null | undefined,
): Effect.Effect<Served, unknown> {
  return Effect.gen(function* () {
    // `Accept-Ranges: bytes` advertises that this route can range-serve, which
    // is what lets a `<video>` element seek.
    const baseHeaders: Record<string, string> = {
      "Content-Type": mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      "Accept-Ranges": "bytes",
    };

    // `bigint: true` gives NANOSECOND `mtimeNs` for a genuinely strong `ETag`
    // (see `fileETag`); `size`/`ino` come back as bigint too, so derive a Number
    // `size` for the range math (files are never near 2^53 bytes).
    const s: BigIntStats = yield* Effect.tryPromise({
      try: () => handle.stat({ bigint: true }),
      catch: (e: unknown) => e,
    });
    if (!s.isFile()) {
      return {
        result: { status: 404, headers: TEXT_PLAIN, body: "not a file" },
        streams: false,
      };
    }
    const size = Number(s.size);
    // The strong validator rides EVERY streamed 200/206 (both share `baseHeaders`),
    // so a re-serving remote arm can prove a multi-read reassembly stayed on one
    // file snapshot (see `fileETag`). Derived from the SAME `stat` as the size, so
    // headers and body agree on one file description.
    baseHeaders.ETag = fileETag(s);

    const streamBody = (start?: number, end?: number): ReadableStream => {
      const stream = handle.createReadStream(
        start === undefined ? {} : { start, end },
      );
      return Readable.toWeb(stream) as ReadableStream;
    };

    // `If-Range` (RFC 9110 §13.1.3): honor the `Range` ONLY when the client's
    // validator still matches this file's CURRENT strong `ETag`; if the file has
    // changed since the client last saw it, serve the WHOLE representation (200)
    // rather than a 206 slice it would stitch onto stale bytes. We emit only a
    // strong ETag, so any non-matching `If-Range` (a mismatched tag, or a date form
    // we don't mint) conservatively collapses to the full 200. No `If-Range`, or a
    // matching one, honors the range as before.
    const honorRange =
      !ifRangeHeader || ifRangeHeader.trim() === baseHeaders.ETag;
    const effectiveRange = honorRange ? rangeHeader : null;

    const range = effectiveRange ? parseByteRange(effectiveRange, size) : null;
    if (range === "invalid") {
      // The body is a plain-text error, so type it `text/plain` — NOT the
      // target file's `mime` from `baseHeaders`. Under `nosniff`, reusing
      // `video/mp4`/`text/html` here would tell clients/debuggers the error
      // text is media/HTML; an HTML 416 would also dodge the artifact
      // middleware while still advertising `text/html`. Keep the range-specific
      // `Accept-Ranges`/`Content-Range`/`nosniff` headers, just not the mime.
      return {
        result: {
          status: 416,
          headers: {
            ...TEXT_PLAIN,
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes */${size}`,
          },
          body: "range not satisfiable",
        },
        streams: false,
      };
    }
    // Shape status + range headers in one place (`rangeResponseHead`, serve-dir's
    // own response contract); this branch owns only the byte source. A 206 reads
    // just `[start, end]` — `createReadStream({ start, end })` against a multi-GB
    // video moves those bytes, not the whole file, through the heap. A full 200
    // (no Range header, or one we collapse — open `bytes=-`, multi-range,
    // malformed) streams the whole file and carries NO `Content-Length`
    // (rangeResponseHead omits it): the runtime derives it from the bytes actually
    // written to the socket. Load-bearing — (1) a downstream HTML-transform
    // middleware (kolu's artifact-sdk decorator) may splice bytes into a text/html
    // response *after* this returns; a Content-Length pinned to the pre-splice
    // size truncates the injected body. (2) deriving from the sent bytes is
    // race-free on a live-reloading root, where a stat and a later read could
    // disagree. A 206 DOES carry Content-Length: a partial response must, and it's
    // never decorated (an HTML transform only touches status 200).
    const { status, headers } = rangeResponseHead(range, size, baseHeaders);
    const body = range ? streamBody(range.start, range.end) : streamBody();
    // The stream now owns the descriptor: `createReadStream`'s `autoClose`
    // defaults on, closing it on end/error — including a consumer that abandons
    // the body mid-video.
    return { result: { status, headers, body }, streams: true };
  });
}
