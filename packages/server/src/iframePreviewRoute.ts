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
  Headers,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
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

export function previewTailFromRawUrl(
  rawUrl: string,
  host: string,
  terminalId: string,
): string {
  const prefix = `${TERMINAL_FILE_ROUTE_BASE}/${encodeURIComponent(host)}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/`;
  const pathname = rawPathname(rawUrl);
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
}

export const REMOTE_PREVIEW_CHUNK_BYTES = 8 * 1024 * 1024;

const PREVIEW_PROBE_RANGE = "bytes=0-0";

export type PreviewReadResult = typeof PadiPreviewReadOutputSchema.Type;

export type PreviewRangeReader = (
  range: string | undefined,
) => Effect.Effect<PreviewReadResult, unknown>;

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

function isServeDirErrorStatus(status: number): boolean {
  return status === 400 || status === 403 || status === 404 || status === 500;
}

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

function plainTextReasonResult(r: PreviewReadResult): ServeResult {
  return {
    status: r.status,
    headers: r.headers,
    body: Buffer.from(r.bodyBase64, "base64").toString("utf8"),
  };
}

function emptyStream(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

interface ChunkWindow {
  pos: number;
  end: number;
}

interface ReadSnapshot {
  total: number;
  etag: string;
}

function assertChunkMatchesSnapshot(
  window: ChunkWindow,
  snapshot: ReadSnapshot,
  chunk: PreviewReadResult,
): Buffer {
  const { pos, end } = window;
  if (chunk.status !== 206)
    throw new Error(
      `remote preview chunk bytes=${pos}-${end}: expected 206, got ${chunk.status} — refusing a truncated body`,
    );
  const cr = parseContentRange(chunk.headers);
  if (cr.total !== snapshot.total)
    throw new Error(
      `remote preview: file size changed mid-stream (${snapshot.total} → ${cr.total}) — refusing an inconsistent body`,
    );
  if (cr.start !== pos || cr.end !== end)
    throw new Error(
      `remote preview chunk bytes=${pos}-${end}: server answered the wrong slice (bytes ${cr.start}-${cr.end}) — refusing a mismatched body`,
    );
  const chunkETag = getHeaderCI(chunk.headers, "etag");
  if (chunkETag !== snapshot.etag)
    throw new Error(
      `remote preview: file changed mid-stream (validator ${snapshot.etag} → ${chunkETag ?? "<none>"}) — refusing an inconsistent body`,
    );
  const buf = Buffer.from(chunk.bodyBase64, "base64");
  const want = end - pos + 1;
  if (buf.byteLength !== want)
    throw new Error(
      `remote preview chunk bytes=${pos}-${end}: expected ${want} bytes, got ${buf.byteLength} — refusing a truncated body`,
    );
  return buf;
}

function streamByteRange(
  read: PreviewRangeReader,
  lo: number,
  hi: number,
  snapshot: ReadSnapshot,
  chunkBytes: number,
): ReadableStream {
  const windows: ChunkWindow[] = [];
  for (let pos = lo; pos <= hi; pos += chunkBytes) {
    windows.push({ pos, end: Math.min(pos + chunkBytes - 1, hi) });
  }
  return Stream.toReadableStream(
    Stream.mapEffect(Stream.fromArray(windows), (window) =>
      Effect.map(read(`bytes=${window.pos}-${window.end}`), (chunk) =>
        assertChunkMatchesSnapshot(window, snapshot, chunk),
      ),
    ),
  ) as ReadableStream;
}

export function assembleRemotePreview(
  read: PreviewRangeReader,
  browserRange: string | undefined,
  ifRange?: string,
  chunkBytes: number = REMOTE_PREVIEW_CHUNK_BYTES,
): Effect.Effect<ServeResult, unknown> {
  return Effect.gen(function* () {
    const probe = yield* read(PREVIEW_PROBE_RANGE);

    if (probe.status !== 206 && probe.status !== 416) {
      if (isServeDirErrorStatus(probe.status))
        return plainTextReasonResult(probe);
      throw new Error(
        `remote preview: probe ${PREVIEW_PROBE_RANGE} returned unexpected status ${probe.status} — refusing to serve`,
      );
    }

    if (probe.status === 416) {
      const rangeSent = parseByteRange(browserRange, 0) === "invalid";
      if (rangeSent && ifRange === undefined)
        return plainTextReasonResult(probe);
      const empty = yield* read(undefined);
      if (empty.status !== 200) {
        if (isServeDirErrorStatus(empty.status))
          return plainTextReasonResult(empty);
        throw new Error(
          `remote preview: unranged empty-file re-read returned unexpected status ${empty.status} — refusing to serve`,
        );
      }
      if (Buffer.from(empty.bodyBase64, "base64").byteLength !== 0)
        throw new Error(
          "remote preview: file became non-empty between the empty-file probe and its re-read — refusing an inconsistent body",
        );
      if (rangeSent) {
        const emptyEtag = getHeaderCI(empty.headers, "etag");
        if (emptyEtag !== undefined && ifRange?.trim() === emptyEtag)
          return plainTextReasonResult(probe);
      }
      return { status: 200, headers: empty.headers, body: emptyStream() };
    }

    const { total } = parseContentRange(probe.headers);
    const etag = getHeaderCI(probe.headers, "etag");
    if (etag === undefined)
      throw new Error(
        "remote preview: a 206 probe carried no ETag validator — cannot guarantee a consistent multi-chunk read",
      );
    const baseHeaders = baseHeadersFrom(probe.headers);
    const honorRange = ifRange === undefined || ifRange.trim() === etag;
    const resolved = parseByteRange(
      honorRange ? browserRange : undefined,
      total,
    );

    if (resolved === "invalid") {
      const redial = yield* read(browserRange);
      if (redial.status !== 416)
        throw new Error(
          `remote preview: expected 416 re-dialing unsatisfiable range "${browserRange}", got ${redial.status}`,
        );
      return plainTextReasonResult(redial);
    }

    const [lo, hi] =
      resolved === null ? [0, total - 1] : [resolved.start, resolved.end];
    const { status, headers } = rangeResponseHead(resolved, total, baseHeaders);

    return {
      status,
      headers,
      body: streamByteRange(read, lo, hi, { total, etag }, chunkBytes),
    };
  });
}

export const PREVIEW_ROUTE_PATTERN =
  `${TERMINAL_FILE_ROUTE_BASE}/:host/:terminalId/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/*` as const;

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

export interface PreviewHostSession {
  currentClient(): Promise<PreviewPadiClient> | null;
}

export interface PreviewHostPool {
  getSession(encodedHost: string): PreviewHostSession | undefined;
}

const refusal = (body: string, status: number) =>
  HttpServerResponse.text(body, {
    status,
    contentType: "text/plain; charset=utf-8",
  });

const PREVIEW_CSP = "sandbox allow-scripts";

function confinedHeaders(input: Record<string, string>): Headers.Headers {
  const headers = Headers.fromInput(input);
  return headers["content-type"]?.toLowerCase().startsWith("application/pdf")
    ? Headers.remove(headers, "content-security-policy")
    : Headers.set(headers, "content-security-policy", PREVIEW_CSP);
}

export const serveResultResponse = (
  r: ServeResult,
): HttpServerResponse.HttpServerResponse => {
  const headers = confinedHeaders(r.headers);
  return typeof r.body === "string"
    ? HttpServerResponse.text(r.body, { status: r.status, headers })
    : HttpServerResponse.stream(
        Stream.fromReadableStream({
          evaluate: () => r.body as ReadableStream<Uint8Array>,
          onError: (error) => error,
        }),
        { status: r.status, headers },
      );
};

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
    if (rawHostParam === undefined || terminalId === undefined) {
      return refusal("malformed preview route", 400);
    }

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

    const rawTail = previewTailFromRawUrl(
      request.url,
      rawHostParam,
      terminalId,
    );

    const clientPromise = session.currentClient();
    if (!clientPromise) return refusal("padi is not connected", 503);
    const resolved = yield* Effect.result(
      Effect.gen(function* () {
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
      log.error(
        { err: resolved.failure, terminalId },
        "padi repoRoot resolve failed (link fault)",
      );
      return refusal("padi link fault resolving terminal repo", 503);
    }
    const { client, repoRoot } = resolved.success;
    if (!repoRoot) return refusal("terminal has no repo", 404);
    const repoPath = repoRoot;

    const range = request.headers.range;
    const ifRange = request.headers["if-range"];
    if (host.kind !== "local") {
      const remote = yield* Effect.result(
        assembleRemotePreview(
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
