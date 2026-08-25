/** Kolu glue for the iframe-preview file route
 *  (`FsReadFileOutput.kind === "binary"`). The byte read itself (range,
 *  content-type, lexical + realpath guard) is now padi's `previewFile` — the
 *  STREAMING serve-dir read this route is backed by, so a
 *  multi-GB video flows disk→socket with bounded heap. (`padiSurface.procedures
 *  .preview.read` / `readPreview` is the BASE64 WIRE-ONLY wrapper over the same
 *  read.)
 *
 *  This module owns BOTH arms of that route:
 *    - LOCAL binding — the route calls `previewFile` directly (this machine's disk,
 *      the streaming form, no hop);
 *    - REMOTE binding (`KOLU_PADI_HOST`) — the route calls {@link assembleRemotePreview}
 *      here, which dials the bound padi's `preview.read` in bounded chunks so the
 *      RIGHT host's bytes flow back with a bounded heap (see that function). The
 *      old fail-closed 501 is gone.
 *
 *  What also remains here are the PURE web-shell URL helper the route needs to
 *  hand a correct, un-normalized file tail to EITHER arm, and the route itself:
 *    - `previewTailFromRawUrl` slices the terminal-scoped file path out of the
 *      RAW request target, keeping `%`-encoding intact so serve-dir's single
 *      decode recovers the real name and the per-segment `..`/`%2f` traversal
 *      guard still fires;
 *    - {@link previewRouteHandler} is the route, on `effect/unstable/http`.
 *  Both are unit-tested in `iframePreviewRoute.test.ts` (including end-to-end
 *  over a real node server); the realpath/symlink guard's 403 coverage now lives
 *  against padi's `previewFile`.
 *
 *  There is no longer a "select the raw target" adapter: `HttpServerRequest.url`
 *  IS the node `IncomingMessage.url` (`NodeHttpServer`'s request impl assigns it
 *  verbatim), so the raw, un-normalized origin-form target reaches the handler
 *  with no WHATWG round trip to defend against and no absent-`incoming` case to
 *  fail closed on. That property is what the integration test at the bottom of
 *  `iframePreviewRoute.test.ts` proves empirically, and it is why this route must
 *  be reached through the NODE handler path — `HttpRouter.toWebHandler` builds a
 *  Web `Request` and re-normalizes, which would silently reopen the traversal
 *  hole. */

import type { Logger } from "@kolu/log";
import { previewFile } from "@kolu/padi/assembly";
import type { PadiPreviewReadOutputSchema } from "@kolu/padi-client/surface";
import type { ServeResult } from "@kolu/serve-dir";
import {
  getHeaderCI,
  parseByteRange,
  rangeResponseHead,
  rawPathname,
} from "@kolu/serve-dir";
import { Effect, Result, Stream } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import {
  decodeHostKey,
  decodeHostKeyValue,
  encodeHostKey,
} from "kolu-common/hostKey";
import {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";
import type { HostKey } from "kolu-common/surfacesWithPadi";

/** Extract the still-encoded path tail for a terminal's preview route from a
 *  RAW request URL. Slices off `${BASE}/{host}/{terminalId}/${FILE}/`, returning
 *  the remaining percent-encoded segments (or `""` when the URL doesn't match the
 *  prefix — the route registration guarantees it does, but the guard keeps this
 *  pure and total).
 *
 *  `host` is the DECODED route param (`HttpRouter.params.host`); the client
 *  encodes it with `encodeURIComponent` (see `buildTerminalFileUrl`), so
 *  re-encoding it here reproduces the exact raw segment the pathname carries —
 *  the same canonical round-trip the caller relies on.
 *
 *  The un-normalized pathname comes from serve-dir's `rawPathname`, NOT
 *  `new URL(rawUrl).pathname` / a router's own decoded params — see
 *  `rawPathname`'s doc comment for why every pre-normalizing/pre-decoding source
 *  defeats a guard serve-dir is supposed to enforce. Here we only add the
 *  kolu-specific prefix slice on top of that raw pathname. */
export function previewTailFromRawUrl(
  rawUrl: string,
  host: string,
  terminalId: string,
): string {
  const prefix = `${TERMINAL_FILE_ROUTE_BASE}/${encodeURIComponent(host)}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/`;
  const pathname = rawPathname(rawUrl);
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
}

// ── The REMOTE arm: serve a bound host's bytes by dialing `padiSurface.preview.read` ──
//
// Under a REMOTE padi binding (`KOLU_PADI_HOST`) the terminal registry — and the
// repo roots it resolves — live on the ssh HOST, while `previewFile` (the LOCAL
// arm) reads THIS machine's disk. Reading a remote path locally would serve the
// wrong machine's bytes; that's why the route once fail-closed with a 501. It no
// longer refuses: it serves the RIGHT host's bytes by dialing the bound padi's
// `preview.read` procedure — the SAME serve-dir read the local arm uses, but over
// the wire (base64) — and reassembles them into the same streaming `ServeResult`
// the local arm produces, byte- and header-identical.
//
// `preview.read` is base64-wire, so its whole body must materialize in memory once.
// A multi-GB video forced through one call would blow both the daemon's and
// kolu-server's heap (and hit `readPreview`'s 64 MiB inline cap). So this arm NEVER
// asks for the whole file at once: it drives BOUNDED byte ranges in a loop, each
// ≤ `REMOTE_PREVIEW_CHUNK_BYTES`, and pushes them into a `ReadableStream` the
// route hands to the socket — so the peak heap is one chunk, not one file, on both
// hops. Range resolution (which 206/416/200 a given `Range` header yields) is NOT
// re-implemented here: it's `@kolu/serve-dir`'s own `parseByteRange`, the single
// source of truth the local read runs through.

/** The maximum bytes pulled per `preview.read` dial in {@link assembleRemotePreview}.
 *
 *  Bounds the transient heap on BOTH hops: each dial materializes at most this many
 *  bytes as a base64 string (~1.33×) plus its decoded `Buffer` (~1×) in the daemon,
 *  and again the decoded `Buffer` in kolu-server — so a whole preview costs O(chunk),
 *  never O(file), no matter how large. 8 MiB is a deliberate balance: comfortably
 *  under `readPreview`'s 64 MiB inline cap, large enough that a typical
 *  document/image preview lands in one or two dials, small enough that a multi-GB
 *  `<video>` scrub streams without a heap spike. A file larger than one chunk simply
 *  takes more dials; the memory bound holds regardless. */
export const REMOTE_PREVIEW_CHUNK_BYTES = 8 * 1024 * 1024;

/** A 1-byte ranged probe. On a non-empty file serve-dir answers `206` with the
 *  file's true `Content-Range` (`bytes 0-0/<total>`) and `Content-Type` — so ONE
 *  round trip learns the total size, the mime, and existence WITHOUT pulling the
 *  body. On a zero-length file the same probe is unsatisfiable → `416`. */
const PREVIEW_PROBE_RANGE = "bytes=0-0";

/** The shape `padiSurface.preview.read` returns (verbatim from serve-dir, body
 *  base64-encoded for the wire) — the canonical padiSurface contract type, not a
 *  hand-copy, so an added contract field can't drift from this consumer. The pure
 *  TYPE import keeps {@link assembleRemotePreview} unit-testable against a fake
 *  reader with no orpc runtime dependency ({@link PreviewRangeReader} stays the
 *  structural seam). */
export type PreviewReadResult = typeof PadiPreviewReadOutputSchema.Type;

/** Dial `preview.read` for one (optional) `Range`. In production this closes over
 *  the bound padi client + the terminal's `{repoPath, filePath}`; in tests it's a
 *  fake driving fixed bytes. */
export type PreviewRangeReader = (
  range: string | undefined,
) => Effect.Effect<PreviewReadResult, unknown>;

/** Bind a padi `preview.read` procedure to ONE terminal's `{repoPath, filePath}`,
 *  producing the {@link PreviewRangeReader} the assembler dials.
 *
 *  This exists as a named function rather than an inline closure in the route
 *  because of the ONE line inside it. `range` is `Schema.optionalKey` on padi's
 *  wire and the client face DECODES the input at the call site, so an ABSENT key
 *  is accepted and a present-but-`undefined` one is REJECTED — where zod's
 *  `.optional()` took either (#17). An UNRANGED dial is not an edge case: the
 *  assembler makes one for an empty file's Content-Type, and any browser request
 *  without a `Range` header makes one too. Spelling the `undefined` therefore
 *  turned an ordinary remote preview into the route's 503. Keeping the spread here,
 *  beside the type that documents the optional argument, is what makes it testable
 *  against the real face. */
export function remotePreviewReader(
  read: (input: {
    repoPath: string;
    filePath: string;
    range?: string;
  }) => Effect.Effect<PreviewReadResult, unknown>,
  repoPath: string,
  filePath: string,
): PreviewRangeReader {
  return (range) =>
    read({
      repoPath,
      filePath,
      ...(range !== undefined && { range }),
    });
}

/** Parse a serve-dir 206 `Content-Range` (`bytes <start>-<end>/<total>`) in FULL —
 *  start, end AND total — so a chunk can be validated against the EXACT slice it
 *  was asked for, not merely its total size: a broken upstream that answered the
 *  right LENGTH from the wrong OFFSET (`bytes 128-255` for a `bytes=0-127` request)
 *  is caught here, not emitted silently. Throws LOUDLY on a malformed/absent header
 *  — a 206 that can't state its own range is a broken read, never a silent accept.
 *  Reads the header through serve-dir's shared `getHeaderCI` (the one case-insensitive
 *  lookup over serve-dir's own header shape), not a hand-rolled scan.
 *
 *  Only serve-dir's 206 form (`bytes a-b/total`) is parsed here; a 416's
 *  `bytes *​/total` never reaches this (a 416 is propagated verbatim as an
 *  `errorResult`, never chunked). */
function parseContentRange(headers: Record<string, string>): {
  start: number;
  end: number;
  total: number;
} {
  const cr = getHeaderCI(headers, "content-range");
  if (cr === undefined)
    throw new Error(
      `remote preview: a ranged read returned no Content-Range (headers: ${JSON.stringify(headers)})`,
    );
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr.trim());
  if (!m) throw new Error(`remote preview: unparseable Content-Range "${cr}"`);
  return { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) };
}

/** The serve-dir statuses that carry a plain-text reason and propagate VERBATIM as
 *  an `errorResult` (a real `400` bad path / `403` escape / `404` missing / `500`
 *  I/O fault). A status OUTSIDE this set on a probe/re-dial is a broken upstream a
 *  ranged read must never produce (a `200`/`3xx`) — the callers below fail LOUD on
 *  it rather than mangle a possibly-binary body through `errorResult`'s UTF-8
 *  decode and serve it under a success status. */
function isServeDirErrorStatus(status: number): boolean {
  return status === 400 || status === 403 || status === 404 || status === 500;
}

/** Strip the range-specific headers (`Content-Range`, `Content-Length`) from a
 *  probe's 206 headers, leaving serve-dir's base set (`Content-Type`,
 *  `Accept-Ranges`, `Cache-Control`, `X-Content-Type-Options`) — the exact headers
 *  a full 200 carries, and the base a reconstructed 206 extends. */
function baseHeadersFrom(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === "content-range" || lk === "content-length") continue;
    out[k] = v;
  }
  return out;
}

/** A serve-dir error/plain-text response (`400`/`403`/`404`/`416`/`500`) as a
 *  `ServeResult` — the base64 body decoded back to its text reason. */
function errorResult(r: PreviewReadResult): ServeResult {
  return {
    status: r.status,
    headers: r.headers,
    body: Buffer.from(r.bodyBase64, "base64").toString("utf8"),
  };
}

/** An already-closed byte stream — the body of a full 200 over a zero-length file. */
function emptyStream(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

/** Stream `[lo, hi]` (inclusive) by looping bounded `read` dials of at most
 *  {@link REMOTE_PREVIEW_CHUNK_BYTES} each, enqueuing decoded bytes as they arrive.
 *  Every dial is VALIDATED against the SNAPSHOT the probe measured, and any failure
 *  THROWS — which ERRORS the stream and aborts the HTTP response. That is the
 *  fail-loud contract: an inconsistent remote read surfaces as a broken/reset
 *  response, NEVER a clean body that silently mixes or drops bytes. The checks, in
 *  order:
 *    - a non-206 status → a truncated/failed read;
 *    - the total size CHANGED → the file was resized under the loop;
 *    - the returned slice ISN'T the one we asked for (right length, wrong offset) →
 *      a broken upstream serving the wrong bytes;
 *    - the strong `etag` validator CHANGED → the file was replaced mid-stream, even
 *      by another file of the SAME size (which the total check alone can't catch) —
 *      the cross-read analogue of the local read's single-open-handle invariant;
 *    - the decoded chunk is SHORT of the range it promised. */
function streamByteRange(
  read: PreviewRangeReader,
  lo: number,
  hi: number,
  total: number,
  etag: string,
  chunkBytes: number,
): ReadableStream {
  // One PULL per chunk, expressed as a `Stream` of the chunk WINDOWS and mapped
  // through the dial — then handed to the platform as a `ReadableStream` by Effect's
  // own destructor. That is what keeps the loop composable without a run edge: the
  // Web Streams `pull` callback is Promise-shaped and foreign, and
  // `Stream.toReadableStream` is the framework's own crossing of it. A failure below
  // ERRORS the resulting stream, which aborts the HTTP response — the same fail-loud
  // contract the thrown version had.
  const windows: Array<readonly [number, number]> = [];
  for (let pos = lo; pos <= hi; pos += chunkBytes) {
    windows.push([pos, Math.min(pos + chunkBytes - 1, hi)] as const);
  }
  return Stream.toReadableStream(
    Stream.mapEffect(Stream.fromArray(windows), ([pos, end]) =>
      Effect.map(read(`bytes=${pos}-${end}`), (chunk) => {
        if (chunk.status !== 206)
          throw new Error(
            `remote preview chunk bytes=${pos}-${end}: expected 206, got ${chunk.status} — refusing a truncated body`,
          );
        const cr = parseContentRange(chunk.headers);
        if (cr.total !== total)
          throw new Error(
            `remote preview: file size changed mid-stream (${total} → ${cr.total}) — refusing an inconsistent body`,
          );
        if (cr.start !== pos || cr.end !== end)
          throw new Error(
            `remote preview chunk bytes=${pos}-${end}: server answered the wrong slice (bytes ${cr.start}-${cr.end}) — refusing a mismatched body`,
          );
        const chunkETag = getHeaderCI(chunk.headers, "etag");
        if (chunkETag !== etag)
          throw new Error(
            `remote preview: file changed mid-stream (validator ${etag} → ${chunkETag ?? "<none>"}) — refusing an inconsistent body`,
          );
        const buf = Buffer.from(chunk.bodyBase64, "base64");
        const want = end - pos + 1;
        if (buf.byteLength !== want)
          throw new Error(
            `remote preview chunk bytes=${pos}-${end}: expected ${want} bytes, got ${buf.byteLength} — refusing a truncated body`,
          );
        // `buf` is a fresh, dedicated allocation from this pull's base64 decode
        // (a production `REMOTE_PREVIEW_CHUNK_BYTES` chunk is far past Node's 4 KiB
        // pool threshold, and even a small pooled decode is never handed back over a
        // still-live view) — so emit it directly. A defensive `new Uint8Array(buf)`
        // copy would add a full-chunk memcpy per pull on the hot path (a multi-GB
        // video is hundreds of 8 MiB chunks) for no safety gain.
        return buf;
      }),
    ),
  ) as ReadableStream;
}

/** Serve a remotely-bound file's bytes as a streaming {@link ServeResult}, shaped
 *  exactly like the LOCAL `previewFile` — same status, same headers, same body —
 *  but assembled by dialing `padiSurface.preview.read` in bounded chunks so the
 *  file's bytes come from the RIGHT host and the heap stays O(chunk).
 *
 *  Mirrors serve-dir's own `serveFile` decisions, reusing `parseByteRange` rather
 *  than re-deriving them: a `Range`-less request → full 200 (streamed, no
 *  `Content-Length`); a satisfiable range → 206 with `Content-Range`/`Content-Length`;
 *  an unsatisfiable range → 416; a missing/escaping file → the guard's 403/404
 *  verbatim. The `..`/`%2f`/symlink defenses still run TWICE — the raw-tail slice in
 *  the route (this module's `previewTailFromRawUrl`) before the dial, and padi's own
 *  realpath guard host-side inside the read. */
export function assembleRemotePreview(
  read: PreviewRangeReader,
  browserRange: string | undefined,
  // Raw HTTP `If-Range` header (RFC 9110 §13.1.3): the browser's `Range` is honored
  // only while this still matches the file's current strong `ETag`; a stale one
  // serves the full 200 instead of a 206 the client would stitch onto changed bytes.
  // Omitted = honor the range unconditionally. Evaluated here (kolu-server), so
  // padi's `preview.read` needs no `If-Range` field — the chunk dials never carry it.
  ifRange?: string,
  // The per-dial byte bound. A genuine parameter of the loop, not a production
  // knob: the sole production caller passes {@link REMOTE_PREVIEW_CHUNK_BYTES}; the
  // default matches it, and unit tests pass a tiny value to exercise chunk-boundary
  // behavior on small fixtures instead of multi-megabyte ones.
  chunkBytes: number = REMOTE_PREVIEW_CHUNK_BYTES,
): Effect.Effect<ServeResult, unknown> {
  return Effect.gen(function* () {
    // 1. METADATA PROBE — 1 byte learns total size + mime + validator + existence, no
    //    body pull.
    const probe = yield* read(PREVIEW_PROBE_RANGE);

    // A ranged read can only answer 206 (non-empty), 416 (empty file), or a real
    // serve-dir error (400/403/404/500 — propagate verbatim). Anything else (a 200
    // or 3xx a ranged read must NEVER produce) is a broken upstream: fail LOUD rather
    // than mangle its possibly-binary body through `errorResult` and serve it under a
    // success status.
    if (probe.status !== 206 && probe.status !== 416) {
      if (isServeDirErrorStatus(probe.status)) return errorResult(probe);
      throw new Error(
        `remote preview: probe ${PREVIEW_PROBE_RANGE} returned unexpected status ${probe.status} — refusing to serve`,
      );
    }

    if (probe.status === 416) {
      // 416 on a `bytes=0-0` read ⇒ a ZERO-length file (byte 0 is unsatisfiable only
      // when size is 0). Match serve-dir exactly: a ranged browser request 416s (its
      // `Content-Range: bytes *​/0` is identical to the probe's, size-independent), an
      // unranged one 200s empty.
      const rangeSent = parseByteRange(browserRange, 0) === "invalid";
      // Fast path: a range with no `If-Range` on an empty file is unsatisfiable → 416,
      // no second dial needed.
      if (rangeSent && ifRange === undefined) return errorResult(probe);
      // Full 200 empty — dial UNRANGED for the file's real Content-Type (and, for the
      // If-Range case below, its ETag), which only an unranged read exposes for an
      // empty file (every ranged read 416s). The body is 0 bytes, so no cap concern.
      const empty = yield* read(undefined);
      if (empty.status !== 200) {
        if (isServeDirErrorStatus(empty.status)) return errorResult(empty);
        throw new Error(
          `remote preview: unranged empty-file re-read returned unexpected status ${empty.status} — refusing to serve`,
        );
      }
      // The probe said EMPTY; if the re-read now carries bytes, the file GREW between
      // the two dials. Refuse rather than silently serving a 0-byte body for a file
      // that is no longer empty — the empty-file analogue of the mid-stream guards.
      if (Buffer.from(empty.bodyBase64, "base64").byteLength !== 0)
        throw new Error(
          "remote preview: file became non-empty between the empty-file probe and its re-read — refusing an inconsistent body",
        );
      // A range WITH an If-Range on an empty file: honor it (→ 416, unsatisfiable) only
      // while the validator still matches; a stale one means the file changed → serve
      // the full (empty) 200, matching serve-dir's own If-Range handling on the local
      // arm. (`ifRange` is defined here — the `rangeSent && ifRange === undefined` fast
      // path returned above.)
      if (rangeSent) {
        const emptyEtag = getHeaderCI(empty.headers, "etag");
        if (emptyEtag !== undefined && ifRange?.trim() === emptyEtag)
          return errorResult(probe);
      }
      return { status: 200, headers: empty.headers, body: emptyStream() };
    }

    // 2. probe is 206 ⇒ a non-empty file. Learn its total, its strong validator, and
    //    serve-dir's base headers, then resolve the browser's effective range with
    //    serve-dir's OWN parser.
    const { total } = parseContentRange(probe.headers);
    // The validator pins the file SNAPSHOT across the whole multi-chunk read (see
    // `streamByteRange`). serve-dir sets it on every streamed 200/206, so its absence
    // on a 206 is a serve-dir contract break — fail LOUD, never chunk without it.
    const etag = getHeaderCI(probe.headers, "etag");
    if (etag === undefined)
      throw new Error(
        "remote preview: a 206 probe carried no ETag validator — cannot guarantee a consistent multi-chunk read",
      );
    const baseHeaders = baseHeadersFrom(probe.headers);
    // If-Range (RFC 9110 §13.1.3): honor the browser's Range only while its validator
    // still matches this file's current strong ETag; a stale one collapses to the full
    // 200 (never a 206 slice the client would stitch onto changed bytes). Mirrors
    // serve-dir's own If-Range handling on the local arm, so both stay in step.
    const honorRange = ifRange === undefined || ifRange.trim() === etag;
    const resolved = parseByteRange(
      honorRange ? browserRange : undefined,
      total,
    );

    if (resolved === "invalid") {
      // Re-dial with the browser's exact range so serve-dir emits its verbatim 416
      // (rather than reconstructing its header shape here). A 416 body is tiny. A
      // status OTHER than 416 here is a broken upstream (the range was unsatisfiable
      // against the probe's total) — fail LOUD.
      const redial = yield* read(browserRange);
      if (redial.status !== 416)
        throw new Error(
          `remote preview: expected 416 re-dialing unsatisfiable range "${browserRange}", got ${redial.status}`,
        );
      return errorResult(redial);
    }

    const [lo, hi] =
      resolved === null ? [0, total - 1] : [resolved.start, resolved.end];
    // Shape status + range headers through serve-dir's OWN `rangeResponseHead` — the
    // same response contract the local `serveFile` runs through — so the remote arm
    // differs from the local one ONLY in where the body comes from (a chunked wire
    // reader here, a local file stream there), never in status/header shape. A full
    // 200 carries NO Content-Length (serve-dir omits it; the runtime derives it from
    // the streamed bytes); a 206 adds the range pair.
    const { status, headers } = rangeResponseHead(resolved, total, baseHeaders);

    return {
      status,
      headers,
      body: streamByteRange(read, lo, hi, total, etag, chunkBytes),
    };
  });
}

// ── The ROUTE ────────────────────────────────────────────────────────────────
//
// Serves repo files referenced by `FsReadFileOutput.kind === "binary"`. The URL
// contract (base + builder + parser) lives entirely in this module and
// `kolu-common/preview`; the composition root only supplies the pool, the logger
// and the artifact-sdk decoration.

/** The route pattern. `:host` / `:terminalId` are ordinary params (the router
 *  decodes them, which is correct — the client `encodeURIComponent`s both, see
 *  `buildTerminalFileUrl`); the trailing `*` matches the file tail, which is
 *  deliberately NOT read from the router — see {@link previewRouteHandler}. */
export const PREVIEW_ROUTE_PATTERN =
  `${TERMINAL_FILE_ROUTE_BASE}/:host/:terminalId/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/*` as const;

/** The bound-padi members this route dials, as a NARROW structural seam rather
 *  than the full `PadiSurfaceClient`: the route needs exactly two procedures, so
 *  spelling those two keeps it testable against a fake with no dial machinery.
 *  `iframePreviewRoute.test.ts` pins the real client/session/pool types against
 *  these, so the seam cannot drift from what the composition root passes. */
export interface PreviewPadiClient {
  readonly surface: {
    readonly preview: {
      readonly repoRootForTerminal: (input: {
        terminalId: string;
      }) => Effect.Effect<{ repoRoot: string | null }, unknown>;
      readonly read: (input: {
        repoPath: string;
        filePath: string;
        range?: string;
      }) => Effect.Effect<PreviewReadResult, unknown>;
    };
  };
}

/** One host's warm padi session (the `@kolu/surface-remote` `Session` shape). */
export interface PreviewHostSession {
  currentClient(): Promise<PreviewPadiClient> | null;
}

/** The host pool the route resolves `:host` against. */
export interface PreviewHostPool {
  getSession(encodedHost: string): PreviewHostSession | undefined;
}

/** A plain-text refusal. Every non-body arm of the route answers with one, and
 *  they are what the e2e browse scenarios observe. */
const refusal = (body: string, status: number) =>
  HttpServerResponse.text(body, {
    status,
    contentType: "text/plain; charset=utf-8",
  });

/** serve-dir's `ServeResult` → an HTTP response, verbatim. A `ReadableStream`
 *  body stays a stream (bytes flow disk→socket with a bounded heap, so a
 *  multi-GB video never lands in kolu-server's memory); a string body is an
 *  error reason. Status and headers are serve-dir's own — this route never
 *  reshapes them. */
const serveResultResponse = (
  r: ServeResult,
): HttpServerResponse.HttpServerResponse =>
  typeof r.body === "string"
    ? HttpServerResponse.text(r.body, { status: r.status, headers: r.headers })
    : HttpServerResponse.stream(
        Stream.fromReadableStream({
          evaluate: () => r.body as ReadableStream<Uint8Array>,
          onError: (error) => error,
        }),
        { status: r.status, headers: r.headers },
      );

/** The iframe-preview byte route's handler.
 *
 *  Compose it into a router at {@link PREVIEW_ROUTE_PATTERN}, wrapped in
 *  artifact-sdk's `withArtifactSdk` decorator so `text/html` previews carry the
 *  comments SDK. The decoration is applied by the caller, not here: it belongs
 *  to kolu's product, not to the byte route. */
export const previewRouteHandler = (options: {
  readonly pool: PreviewHostPool;
  readonly log: Pick<Logger, "error">;
}): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext
> =>
  Effect.gen(function* () {
    const { pool, log } = options;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const rawHostParam = params.host;
    const terminalId = params.terminalId;
    // Unreachable through the registered pattern — both segments must match for
    // this handler to run at all. Stated rather than cast so the route is total.
    if (rawHostParam === undefined || terminalId === undefined) {
      return refusal("malformed preview route", 400);
    }

    // The preview reads a per-HOST terminal's bytes, so the tab's active host rides
    // in the URL (`buildTerminalFileUrl`, as `encodeHostKey`'s canonical string) and we
    // resolve against THAT host's padi — not the local default. Without this, switching
    // to a remote host would ask the LOCAL padi about a remote terminal id (a 404, or
    // the wrong bytes on an id collision). Decode + re-validate the key through the
    // SAME codec + schema the map is keyed by (rejects a malformed segment → 400), then
    // find its warm session; a key that isn't a current pool member (an unseeded or
    // departed host) is a loud 404, never a silent fall-through to the default host.
    let host: HostKey;
    try {
      host = decodeHostKeyValue(decodeHostKey(rawHostParam));
    } catch {
      return refusal("invalid host key", 400);
    }
    const session = pool.getSession(encodeHostKey(host));
    if (!session) {
      return refusal(`unknown host "${encodeHostKey(host)}"`, 404);
    }

    // Slice the tail off the RAW request target — NOT the router's decoded
    // params. `HttpRouter.params["*"]` is `decodeURIComponent`d by the matcher,
    // which would decode the tail before `@kolu/serve-dir` decodes it again
    // (double-decode), and any WHATWG `new URL(...)` round trip would collapse
    // `foo/../secret` and `foo/%2e%2e/` to `secret` BEFORE the handler sees it,
    // defeating serve-dir's `..` guard. `HttpServerRequest.url` on the node
    // handler path IS the raw `IncomingMessage.url` (origin-form `/path?query`),
    // so it is exactly what serve-dir must see. `previewTailFromRawUrl` documents
    // the rest (correctness for `%`-bearing names + `%2f` traversal defense) and
    // is unit-tested — including end-to-end over a real node server — in
    // `iframePreviewRoute.test.ts`.
    const rawTail = previewTailFromRawUrl(
      request.url,
      rawHostParam,
      terminalId,
    );

    // Which directory this terminal serves (its git repo root) — RE-SOURCED from
    // padi's registry over the SELECTED host's session, since padi (not kolu-server)
    // owns the terminal registry now. padi resolves terminal id → repoRoot; how
    // kolu-server then reads the bytes forks on the host (local disk vs. the remote
    // host), see below. Either way the file is never forced whole through the base64
    // procedure.
    const clientPromise = session.currentClient();
    // A degraded/warming binding (skew · unconverged · linkFailed · not-yet-connected)
    // yields a NULL `currentClient()` (`remotePadiBinding.ts` currentClient) — a loud
    // 503 here, never a hang.
    if (!clientPromise) return refusal("padi is not connected", 503);
    // Both the client AWAIT and the repoRoot resolve stay in ONE attempted effect so
    // a client-promise rejection (a fresh spawn that fails its handshake) maps to the
    // same 503 link-fault, not an uncaught 500.
    const resolved = yield* Effect.result(
      Effect.gen(function* () {
        // The client promise is `@kolu/surface-remote`'s (the session layer this
        // campaign records as its residual), so it is LIFTED; the member call itself
        // is an Effect and composes.
        const client = yield* Effect.tryPromise({
          try: () => clientPromise,
          catch: (err) => err,
        });
        const { repoRoot } = yield* client.surface.preview.repoRootForTerminal({
          terminalId,
        });
        return { client, repoRoot };
      }),
    );
    if (Result.isFailure(resolved)) {
      // padi's `repoRootForTerminal` returns `{ repoRoot: null }` for an
      // unknown/unmapped terminal — it never FAILS for the no-repo case (that is
      // the `if (!repoRoot)` 404 below). So a failure here is an OPERATIONAL
      // failure of the bound link (the client promise rejected, padi went down
      // mid-read, a protocol error, an unexpected handler fault), NOT "no repo".
      // Surface it as a 503 so the real fault is visible instead of masqueraded as an
      // ordinary missing-file 404.
      log.error(
        { err: resolved.failure, terminalId },
        "padi repoRoot resolve failed (link fault)",
      );
      return refusal("padi link fault resolving terminal repo", 503);
    }
    const { client, repoRoot } = resolved.success;
    if (!repoRoot) return refusal("terminal has no repo", 404);
    // Bind to a const so the non-null narrowing survives into the remote closure.
    const repoPath = repoRoot;

    const range = request.headers.range;
    // `If-Range` guards a `<video>` seek against the file changing mid-session: both
    // arms honor the `Range` only while this validator still matches the file's
    // current ETag (RFC 9110 §13.1.3), else serve the full 200.
    const ifRange = request.headers["if-range"];
    // The byte read forks on the SELECTED host — but the file tail + repoRoot (and
    // their `..`/`%2f` defenses above) are identical for both arms, so a remote path
    // never reaches a local read, and vice versa.
    //   - REMOTE host: the file lives on the ssh HOST, so dial that host's padi
    //     `preview.read` in bounded chunks (`assembleRemotePreview`) — the RIGHT
    //     host's bytes, streamed back with an O(chunk) heap on both hops. padi
    //     re-enforces its realpath/403 guard host-side inside the read.
    //   - LOCAL default (`host.kind === "local"`): read THIS machine's disk directly via
    //     the shared streaming `previewFile` (the same underlying serve-dir read padi
    //     serves) — no hop, no base64 round trip, byte-identical to before.
    // Both return serve-dir's `ServeResult` shape; the artifact-sdk HTML decorator
    // the caller wraps this handler in rewrites text/html downstream in either case.
    if (host.kind !== "local") {
      // The remote arm's METADATA dials (the 1-byte probe + any re-dial) run inside
      // this attempt; a link fault there maps to the SAME logged 503 as the repoRoot
      // resolve above. The streaming body's per-chunk dials run LATER, when the
      // response is written, so a fault there can't reach THIS catch — but it is NOT
      // swallowed: for a binary preview the stream goes straight to the socket and
      // the fault resets the connection (loud at the transport); for a `text/html`
      // preview the artifact-sdk decorator drains the body, so the fault surfaces
      // there and is caught by `routeErrorLogging` (a LOGGED 500). Either way loud,
      // never a silent short body.
      const remote = yield* Effect.result(
        assembleRemotePreview(
          // The reader is built by `remotePreviewReader` rather than spelled
          // inline — it owns the one `optionalKey` discipline this dial needs
          // (#17), pinned beside the type it satisfies.
          remotePreviewReader(
            (input) => client.surface.preview.read(input),
            repoPath,
            rawTail,
          ),
          range,
          ifRange,
        ),
      );
      if (Result.isFailure(remote)) {
        log.error(
          { err: remote.failure, terminalId },
          "padi preview read failed (link fault)",
        );
        return refusal("padi link fault serving preview", 503);
      }
      return serveResultResponse(remote.success);
    }
    return serveResultResponse(
      yield* previewFile({ repoPath, filePath: rawTail, range, ifRange }),
    );
  });
