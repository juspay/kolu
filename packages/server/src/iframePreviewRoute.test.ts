import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BINARY_PREVIEWABLE_EXTENSIONS } from "kolu-common/preview";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contentTypeForPath,
  parseByteRange,
  resolvePreviewPath,
  serveResolvedFile,
} from "./iframePreviewRoute";

// Ranged 206 bodies are a `ReadableStream` (bytes flow from a bounded file
// handle, never the whole file through the heap), so the assertions read them
// to a string instead of `.toString()`-ing the body directly.
async function readBody(body: Uint8Array | string | ReadableStream) {
  if (typeof body === "string") return body;
  if (body instanceof ReadableStream) {
    return new Response(body).text();
  }
  return Buffer.from(body).toString();
}

// The classifier (`isBinaryPreviewable` / `isRasterImage`) and its own tests
// live in `kolu-common/preview`. This suite covers the route's serving
// layer and the one invariant that couples it to that classifier:

describe("CONTENT_TYPES covers every binary-previewable extension", () => {
  // `isBinaryPreviewable` routes these to `kind:"binary"`; if any lacks a
  // real Content-Type the route serves `application/octet-stream` and the
  // browser downloads instead of rendering. Keeps the two in step now that
  // the extension list lives in a different package from CONTENT_TYPES.
  it.each(
    BINARY_PREVIEWABLE_EXTENSIONS,
  )("%s has a non-octet Content-Type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).not.toBe(
      "application/octet-stream",
    );
  });
});

describe("contentTypeForPath", () => {
  it("maps the iframe-previewable extensions", () => {
    expect(contentTypeForPath("a.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("a.HTM")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("logo.svg")).toBe("image/svg+xml");
    expect(contentTypeForPath("doc.pdf")).toBe("application/pdf");
  });

  it("maps common HTML-asset siblings so relative <link>/<script> resolve", () => {
    expect(contentTypeForPath("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForPath("app.js")).toBe(
      "application/javascript; charset=utf-8",
    );
    expect(contentTypeForPath("icon.png")).toBe("image/png");
  });

  it("maps video containers so the <video> element gets a real type", () => {
    expect(contentTypeForPath("demo.mp4")).toBe("video/mp4");
    expect(contentTypeForPath("clip.WEBM")).toBe("video/webm");
    expect(contentTypeForPath("trailer.mov")).toBe("video/quicktime");
    expect(contentTypeForPath("old.ogv")).toBe("video/ogg");
  });

  it("falls back to octet-stream for unknown types", () => {
    expect(contentTypeForPath("mystery.xyz")).toBe("application/octet-stream");
    expect(contentTypeForPath("noext")).toBe("application/octet-stream");
  });
});

describe("resolvePreviewPath", () => {
  const repoRoot = "/tmp/some-repo";

  it("accepts a simple relative path", () => {
    const res = resolvePreviewPath(repoRoot, "docs/output.html");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.abs).toBe(path.join(repoRoot, "docs/output.html"));
    expect(res.mime).toBe("text/html; charset=utf-8");
  });

  it("rejects plaintext .. segments", () => {
    const res = resolvePreviewPath(repoRoot, "../etc/passwd");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects URL-encoded .. (%2e%2e)", () => {
    const res = resolvePreviewPath(repoRoot, "%2e%2e/etc/passwd");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects encoded-slash smuggling (foo%2f..%2fpasswd)", () => {
    // splitting BEFORE decoding would let this through as one segment.
    const res = resolvePreviewPath(repoRoot, "foo%2f..%2fpasswd");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects empty middle segments (double slash)", () => {
    const res = resolvePreviewPath(repoRoot, "foo//bar.html");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects trailing slash (directory-listing intent)", () => {
    const res = resolvePreviewPath(repoRoot, "docs/");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects empty tail", () => {
    const res = resolvePreviewPath(repoRoot, "");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
  });

  it("rejects a malformed encoding (invalid percent sequence)", () => {
    const res = resolvePreviewPath(repoRoot, "%zz");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects an absolute child path", () => {
    const res = resolvePreviewPath(repoRoot, "/etc/passwd");
    // Leading slash → empty first segment, caught by the empty-segment check.
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects `.` segment", () => {
    const res = resolvePreviewPath(repoRoot, "docs/./output.html");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });
});

describe("parseByteRange", () => {
  it("returns null (serve whole file) when there is no Range header", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("", 100)).toBeNull();
  });

  it("parses a closed range inclusively", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
  });

  it("treats an open-ended range as through end-of-file", () => {
    expect(parseByteRange("bytes=50-", 100)).toEqual({ start: 50, end: 99 });
  });

  it("clamps an end past EOF to the last byte", () => {
    expect(parseByteRange("bytes=90-999", 100)).toEqual({ start: 90, end: 99 });
  });

  it("resolves a suffix range to the last N bytes", () => {
    expect(parseByteRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
    // Suffix larger than the file → whole file.
    expect(parseByteRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });

  it("marks an unsatisfiable range invalid (→ 416)", () => {
    expect(parseByteRange("bytes=100-200", 100)).toBe("invalid");
    expect(parseByteRange("bytes=50-10", 100)).toBe("invalid");
    expect(parseByteRange("bytes=-0", 100)).toBe("invalid");
    expect(parseByteRange("bytes=0-0", 0)).toBe("invalid");
  });

  it("falls back to whole-file for multi-range or malformed headers", () => {
    expect(parseByteRange("bytes=0-9,20-29", 100)).toBeNull();
    expect(parseByteRange("kbytes=0-9", 100)).toBeNull();
    expect(parseByteRange("bytes=-", 100)).toBeNull();
  });
});

describe("serveResolvedFile", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-iframe-route-test-"));
    fs.writeFileSync(
      path.join(tmpRoot, "page.html"),
      "<!doctype html><h1>hi</h1>",
    );
    fs.mkdirSync(path.join(tmpRoot, "sub"));
    fs.writeFileSync(path.join(tmpRoot, "sub", "child.svg"), "<svg/>");
    fs.writeFileSync(path.join(tmpRoot, "clip.mp4"), "0123456789");
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("serves an existing HTML file with the right Content-Type", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "page.html"),
      tmpRoot,
    );
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    // Advertised on every successful response so the <video> player knows it
    // can seek.
    expect(res.headers["Accept-Ranges"]).toBe("bytes");
    expect(res.body.toString()).toBe("<!doctype html><h1>hi</h1>");
  });

  it("answers a Range request with 206 Partial Content and the byte slice", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "clip.mp4"),
      tmpRoot,
      "bytes=2-5",
    );
    expect(res.status).toBe(206);
    expect(res.headers["Content-Type"]).toBe("video/mp4");
    expect(res.headers["Content-Range"]).toBe("bytes 2-5/10");
    expect(res.headers["Content-Length"]).toBe("4");
    expect(res.headers["Accept-Ranges"]).toBe("bytes");
    expect(await readBody(res.body)).toBe("2345");
  });

  it("serves the whole file (200) when no Range header is present", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "clip.mp4"),
      tmpRoot,
    );
    expect(res.status).toBe(200);
    expect(res.headers["Content-Length"]).toBe("10");
    expect(res.body.toString()).toBe("0123456789");
  });

  it("returns 416 for an unsatisfiable Range", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "clip.mp4"),
      tmpRoot,
      "bytes=50-60",
    );
    expect(res.status).toBe(416);
    expect(res.headers["Content-Range"]).toBe("bytes */10");
  });

  it("serves a nested asset", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "sub/child.svg"),
      tmpRoot,
    );
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/svg+xml");
  });

  it("404s for missing files (with valid path)", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "no.html"),
      tmpRoot,
    );
    expect(res.status).toBe(404);
  });

  it("404s for a directory (not a file)", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "sub"),
      tmpRoot,
    );
    expect(res.status).toBe(404);
  });

  it("propagates the resolver's 400 verbatim", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "../escape"),
      tmpRoot,
    );
    expect(res.status).toBe(400);
  });

  it("403s for a symlink that escapes the repo root (and never leaks content)", async () => {
    // Lexically `leak.html` is a clean in-root segment; only resolving the
    // symlink reveals it points outside. serveResolvedFile's fs-authority
    // stage must reject it before reading.
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-iframe-route-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.html");
      fs.writeFileSync(secret, "<!doctype html><h1>SECRET</h1>");
      fs.symlinkSync(secret, path.join(tmpRoot, "leak.html"));
      const res = await serveResolvedFile(
        resolvePreviewPath(tmpRoot, "leak.html"),
        tmpRoot,
      );
      expect(res.status).toBe(403);
      expect(res.body.toString()).not.toContain("SECRET");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
