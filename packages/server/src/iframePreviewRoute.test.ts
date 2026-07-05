/** Tests for kolu's preview-serving glue (`iframePreviewRoute.ts`) — the
 *  kolu-specific contracts the agnostic `@kolu/serve-dir` package can't own:
 *    1. kolu's `BINARY_PREVIEWABLE_EXTENSIONS` classifier is fully covered by
 *       serve-dir's Content-Type map (and the per-family MIME invariants the
 *       client's `<video>`/`<img>` dispatch relies on);
 *    2. the pure web-shell URL helpers (`previewTailFromRawUrl` /
 *       `rawTargetFromContext`) hand padi's `previewFile` a correct, un-
 *       normalized file tail — including end-to-end through the real
 *       @hono/node-server adapter, where the RAW target must survive WHATWG
 *       normalization.
 *  The realpath/symlink-escape 403 coverage now lives against padi's
 *  `readPreview` (`packages/padi/src/preview.test.ts`), since the guard moved
 *  there when the Hono route was re-backed onto that read. */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { HttpBindings } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { previewFile } from "@kolu/padi/assembly";
import { contentTypeForPath, serveFile } from "@kolu/serve-dir";
import { Hono } from "hono";
import {
  BINARY_PREVIEWABLE_EXTENSIONS,
  buildTerminalFileUrl,
  RASTER_IMAGE_EXTENSIONS,
  SANDBOX_PREVIEWABLE_EXTENSIONS,
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
  VIDEO_EXTENSIONS,
} from "kolu-common/preview";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assembleRemotePreview,
  type PreviewRangeReader,
  previewTailFromRawUrl,
  rawTargetFromContext,
  REMOTE_PREVIEW_CHUNK_BYTES,
} from "./iframePreviewRoute.ts";

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

  // Sandbox-previewable kinds (.html/.htm/.svg/.pdf) span families (text/html,
  // image/svg+xml, application/pdf), so the non-octet check is the right
  // invariant for that bucket.
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
    return async (range) => {
      const r = await serveFile(tmpRoot, name, range ?? null);
      const bodyBase64 =
        typeof r.body === "string"
          ? Buffer.from(r.body, "utf8").toString("base64")
          : Buffer.from(await new Response(r.body).arrayBuffer()).toString(
              "base64",
            );
      return { status: r.status, headers: r.headers, bodyBase64 };
    };
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

  it("serves a whole file (no Range) as a 200 with the real Content-Type and exact bytes", async () => {
    const r = await assembleRemotePreview(
      serveDirReader("hello.txt"),
      undefined,
    );
    expect(r.status).toBe(200);
    expect(headerCI(r.headers, "content-type")).toMatch(/^text\/plain/);
    // A full 200 carries NO Content-Length (parity with the local streaming read).
    expect(headerCI(r.headers, "content-length")).toBeUndefined();
    expect((await drain(r.body)).toString("utf8")).toBe(HELLO);
  });

  it("round-trips BINARY bytes exactly across multiple chunks (no base64 corruption)", async () => {
    // 300-byte blob, 128-byte chunk → 3 dials (128 + 128 + 44). Bytes must match
    // the fixture exactly — a high-byte corruption on the base64 wire would show.
    const r = await assembleRemotePreview(
      serveDirReader("blob.png"),
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
    const r = await assembleRemotePreview(rec.read, undefined, 128);
    await drain(r.body); // pull the whole stream so every chunk dial fires
    expect(rec.ranges).toEqual([
      "bytes=0-0", // metadata probe
      "bytes=0-127",
      "bytes=128-255",
      "bytes=256-299",
    ]);
  });

  it("serves a satisfiable Range as a 206 with Content-Range + Content-Length", async () => {
    const r = await assembleRemotePreview(
      serveDirReader("hello.txt"),
      "bytes=0-4",
    );
    expect(r.status).toBe(206);
    expect(headerCI(r.headers, "content-range")).toBe("bytes 0-4/11");
    expect(headerCI(r.headers, "content-length")).toBe("5");
    expect((await drain(r.body)).toString("utf8")).toBe("hello");
  });

  it("resolves a suffix range via serve-dir's own parser (bytes=-5 → last 5 bytes)", async () => {
    // Proves the loop reuses `@kolu/serve-dir`'s `parseByteRange`, not a re-derived
    // one: `bytes=-5` on 11 bytes resolves to 6-10.
    const r = await assembleRemotePreview(
      serveDirReader("hello.txt"),
      "bytes=-5",
    );
    expect(r.status).toBe(206);
    expect(headerCI(r.headers, "content-range")).toBe("bytes 6-10/11");
    expect((await drain(r.body)).toString("utf8")).toBe("world");
  });

  it("416s an unsatisfiable Range on a non-empty file", async () => {
    const r = await assembleRemotePreview(
      serveDirReader("hello.txt"),
      "bytes=100-200",
    );
    expect(r.status).toBe(416);
    expect(headerCI(r.headers, "content-range")).toBe("bytes */11");
  });

  it("serves a ZERO-length file (no Range) as a 200 with an empty body", async () => {
    const r = await assembleRemotePreview(
      serveDirReader("empty.txt"),
      undefined,
    );
    expect(r.status).toBe(200);
    expect(headerCI(r.headers, "content-type")).toMatch(/^text\/plain/);
    expect((await drain(r.body)).byteLength).toBe(0);
  });

  it("416s a Range against a ZERO-length file (bytes */0)", async () => {
    const r = await assembleRemotePreview(
      serveDirReader("empty.txt"),
      "bytes=0-100",
    );
    expect(r.status).toBe(416);
    expect(headerCI(r.headers, "content-range")).toBe("bytes */0");
  });

  it("propagates a missing-file error status verbatim (404, not a masked 200)", async () => {
    const r = await assembleRemotePreview(
      serveDirReader("nope.txt"),
      undefined,
    );
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
    const faulty: PreviewRangeReader = async (range) => {
      // Count only the body-chunk dials (a real range with a non-zero end), not the
      // `bytes=0-0` probe.
      if (range && range !== "bytes=0-0") {
        chunkDials += 1;
        if (chunkDials === 2)
          return { status: 500, headers: {}, bodyBase64: "" };
      }
      return inner(range);
    };
    const r = await assembleRemotePreview(faulty, undefined, 128);
    expect(r.status).toBe(200); // headers committed before the fault
    await expect(drain(r.body)).rejects.toThrow(/expected 206, got 500/);
  });

  it("FAILS LOUDLY when a chunk returns a short body — never a silent truncation", async () => {
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = async (range) => {
      const r = await inner(range);
      // Corrupt the first BODY chunk to one byte short of what its Content-Range
      // promises. The length check must reject rather than emit a truncated body.
      if (range === "bytes=0-127")
        return { ...r, bodyBase64: r.bodyBase64.slice(0, 8) };
      return r;
    };
    const r = await assembleRemotePreview(faulty, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/expected 128 bytes/);
  });

  it("FAILS LOUDLY when the file size changes mid-stream — refuses an inconsistent body", async () => {
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = async (range) => {
      const r = await inner(range);
      // Rewrite the SECOND chunk's Content-Range total to a different size, as if
      // the file were replaced under the loop.
      if (range === "bytes=128-255") {
        const headers = { ...r.headers, "Content-Range": "bytes 128-255/999" };
        return { ...r, headers };
      }
      return r;
    };
    const r = await assembleRemotePreview(faulty, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/size changed mid-stream/);
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
  const terminalId = "abc";

  it("round-trips a filename with a literal % through encode → extract → serve-dir decode", async () => {
    // The bug class: a real file `100% done.mp4` is built as
    // `100%25%20done.mp4`. Decoding the tail once before serve-dir (as
    // `c.req.path`'s `decodeURI` would) yields `100% done.mp4`, and serve-dir's
    // `decodeURIComponent` then throws on the bare `% ` → a spurious 400. The raw
    // tail keeps it encoded so serve-dir's single decode recovers the real name.
    const filePath = "100% done.mp4";
    const url = `http://host${buildTerminalFileUrl(terminalId, filePath)}`;
    const tail = previewTailFromRawUrl(url, terminalId);
    expect(tail).toBe("100%25%20done.mp4");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, filePath), "video-bytes");
      const res = await serveFile(tmpRoot, tail);
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
    const url = `http://host/api/terminals/${terminalId}/file/foo%2f..%2fpasswd`;
    const tail = previewTailFromRawUrl(url, terminalId);
    expect(tail).toBe("foo%2f..%2fpasswd");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      const res = await serveFile(tmpRoot, tail);
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
    const url = `http://host/api/terminals/${terminalId}/file/foo/../secret.html`;
    const tail = previewTailFromRawUrl(url, terminalId);
    expect(tail).toBe("foo/../secret.html");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");
      const res = await serveFile(tmpRoot, tail);
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps an encoded `%2e%2e` dot segment intact (no URL normalization)", async () => {
    // WHATWG normalization also decodes-then-collapses `%2e%2e` → `..`. Slicing
    // the raw string leaves it encoded for serve-dir's single decode, which then
    // produces a `..` segment the per-segment check rejects with 400.
    const url = `http://host/api/terminals/${terminalId}/file/foo/%2e%2e/secret.html`;
    const tail = previewTailFromRawUrl(url, terminalId);
    expect(tail).toBe("foo/%2e%2e/secret.html");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");
      const res = await serveFile(tmpRoot, tail);
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
        `/api/terminals/${terminalId}/file/clip.mp4?v=123`,
        terminalId,
      ),
    ).toBe("clip.mp4");
  });

  it("returns empty for a URL that doesn't match the prefix", () => {
    expect(previewTailFromRawUrl("http://host/other/path", terminalId)).toBe(
      "",
    );
  });
});

// The unit tests above feed `previewTailFromRawUrl` a literal raw string, but
// production hands it a value from a real Hono + @hono/node-server request. That
// adapter builds `c.req.raw.url` via `new URL(...).href`, which WHATWG-normalizes
// dot segments BEFORE the handler runs — so a route reading `c.req.raw.url` would
// have the `..` collapsed away and serve the sibling file. These tests boot the
// real adapter and drive it over HTTP to prove the shipped route sources the RAW
// target (`c.env.incoming.url`) and the `..` guard holds end-to-end.
describe("iframe-preview route over real @hono/node-server (raw target survives the adapter)", () => {
  const terminalId = "abc";
  let tmpRoot: string;
  let server: ReturnType<typeof serve>;
  let baseUrl: string;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-route-int-"));
    fs.writeFileSync(path.join(tmpRoot, "clip.mp4"), "video-bytes");
    fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");

    // Drive the SAME shipped target-selection adapter production uses
    // (`rawTargetFromContext`, which reads the RAW `c.env.incoming.url` and
    // fails CLOSED to a 500 when `incoming` is absent rather than serving the
    // WHATWG-normalized `c.req.raw.url`), slice the tail, hand it to padi's
    // `readPreview`, and reconstruct the Response — the exact re-backed route
    // shape from `index.ts`, so this test can't drift from it.
    const app = new Hono<{ Bindings: HttpBindings }>();
    const pattern = `${TERMINAL_FILE_ROUTE_BASE}/:terminalId/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/*`;
    app.get(pattern, async (c) => {
      const id = c.req.param("terminalId");
      const rawTarget = rawTargetFromContext(c);
      if (rawTarget === undefined) {
        return c.text("raw request target unavailable", 500);
      }
      const rawTail = previewTailFromRawUrl(rawTarget, id);
      const r = await previewFile({
        repoPath: tmpRoot,
        filePath: rawTail,
        range: c.req.header("range"),
      });
      return new Response(r.body as BodyInit, {
        status: r.status,
        headers: r.headers,
      });
    });

    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) =>
      server.on("listening", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected a TCP address from the test server");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

  it("serves an in-root file (sanity: the route is wired)", async () => {
    const res = await rawGet(`/api/terminals/${terminalId}/file/clip.mp4?v=1`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("video-bytes");
  });

  it("400s a literal `..` dot segment instead of serving the sibling", async () => {
    const res = await rawGet(
      `/api/terminals/${terminalId}/file/foo/../secret.html`,
    );
    expect(res.status).toBe(400);
    expect(res.body).not.toContain("SECRET");
  });

  it("400s an encoded `%2e%2e` dot segment instead of serving the sibling", async () => {
    const res = await rawGet(
      `/api/terminals/${terminalId}/file/foo/%2e%2e/secret.html`,
    );
    expect(res.status).toBe(400);
    expect(res.body).not.toContain("SECRET");
  });
});
