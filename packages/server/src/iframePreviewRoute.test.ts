/** Tests for kolu's preview-serving glue (`iframePreviewRoute.ts`) — the
 *  kolu-specific contracts the agnostic `@kolu/serve-dir` package can't own:
 *    1. kolu's `BINARY_PREVIEWABLE_EXTENSIONS` classifier is fully covered by
 *       serve-dir's Content-Type map (and the per-family MIME invariants the
 *       client's `<video>`/`<img>` dispatch relies on);
 *    2. the pure web-shell URL helper (`previewTailFromRawUrl`) hands padi's
 *       `previewFile` a correct, un-normalized file tail — including end-to-end
 *       through the SHIPPED route on a real node server, where the RAW request
 *       target must survive to the guard.
 *  The realpath/symlink-escape 403 coverage now lives against padi's
 *  `readPreview` (`packages/padi/src/preview.test.ts`), since the guard moved
 *  there when the route was re-backed onto that read. */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { NodeHttpServer } from "@effect/platform-node";
import { padiClientOver } from "@kolu/padi-client/dial";
import { contentTypeForPath, serveFile } from "@kolu/serve-dir";
import type { RemotePool } from "@kolu/surface-remote";
import { Effect, Exit, Scope, Stream } from "effect";
import { HttpRouter } from "effect/unstable/http";
import {
  BINARY_PREVIEWABLE_EXTENSIONS,
  buildTerminalFileUrl,
  PDF_PREVIEWABLE_EXTENSIONS,
  RASTER_IMAGE_EXTENSIONS,
  SANDBOX_PREVIEWABLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "kolu-common/preview";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assembleRemotePreview,
  PREVIEW_ROUTE_PATTERN,
  type PreviewHostPool,
  type PreviewPadiClient,
  type PreviewRangeReader,
  type PreviewReadResult,
  previewRouteHandler,
  previewTailFromRawUrl,
  REMOTE_PREVIEW_CHUNK_BYTES,
  remotePreviewReader,
} from "./iframePreviewRoute.ts";
import type { PadiSession } from "./padi/padiSession.ts";

describe("@kolu/serve-dir Content-Type covers kolu's binary-previewable classifier", () => {
  // If any previewable extension lacked a real type, serve-dir would serve it as
  // `application/octet-stream` and the browser would download instead of render.
  it.each(
    BINARY_PREVIEWABLE_EXTENSIONS,
  )("%s has a non-octet Content-Type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).not.toBe(
      "application/octet-stream",
    );
  });

  // Beyond "non-octet", assert the MIME FAMILY per classifier bucket: the client
  // dispatches `VIDEO_EXTENSIONS` into a `<video>` element and
  // `RASTER_IMAGE_EXTENSIONS` into an `<img>`, so a video extension typo'd to
  // `image/*` (or vice versa) would pass the non-octet check yet break playback.
  it.each(VIDEO_EXTENSIONS)("%s maps to a video/* type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).toMatch(/^video\//);
  });

  it.each(RASTER_IMAGE_EXTENSIONS)("%s maps to an image/* type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).toMatch(/^image\//);
  });

  it.each(PDF_PREVIEWABLE_EXTENSIONS)("%s maps to application/pdf", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).toBe("application/pdf");
  });

  // Sandbox-previewable kinds (.html/.htm/.svg) span families (text/html,
  // image/svg+xml), so the non-octet check is the right invariant for that bucket.
  it.each(
    SANDBOX_PREVIEWABLE_EXTENSIONS,
  )("%s has a non-octet Content-Type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).not.toBe(
      "application/octet-stream",
    );
  });
});

describe("assembleRemotePreview — the remote-bind chunked range-loop", () => {
  // The remote arm of the preview route (index.ts) no longer 501s: bound to a
  // remote padi, it serves the RIGHT host's bytes by dialing `preview.read` in
  // bounded chunks and reassembling them into serve-dir's `ServeResult` shape. The
  // dial is base64-wire ({status, headers, bodyBase64}); production wires it to the
  // bound client, so here we wire it to a FAKE reader that runs the SAME serve-dir
  // engine (`serveFile`) over a temp-dir fixture and base64s the body — exactly what
  // padi's `readPreview` does. Testing the loop against real serve-dir semantics
  // (real 200/206/416/404, real headers, real ranges) means these tests can't drift
  // from the byte read they mimic.

  let tmpRoot: string;
  const HELLO = "hello world"; // 11 bytes, text/plain
  // 300 bytes spanning every byte value (incl. high/non-UTF8), so a base64
  // corruption would show — the binary round-trip fixture.
  const BLOB = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256));

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-remote-preview-"));
    fs.writeFileSync(path.join(tmpRoot, "hello.txt"), HELLO);
    fs.writeFileSync(path.join(tmpRoot, "empty.txt"), "");
    fs.writeFileSync(path.join(tmpRoot, "blob.png"), BLOB);
  });
  afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  /** A faithful `preview.read` stand-in: the REAL serve-dir read, body base64'd
   *  for the wire (byte-for-byte what padi's `readPreview` returns). */
  function serveDirReader(name: string): PreviewRangeReader {
    return (range) =>
      Effect.flatMap(serveFile(tmpRoot, name, range ?? null), (r) =>
        Effect.promise(async () => {
          const bodyBase64 =
            typeof r.body === "string"
              ? Buffer.from(r.body, "utf8").toString("base64")
              : Buffer.from(await new Response(r.body).arrayBuffer()).toString(
                  "base64",
                );
          return { status: r.status, headers: r.headers, bodyBase64 };
        }),
      );
  }

  /** Wrap a reader to RECORD the exact `Range` header of every dial (probe + each
   *  chunk), so a boundary test can assert the loop's stepping. */
  function recording(inner: PreviewRangeReader): {
    read: PreviewRangeReader;
    ranges: (string | undefined)[];
  } {
    const ranges: (string | undefined)[] = [];
    return {
      ranges,
      read: (range) => {
        ranges.push(range);
        return inner(range);
      },
    };
  }

  /** Drain a `ServeResult` body to a Buffer (a string body is an error reason). */
  async function drain(body: ReadableStream | string): Promise<Buffer> {
    if (typeof body === "string") return Buffer.from(body, "utf8");
    return Buffer.from(await new Response(body).arrayBuffer());
  }

  function headerCI(
    headers: Record<string, string>,
    name: string,
  ): string | undefined {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers))
      if (k.toLowerCase() === lower) return v;
    return undefined;
  }

  /** `assembleRemotePreview` is an Effect now; a test IS a process edge. */
  const runPreview = (...args: Parameters<typeof assembleRemotePreview>) =>
    Effect.runPromise(assembleRemotePreview(...args));

  it("serves a whole file (no Range) as a 200 with the real Content-Type and exact bytes", async () => {
    const r = await runPreview(serveDirReader("hello.txt"), undefined);
    expect(r.status).toBe(200);
    expect(headerCI(r.headers, "content-type")).toMatch(/^text\/plain/);
    // A full 200 carries NO Content-Length (parity with the local streaming read).
    expect(headerCI(r.headers, "content-length")).toBeUndefined();
    expect((await drain(r.body)).toString("utf8")).toBe(HELLO);
  });

  it("round-trips BINARY bytes exactly across multiple chunks (no base64 corruption)", async () => {
    // 300-byte blob, 128-byte chunk → 3 dials (128 + 128 + 44). Bytes must match
    // the fixture exactly — a high-byte corruption on the base64 wire would show.
    const r = await runPreview(
      serveDirReader("blob.png"),
      undefined,
      undefined,
      128,
    );
    expect(r.status).toBe(200);
    expect(headerCI(r.headers, "content-type")).toBe("image/png");
    const body = await drain(r.body);
    expect(body.byteLength).toBe(BLOB.byteLength);
    expect(Buffer.compare(body, BLOB)).toBe(0);
  });

  it("drives bounded chunk ranges at exact boundaries incl. a partial last chunk", async () => {
    // 300 bytes, chunk 128: the loop must request bytes=0-127, 128-255, 256-299 —
    // the last a partial (44 bytes) — after the 1-byte probe. No dial exceeds the
    // chunk bound; none reads past EOF.
    const rec = recording(serveDirReader("blob.png"));
    const r = await runPreview(rec.read, undefined, undefined, 128);
    await drain(r.body); // pull the whole stream so every chunk dial fires
    expect(rec.ranges).toEqual([
      "bytes=0-0", // metadata probe
      "bytes=0-127",
      "bytes=128-255",
      "bytes=256-299",
    ]);
  });

  it("serves a satisfiable Range as a 206 with Content-Range + Content-Length", async () => {
    const r = await runPreview(serveDirReader("hello.txt"), "bytes=0-4");
    expect(r.status).toBe(206);
    expect(headerCI(r.headers, "content-range")).toBe("bytes 0-4/11");
    expect(headerCI(r.headers, "content-length")).toBe("5");
    expect((await drain(r.body)).toString("utf8")).toBe("hello");
  });

  it("resolves a suffix range via serve-dir's own parser (bytes=-5 → last 5 bytes)", async () => {
    // Proves the loop reuses `@kolu/serve-dir`'s `parseByteRange`, not a re-derived
    // one: `bytes=-5` on 11 bytes resolves to 6-10.
    const r = await runPreview(serveDirReader("hello.txt"), "bytes=-5");
    expect(r.status).toBe(206);
    expect(headerCI(r.headers, "content-range")).toBe("bytes 6-10/11");
    expect((await drain(r.body)).toString("utf8")).toBe("world");
  });

  it("416s an unsatisfiable Range on a non-empty file", async () => {
    const r = await runPreview(serveDirReader("hello.txt"), "bytes=100-200");
    expect(r.status).toBe(416);
    expect(headerCI(r.headers, "content-range")).toBe("bytes */11");
  });

  it("honors a matching If-Range (206) and collapses a STALE If-Range to a full 200", async () => {
    // RFC 9110 §13.1.3, remote arm: the Range is honored only while the client's
    // validator still matches the file's current ETag; a stale one serves the full
    // 200 rather than a 206 the client would stitch onto changed bytes.
    const reader = serveDirReader("blob.png");
    const probe = await Effect.runPromise(reader("bytes=0-0"));
    const etag = headerCI(probe.headers, "etag");
    expect(etag).toBeDefined();
    // Matching If-Range → the Range is honored (206 slice).
    const match = await runPreview(reader, "bytes=0-63", etag);
    expect(match.status).toBe(206);
    expect(headerCI(match.headers, "content-range")).toBe("bytes 0-63/300");
    // Stale If-Range → the Range is ignored → full 200 with the whole file.
    const stale = await runPreview(reader, "bytes=0-63", '"stale-nomatch"');
    expect(stale.status).toBe(200);
    expect(headerCI(stale.headers, "content-range")).toBeUndefined();
    expect((await drain(stale.body)).byteLength).toBe(300);
  });

  it("serves a ZERO-length file (no Range) as a 200 with an empty body", async () => {
    const r = await runPreview(serveDirReader("empty.txt"), undefined);
    expect(r.status).toBe(200);
    expect(headerCI(r.headers, "content-type")).toMatch(/^text\/plain/);
    expect((await drain(r.body)).byteLength).toBe(0);
  });

  it("416s a Range against a ZERO-length file (bytes */0)", async () => {
    const r = await runPreview(serveDirReader("empty.txt"), "bytes=0-100");
    expect(r.status).toBe(416);
    expect(headerCI(r.headers, "content-range")).toBe("bytes */0");
  });

  it("propagates a missing-file error status verbatim (404, not a masked 200)", async () => {
    const r = await runPreview(serveDirReader("nope.txt"), undefined);
    expect(r.status).toBe(404);
    // The error body is the decoded plain-text reason, never streamed bytes.
    expect(typeof r.body).toBe("string");
  });

  it("FAILS LOUDLY when a chunk mid-stream returns the wrong status — never a silent truncation", async () => {
    // The probe + first chunk succeed; the SECOND chunk dial returns a 500. The
    // assembled stream must ERROR (reject on drain), not close early with a body
    // missing its tail.
    const inner = serveDirReader("blob.png");
    let chunkDials = 0;
    const faulty: PreviewRangeReader = (range) =>
      Effect.suspend(() => {
        // Count only the body-chunk dials (a real range with a non-zero end), not the
        // `bytes=0-0` probe.
        if (range && range !== "bytes=0-0") {
          chunkDials += 1;
          if (chunkDials === 2)
            return Effect.succeed({ status: 500, headers: {}, bodyBase64: "" });
        }
        return inner(range);
      });
    const r = await runPreview(faulty, undefined, undefined, 128);
    expect(r.status).toBe(200); // headers committed before the fault
    await expect(drain(r.body)).rejects.toThrow(/expected 206, got 500/);
  });

  it("FAILS LOUDLY when a chunk returns a short body — never a silent truncation", async () => {
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) =>
        // Corrupt the first BODY chunk to one byte short of what its Content-Range
        // promises. The length check must reject rather than emit a truncated body.
        range === "bytes=0-127"
          ? { ...r, bodyBase64: r.bodyBase64.slice(0, 8) }
          : r,
      );
    const r = await runPreview(faulty, undefined, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/expected 128 bytes/);
  });

  it("FAILS LOUDLY when the file size changes mid-stream — refuses an inconsistent body", async () => {
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) =>
        // Rewrite the SECOND chunk's Content-Range total to a different size, as if
        // the file were replaced under the loop.
        range === "bytes=128-255"
          ? {
              ...r,
              headers: { ...r.headers, "Content-Range": "bytes 128-255/999" },
            }
          : r,
      );
    const r = await runPreview(faulty, undefined, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/size changed mid-stream/);
  });

  it("FAILS LOUDLY when the file is REPLACED by a same-size file mid-stream — the validator catches what the size check can't", async () => {
    // The subtle case the total-size check alone MISSES: the file is atomically
    // replaced between chunks by a DIFFERENT file of the SAME byte length. Every
    // per-chunk length/total/offset check still passes, so without the strong
    // `ETag` validator the stream would silently mix two files' bytes. serve-dir's
    // validator changes on any replace (mtime + inode), so mutating it here mimics
    // that swap — the loop must refuse rather than emit a Frankenstein body.
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) =>
        range === "bytes=128-255"
          ? { ...r, headers: { ...r.headers, ETag: '"deadbeef-swap"' } }
          : r,
      );
    const r = await runPreview(faulty, undefined, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/validator/);
  });

  it("FAILS LOUDLY when a 206 probe carries NO ETag — the snapshot guard can't be silently defeated", async () => {
    // The probe's ETag is what pins the file SNAPSHOT across every chunk. This
    // exercises the probe presence-check in ISOLATION: if serve-dir ever stopped
    // emitting an ETag, the per-chunk `chunkETag !== etag` guard would collapse to
    // `undefined !== undefined` (false) and silently accept a mixed body. The probe
    // MUST reject a 206 with no validator up front rather than stream unguarded — so
    // deleting that check fails THIS test (not just the same-size-replace one, which
    // an ETag-less serve-dir would also stop catching).
    const inner = serveDirReader("blob.png");
    const noEtag: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.headers))
          if (k.toLowerCase() !== "etag") headers[k] = v;
        return { ...r, headers };
      });
    await expect(runPreview(noEtag, undefined)).rejects.toThrow(
      /no ETag validator/,
    );
  });

  it("FAILS LOUDLY when a chunk answers the WRONG slice at the right length — refuses a mismatched body", async () => {
    // A broken upstream returns the correct byte COUNT from the wrong OFFSET:
    // `bytes 0-127` when the loop asked for `bytes=128-255` (same length, same
    // total). Parsing only `/total` would accept it and emit the wrong slice; the
    // full Content-Range check rejects the offset mismatch.
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) =>
        range === "bytes=128-255"
          ? {
              ...r,
              headers: { ...r.headers, "Content-Range": "bytes 0-127/300" },
            }
          : r,
      );
    const r = await runPreview(faulty, undefined, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/wrong slice/);
  });

  it("FAILS LOUDLY when the metadata probe returns an unexpected 200 — never a UTF-8-mangled binary body under a success status", async () => {
    // A ranged `bytes=0-0` probe can only be 206/416/4xx/5xx; a 200 is a broken
    // upstream. The old code wrapped it via `errorResult` (a UTF-8 decode) and
    // served it as a success — corrupting binary. It must now throw instead.
    const faulty: PreviewRangeReader = (range) =>
      Effect.suspend(() =>
        range === "bytes=0-0"
          ? Effect.succeed({ status: 200, headers: {}, bodyBase64: "" })
          : serveDirReader("blob.png")(range),
      );
    await expect(runPreview(faulty, undefined)).rejects.toThrow(
      /unexpected status 200/,
    );
  });

  it("propagates a probe-phase reader rejection (so the route maps a link fault to a logged 503, not a silent 500)", async () => {
    // The metadata dials (probe + any re-dial) run synchronously inside the
    // `assembleRemotePreview` await; if the bound link drops, `read` REJECTS. The
    // rejection must propagate out of `assembleRemotePreview` unchanged so the route
    // can catch it and answer a logged 503 — not swallow it into a body or a 500.
    const linkFault = new Error("ssh link dropped mid-probe");
    const read: PreviewRangeReader = () => Effect.fail(linkFault);
    await expect(runPreview(read, undefined)).rejects.toBe(linkFault);
  });

  it("uses an 8 MiB production chunk bound", () => {
    // Guards the documented memory story: the default per-dial bound is 8 MiB,
    // comfortably under readPreview's 64 MiB inline cap.
    expect(REMOTE_PREVIEW_CHUNK_BYTES).toBe(8 * 1024 * 1024);
  });
});

// Success bodies come back as a `ReadableStream` (bytes flow from a bounded file
// handle straight to the socket); read it as text.
async function readServeBody(body: string | ReadableStream): Promise<string> {
  if (typeof body === "string") return body;
  return new Response(body).text();
}

describe("previewTailFromRawUrl (the tail extraction index.ts feeds serve-dir)", () => {
  const host = "local";
  const terminalId = "abc";

  it("round-trips a filename with a literal % through encode → extract → serve-dir decode", async () => {
    // The bug class: a real file `100% done.mp4` is built as
    // `100%25%20done.mp4`. Decoding the tail once before serve-dir (as
    // `c.req.path`'s `decodeURI` would) yields `100% done.mp4`, and serve-dir's
    // `decodeURIComponent` then throws on the bare `% ` → a spurious 400. The raw
    // tail keeps it encoded so serve-dir's single decode recovers the real name.
    const filePath = "100% done.mp4";
    const url = `http://host${buildTerminalFileUrl(host, terminalId, filePath)}`;
    const tail = previewTailFromRawUrl(url, host, terminalId);
    expect(tail).toBe("100%25%20done.mp4");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, filePath), "video-bytes");
      const res = await Effect.runPromise(serveFile(tmpRoot, tail));
      expect(res.status).toBe(200);
      expect(await readServeBody(res.body)).toBe("video-bytes");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("preserves segment boundaries so an encoded %2f traversal is rejected", async () => {
    // An attacker sends a literal `%2f` to smuggle a `/` past the per-segment
    // `..` check. The raw tail keeps `%2f` encoded; serve-dir decodes it to `/`,
    // splits, and the per-segment check rejects the `..` → 400 (not a traversal).
    const url = `http://host/api/terminals/${host}/${terminalId}/file/foo%2f..%2fpasswd`;
    const tail = previewTailFromRawUrl(url, host, terminalId);
    expect(tail).toBe("foo%2f..%2fpasswd");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      const res = await Effect.runPromise(serveFile(tmpRoot, tail));
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps a literal `..` dot segment intact (no URL normalization)", async () => {
    // `new URL(rawUrl).pathname` would collapse `foo/../secret.html` to
    // `secret.html` BEFORE the slice, so serve-dir would never see the `..` and
    // would serve the sibling. Slicing the raw string keeps the `..` segment so
    // serve-dir's per-segment check rejects it with 400.
    const url = `http://host/api/terminals/${host}/${terminalId}/file/foo/../secret.html`;
    const tail = previewTailFromRawUrl(url, host, terminalId);
    expect(tail).toBe("foo/../secret.html");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");
      const res = await Effect.runPromise(serveFile(tmpRoot, tail));
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps an encoded `%2e%2e` dot segment intact (no URL normalization)", async () => {
    // WHATWG normalization also decodes-then-collapses `%2e%2e` → `..`. Slicing
    // the raw string leaves it encoded for serve-dir's single decode, which then
    // produces a `..` segment the per-segment check rejects with 400.
    const url = `http://host/api/terminals/${host}/${terminalId}/file/foo/%2e%2e/secret.html`;
    const tail = previewTailFromRawUrl(url, host, terminalId);
    expect(tail).toBe("foo/%2e%2e/secret.html");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");
      const res = await Effect.runPromise(serveFile(tmpRoot, tail));
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("extracts the tail from an origin-form URL (path only, no authority)", () => {
    // Node may hand the handler an origin-form target (`/path?query`); the raw
    // slicer must handle it as well as absolute-form.
    expect(
      previewTailFromRawUrl(
        `/api/terminals/${host}/${terminalId}/file/clip.mp4?v=123`,
        host,
        terminalId,
      ),
    ).toBe("clip.mp4");
  });

  it("returns empty for a URL that doesn't match the prefix", () => {
    expect(
      previewTailFromRawUrl("http://host/other/path", host, terminalId),
    ).toBe("");
  });
});

// The unit tests above feed `previewTailFromRawUrl` a literal raw string, but
// production hands it `HttpServerRequest.url` off a real node request. This suite
// boots the SHIPPED handler behind a real `http.Server` through the same
// `NodeHttpServer.makeHandler` seam kolu-server's boot uses, and drives it with
// VERBATIM request targets — so "`HttpServerRequest.url` is the raw,
// un-normalized `IncomingMessage.url`" is proven here, not assumed.
//
// It is also the tripwire for the one banned shortcut: `HttpRouter.toWebHandler`
// builds a Web `Request`, which WHATWG-normalizes `..` / `%2e%2e` BEFORE the
// handler runs and would silently serve the sibling file. If this route is ever
// reached through a web handler, the two 400 tests below go green-to-200.
describe("iframe-preview route over a real node server (the raw target survives)", () => {
  const host = "local";
  const terminalId = "abc";
  let tmpRoot: string;
  let server: http.Server;
  let handlerScope: Scope.Closeable;
  let baseUrl: string;

  /** The bound-padi client the route dials. `preview.read` is the REMOTE arm's
   *  dial: a `host = "local"` request must take the in-process `previewFile` arm,
   *  so reaching it here is a failure, not a fallback. */
  const client: PreviewPadiClient = {
    surface: {
      preview: {
        repoRootForTerminal: () => Effect.succeed({ repoRoot: tmpRoot }),
        read: () =>
          Effect.fail(new Error("the local arm must never dial preview.read")),
      },
    },
  };
  const pool: PreviewHostPool = {
    getSession: (encoded) =>
      encoded === "local"
        ? { currentClient: () => Promise.resolve(client) }
        : undefined,
  };

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-route-int-"));
    fs.writeFileSync(path.join(tmpRoot, "clip.mp4"), "video-bytes");
    fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");

    handlerScope = await Effect.runPromise(Scope.make());
    const handler = await Effect.runPromise(
      Effect.gen(function* () {
        const httpEffect = yield* HttpRouter.toHttpEffect(
          HttpRouter.add(
            "GET",
            PREVIEW_ROUTE_PATTERN,
            previewRouteHandler({ pool, log: { error: () => {} } }),
          ),
        );
        return yield* NodeHttpServer.makeHandler(httpEffect, {
          scope: handlerScope,
        });
      }).pipe(Scope.provide(handlerScope)),
    );

    server = http.createServer();
    server.on("request", handler);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected a TCP address from the test server");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Effect.runPromise(Scope.close(handlerScope, Exit.void));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // Issue a raw GET with a verbatim request target (no `new URL` normalization
  // on our side) so the dot segment reaches the server exactly as sent.
  function rawGet(target: string): Promise<{ status: number; body: string }> {
    const { port, hostname } = new URL(baseUrl);
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: hostname, port: Number(port), method: "GET", path: target },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  // Every test here drives a FAKE pool, so the seam could drift from what the
  // composition root actually passes without a single test noticing. This is the
  // compile-time pin that stops it: the REAL `RemotePool<PadiSession, …>` must be
  // assignable to the narrow structural seam.
  it("the narrow seam accepts the REAL pool the composition root passes", () => {
    const asSeam = (p: RemotePool<PadiSession, undefined>): PreviewHostPool =>
      p;
    expect(typeof asSeam).toBe("function");
  });

  it("serves an in-root file (sanity: the route is wired)", async () => {
    const res = await rawGet(
      `/api/terminals/${host}/${terminalId}/file/clip.mp4?v=1`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe("video-bytes");
  });

  it("400s a literal `..` dot segment instead of serving the sibling", async () => {
    const res = await rawGet(
      `/api/terminals/${host}/${terminalId}/file/foo/../secret.html`,
    );
    expect(res.status).toBe(400);
    expect(res.body).not.toContain("SECRET");
  });

  it("400s an encoded `%2e%2e` dot segment instead of serving the sibling", async () => {
    const res = await rawGet(
      `/api/terminals/${host}/${terminalId}/file/foo/%2e%2e/secret.html`,
    );
    expect(res.status).toBe(400);
    expect(res.body).not.toContain("SECRET");
  });

  it("400s a host segment that is not a canonical host key", async () => {
    const res = await rawGet(
      `/api/terminals/not-a-key/${terminalId}/file/clip.mp4`,
    );
    expect(res.status).toBe(400);
    expect(res.body).toBe("invalid host key");
  });

  // A key that decodes but is not a current pool member is a loud 404 — never a
  // silent fall-through to the default host's bytes.
  it("404s a canonical host key that is not a pool member", async () => {
    const res = await rawGet(
      `/api/terminals/remote%3Abox/${terminalId}/file/clip.mp4`,
    );
    expect(res.status).toBe(404);
    expect(res.body).toBe('unknown host "remote:box"');
  });

  it("serves a filename carrying a literal % through the whole route", async () => {
    fs.writeFileSync(path.join(tmpRoot, "100% done.mp4"), "pct-bytes");
    const res = await rawGet(
      buildTerminalFileUrl(host, terminalId, "100% done.mp4"),
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe("pct-bytes");
  });
});

describe("remotePreviewReader — the UNRANGED dial must stay key-absent (#17)", () => {
  // `range` is `Schema.optionalKey` on padi's wire, and the client face DECODES
  // every procedure input at the call site — so the shape this reader builds is
  // judged inside kolu-server, before anything reaches padi. An `optionalKey`
  // rejects a present-`undefined` key where zod's `.optional()` took either, and
  // an unranged dial is ORDINARY here (the empty-file Content-Type re-read; any
  // browser request with no `Range` header). Falsify by restoring `range: range`
  // in `remotePreviewReader`: the first two cases then throw the production
  // string, `Expected string, got undefined`.

  /** The REAL padi client face over a recording dispatch — so the assertion runs
   *  behind the same `Schema.decodeUnknownSync` production does, not a paraphrase. */
  function recordingPadi(): {
    read: (input: {
      repoPath: string;
      filePath: string;
      range?: string;
    }) => Effect.Effect<PreviewReadResult, unknown>;
    inputs: unknown[];
  } {
    const inputs: unknown[] = [];
    const client = padiClientOver({
      unary: (_tag, payload) => {
        inputs.push(payload);
        return Effect.succeed({ status: 200, headers: {}, bodyBase64: "" });
      },
      stream: () => Stream.empty,
    });
    return { inputs, read: (input) => client.padi.surface.preview.read(input) };
  }

  it("OMITS the key on an unranged dial", async () => {
    const { read, inputs } = recordingPadi();
    await Effect.runPromise(
      remotePreviewReader(read, "/repo", "a.ts")(undefined),
    );
    expect(inputs.at(-1)).toEqual({ repoPath: "/repo", filePath: "a.ts" });
    expect(Object.hasOwn(inputs.at(-1) as object, "range")).toBe(false);
  });

  it("OMITS the key for the empty-file re-read the assembler performs", async () => {
    // `assembleRemotePreview` probes with `bytes=0-0`, sees a 0-byte file, then
    // re-dials UNRANGED for the real Content-Type — the exact sequence that broke.
    const { read, inputs } = recordingPadi();
    const reader = remotePreviewReader(read, "/repo", "empty.txt");
    await Effect.runPromise(reader("bytes=0-0"));
    await Effect.runPromise(reader(undefined));
    expect(inputs.map((i) => (i as { range?: string }).range)).toEqual([
      "bytes=0-0",
      undefined,
    ]);
    expect(Object.hasOwn(inputs[1] as object, "range")).toBe(false);
  });

  it("still sends a real Range verbatim", async () => {
    const { read, inputs } = recordingPadi();
    await Effect.runPromise(
      remotePreviewReader(read, "/repo", "blob.png")("bytes=0-127"),
    );
    expect(inputs.at(-1)).toEqual({
      repoPath: "/repo",
      filePath: "blob.png",
      range: "bytes=0-127",
    });
  });
});
