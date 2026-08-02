/** Kolu glue for the iframe-preview file route
 *  (`FsReadFileOutput.kind === "binary"`). The byte read itself (range,
 *  content-type, lexical + realpath guard) is now padi's `previewFile` — the
 *  STREAMING serve-dir read the Hono route in `index.ts` re-backs onto, so a
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
 *  What also remains here are the two PURE web-shell URL helpers the route needs to
 *  hand a correct, un-normalized file tail to EITHER arm:
 *    - `rawTargetFromContext` selects the RAW request target
 *      (`c.env.incoming.url`), the origin-form URL before WHATWG normalization;
 *    - `previewTailFromRawUrl` slices the terminal-scoped file path out of it,
 *      keeping `%`-encoding intact so serve-dir's single decode recovers the
 *      real name and the per-segment `..`/`%2f` traversal guard still fires.
 *  Both are unit-tested in `iframePreviewRoute.test.ts`; the realpath/symlink
 *  guard's 403 coverage now lives against padi's `previewFile`. */

import type { HttpBindings } from "@hono/node-server";
import {
  getHeaderCI,
  parseByteRange,
  rangeResponseHead,
  rawPathname,
} from "@kolu/serve-dir";
import type { ServeResult } from "@kolu/serve-dir";
import type { PadiPreviewReadOutputSchema } from "@kolu/padi/surface";
import type { Context } from "hono";
import {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";

/** The RAW, un-normalized request target `previewTailFromRawUrl` must slice —
 *  resolved here so the selection lives in ONE place the route and its test both
 *  call. Returns the Node `IncomingMessage.url` (`c.env.incoming.url`), the
 *  origin-form target @hono/node-server receives before any normalization.
 *
 *  Returns `undefined` (a no-match sentinel) when `incoming` is absent. We do
 *  NOT fall back to `c.req.raw.url`: that value is built via `new URL(...).href`
 *  and HAS run WHATWG path normalization (collapsing `foo/../secret`), so it
 *  can't defend the `..` guard this module exists to enforce. Falling back would
 *  fail OPEN — silently serving the exact normalized target the guard rejects.
 *  Kolu's only production adapter is @hono/node-server, which always supplies
 *  `incoming`; the absent case is a fail-closed error the route maps to a 500,
 *  not a quiet downgrade to an unsafe serve.
 *
 *  `c.env` is read as `Partial<HttpBindings>` so this works whether or not the
 *  caller's app typed the node binding into its env. */
export function rawTargetFromContext(c: Context): string | undefined {
  return (c.env as Partial<HttpBindings>).incoming?.url;
}

/** Extract the still-encoded path tail for a terminal's preview route from a
 *  RAW request URL. Slices off `${BASE}/{host}/{terminalId}/${FILE}/`, returning
 *  the remaining percent-encoded segments (or `""` when the URL doesn't match the
 *  prefix — the route registration guarantees it does, but the guard keeps this
 *  pure and total).
 *
 *  `host` is the DECODED route param (`c.req.param("host")`); the client encodes
 *  it with `encodeURIComponent` (see `buildTerminalFileUrl`), so re-encoding it
 *  here reproduces the exact raw segment the pathname carries — the same canonical
 *  round-trip the caller relies on.
 *
 *  The un-normalized pathname comes from serve-dir's `rawPathname`, NOT
 *  `new URL(rawUrl).pathname` / Hono's `c.req.path` / `c.req.param("*")` — see
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
// ≤ `REMOTE_PREVIEW_CHUNK_BYTES`, and pushes them into a `ReadableStream` the Hono
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
) => Promise<PreviewReadResult>;

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
  let pos = lo;
  return new ReadableStream({
    async pull(controller) {
      if (pos > hi) {
        controller.close();
        return;
      }
      const end = Math.min(pos + chunkBytes - 1, hi);
      const chunk = await read(`bytes=${pos}-${end}`);
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
      // still-live view) — so enqueue it directly. A defensive `new Uint8Array(buf)`
      // copy would add a full-chunk memcpy per pull on the hot path (a multi-GB
      // video is hundreds of 8 MiB chunks) for no safety gain.
      controller.enqueue(buf);
      pos = end + 1;
    },
  });
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
export async function assembleRemotePreview(
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
): Promise<ServeResult> {
  // 1. METADATA PROBE — 1 byte learns total size + mime + validator + existence, no
  //    body pull.
  const probe = await read(PREVIEW_PROBE_RANGE);

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
    const empty = await read(undefined);
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
  const resolved = parseByteRange(honorRange ? browserRange : undefined, total);

  if (resolved === "invalid") {
    // Re-dial with the browser's exact range so serve-dir emits its verbatim 416
    // (rather than reconstructing its header shape here). A 416 body is tiny. A
    // status OTHER than 416 here is a broken upstream (the range was unsatisfiable
    // against the probe's total) — fail LOUD.
    const redial = await read(browserRange);
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
}
