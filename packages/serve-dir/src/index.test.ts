import fs from "node:fs";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contentTypeForPath,
  parseByteRange,
  rawPathname,
  type RealpathGuard,
  resolvePathUnder,
  serveFile,
} from "./index";

function runServe(...args: Parameters<typeof serveFile>) {
  return Effect.runPromise(serveFile(...args));
}

async function readBody(body: string | ReadableStream) {
  if (typeof body === "string") return body;
  return new Response(body).text();
}

function realpathGuardUnder(root: string): RealpathGuard {
  return (abs) =>
    Effect.promise(async () => {
      try {
        const [realRoot, real] = await Promise.all([
          realpath(root),
          realpath(abs),
        ]);
        const rel = path.relative(realRoot, real);
        return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
      } catch {
        return true;
      }
    });
}

describe("contentTypeForPath", () => {
  it("maps the iframe-previewable extensions", () => {
    expect(contentTypeForPath("a.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("a.HTM")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("logo.svg")).toBe("image/svg+xml");
    expect(contentTypeForPath("doc.pdf")).toBe("application/pdf");
  });

  it("maps common HTML-asset siblings so relative <link>/<script> resolve", () => {
    expect(contentTypeForPath("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForPath("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForPath("icon.png")).toBe("image/png");
  });

  it("maps video containers so the <video> element gets a real type", () => {
    expect(contentTypeForPath("demo.mp4")).toBe("video/mp4");
    expect(contentTypeForPath("clip.WEBM")).toBe("video/webm");
    expect(contentTypeForPath("trailer.mov")).toBe("video/quicktime");
    expect(contentTypeForPath("old.ogv")).toBe("video/ogg");
  });

  it("covers the MRMIME_GAP_MIME rows for generic types mrmime omits", () => {
    expect(contentTypeForPath("clip.m4v")).toBe("video/mp4");
    expect(contentTypeForPath("favicon.ico")).toBe("image/x-icon");
  });

  it("is COMPLETE, not a curated preview subset — types files no consumer previews", () => {
    expect(contentTypeForPath("mod.wasm")).toBe("application/wasm");
    expect(contentTypeForPath("notes.txt")).toBe("text/plain; charset=utf-8");
    expect(contentTypeForPath("data.csv")).toBe("text/csv; charset=utf-8");
    expect(contentTypeForPath("a.avif")).toBe("image/avif");
  });

  it("falls back to octet-stream for unknown types", () => {
    expect(contentTypeForPath("mystery.xyz")).toBe("application/octet-stream");
    expect(contentTypeForPath("noext")).toBe("application/octet-stream");
  });
});

describe("resolvePathUnder", () => {
  const root = "/tmp/some-repo";

  it("accepts a simple relative path", () => {
    const res = resolvePathUnder(root, "docs/output.html");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.abs).toBe(path.join(root, "docs/output.html"));
    expect(res.mime).toBe("text/html; charset=utf-8");
  });

  it("rejects plaintext .. segments", () => {
    const res = resolvePathUnder(root, "../etc/passwd");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects URL-encoded .. (%2e%2e)", () => {
    const res = resolvePathUnder(root, "%2e%2e/etc/passwd");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects encoded-slash smuggling (foo%2f..%2fpasswd)", () => {
    const res = resolvePathUnder(root, "foo%2f..%2fpasswd");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects empty middle segments (double slash)", () => {
    const res = resolvePathUnder(root, "foo//bar.html");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects trailing slash (directory-listing intent)", () => {
    const res = resolvePathUnder(root, "docs/");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects empty tail", () => {
    const res = resolvePathUnder(root, "");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
  });

  it("rejects a malformed encoding (invalid percent sequence)", () => {
    const res = resolvePathUnder(root, "%zz");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects an absolute child path", () => {
    const res = resolvePathUnder(root, "/etc/passwd");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects `.` segment", () => {
    const res = resolvePathUnder(root, "docs/./output.html");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });
});

describe("rawPathname", () => {
  it("returns an origin-form target unchanged (already starts with /)", () => {
    expect(rawPathname("/files/abc/file/docs/output.html")).toBe(
      "/files/abc/file/docs/output.html",
    );
  });

  it("strips scheme://authority from an absolute-form target", () => {
    expect(rawPathname("http://host:8080/files/abc/page.html")).toBe(
      "/files/abc/page.html",
    );
  });

  it("cuts the query at the first ?", () => {
    expect(rawPathname("/files/abc/page.html?v=123")).toBe(
      "/files/abc/page.html",
    );
  });

  it("cuts the fragment at the first #", () => {
    expect(rawPathname("/files/abc/page.html#section")).toBe(
      "/files/abc/page.html",
    );
  });

  it("cuts at whichever of ?/# comes first", () => {
    expect(rawPathname("/files/abc/page.html#frag?notquery")).toBe(
      "/files/abc/page.html",
    );
  });

  it("preserves dot segments WITHOUT normalizing — the whole point vs new URL", () => {
    expect(rawPathname("http://x/a/../secret")).toBe("/a/../secret");
    expect(rawPathname("/a/%2e%2e/secret")).toBe("/a/%2e%2e/secret");
  });

  it("preserves %2f without decoding it to a slash", () => {
    expect(rawPathname("/files/abc/foo%2f..%2fpasswd")).toBe(
      "/files/abc/foo%2f..%2fpasswd",
    );
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

describe("serveFile", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-serve-dir-test-"));
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
    const res = await runServe(tmpRoot, "page.html");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Accept-Ranges"]).toBe("bytes");
    expect(await readBody(res.body)).toBe("<!doctype html><h1>hi</h1>");
  });

  it("sets NO Content-Length on a full 200 — the runtime derives it from the bytes sent", async () => {
    const res = await runServe(tmpRoot, "page.html");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Length"]).toBeUndefined();
  });

  it("answers a Range request with 206 Partial Content and the byte slice", async () => {
    const res = await runServe(tmpRoot, "clip.mp4", "bytes=2-5");
    expect(res.status).toBe(206);
    expect(res.headers["Content-Type"]).toBe("video/mp4");
    expect(res.headers["Content-Range"]).toBe("bytes 2-5/10");
    expect(res.headers["Content-Length"]).toBe("4");
    expect(res.headers["Accept-Ranges"]).toBe("bytes");
    expect(await readBody(res.body)).toBe("2345");
  });

  it("emits a strong ETag (size-mtimeNs-ino) on 200 and 206, stable across reads of the unchanged file", async () => {
    const full = await runServe(tmpRoot, "clip.mp4");
    const ranged = await runServe(tmpRoot, "clip.mp4", "bytes=2-5");
    expect(full.headers.ETag).toMatch(/^"[0-9a-f]+-[0-9a-f]+-[0-9a-f]+"$/);
    expect(ranged.headers.ETag).toBe(full.headers.ETag);
    const again = await runServe(tmpRoot, "clip.mp4");
    expect(again.headers.ETag).toBe(full.headers.ETag);
  });

  it("bumps the ETag when the file content changes", async () => {
    const p = path.join(tmpRoot, "etag-change.bin");
    fs.writeFileSync(p, "aaaa");
    const e1 = (await runServe(tmpRoot, "etag-change.bin")).headers.ETag;
    fs.writeFileSync(p, "bbbbbb");
    const e2 = (await runServe(tmpRoot, "etag-change.bin")).headers.ETag;
    expect(e1).toBeDefined();
    expect(e2).not.toBe(e1);
    fs.rmSync(p, { force: true });
  });

  it("honors a Range when If-Range matches the current ETag (206)", async () => {
    const etag = (await runServe(tmpRoot, "clip.mp4")).headers.ETag;
    const res = await runServe(
      tmpRoot,
      "clip.mp4",
      "bytes=2-5",
      undefined,
      etag,
    );
    expect(res.status).toBe(206);
    expect(res.headers["Content-Range"]).toBe("bytes 2-5/10");
    expect(await readBody(res.body)).toBe("2345");
  });

  it("serves the full 200 when If-Range is STALE — never a 206 stitched onto changed bytes", async () => {
    const res = await runServe(
      tmpRoot,
      "clip.mp4",
      "bytes=2-5",
      undefined,
      '"deadbeef-stale-nomatch"',
    );
    expect(res.status).toBe(200);
    expect(res.headers["Content-Range"]).toBeUndefined();
    expect(res.headers["Content-Length"]).toBeUndefined();
    expect(await readBody(res.body)).toBe("0123456789");
  });

  it("ignores If-Range when there is no Range header (a plain 200 stays a 200)", async () => {
    const res = await runServe(
      tmpRoot,
      "clip.mp4",
      undefined,
      undefined,
      '"whatever"',
    );
    expect(res.status).toBe(200);
    expect(await readBody(res.body)).toBe("0123456789");
  });

  it("streams a 206 body consistent with its headers when the path is atomically replaced mid-flight", async () => {
    const swapPath = path.join(tmpRoot, "swap.mp4");
    fs.writeFileSync(swapPath, "0123456789");
    const res = await runServe(tmpRoot, "swap.mp4", "bytes=2-5");
    expect(res.status).toBe(206);
    expect(res.headers["Content-Range"]).toBe("bytes 2-5/10");
    expect(res.headers["Content-Length"]).toBe("4");
    const tmp = path.join(tmpRoot, "swap.mp4.tmp");
    fs.writeFileSync(tmp, "AAAAAAAAAAAAAAAAAAAA");
    fs.renameSync(tmp, swapPath);
    expect(await readBody(res.body)).toBe("2345");
    fs.rmSync(swapPath, { force: true });
  });

  it("serves the whole file (200) when no Range header is present", async () => {
    const res = await runServe(tmpRoot, "clip.mp4");
    expect(res.status).toBe(200);
    expect(await readBody(res.body)).toBe("0123456789");
  });

  it("streams the full 200 body (no Range) so a large file never lands in the heap", async () => {
    const res = await runServe(tmpRoot, "clip.mp4");
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(res.headers["Content-Length"]).toBeUndefined();
  });

  it("collapses a multi-range header to a streamed full 200", async () => {
    const res = await runServe(tmpRoot, "clip.mp4", "bytes=0-1,4-5");
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(await readBody(res.body)).toBe("0123456789");
  });

  it("returns 416 for an unsatisfiable Range", async () => {
    const res = await runServe(tmpRoot, "clip.mp4", "bytes=50-60");
    expect(res.status).toBe(416);
    expect(res.headers["Content-Range"]).toBe("bytes */10");
    expect(res.headers["Accept-Ranges"]).toBe("bytes");
    expect(res.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("serves a nested asset", async () => {
    const res = await runServe(tmpRoot, "sub/child.svg");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/svg+xml");
  });

  it("404s for missing files (with valid path)", async () => {
    const res = await runServe(tmpRoot, "no.html");
    expect(res.status).toBe(404);
  });

  it("404s for a directory (not a file)", async () => {
    const res = await runServe(tmpRoot, "sub");
    expect(res.status).toBe(404);
  });

  it("rejects a lexical traversal with 400 (the guard that's always on)", async () => {
    const res = await runServe(tmpRoot, "../escape");
    expect(res.status).toBe(400);
  });

  it("403s a symlink escaping the root when an injected realpath guard is supplied (no content leaks)", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-serve-dir-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.html");
      fs.writeFileSync(secret, "<!doctype html><h1>SECRET</h1>");
      fs.symlinkSync(secret, path.join(tmpRoot, "leak-guarded.html"));
      const res = await runServe(
        tmpRoot,
        "leak-guarded.html",
        undefined,
        realpathGuardUnder(tmpRoot),
      );
      expect(res.status).toBe(403);
      expect(res.body.toString()).not.toContain("SECRET");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(path.join(tmpRoot, "leak-guarded.html"), { force: true });
    }
  });

  it("follows a symlink when NO realpath guard is injected (the package stays lexical-only by default)", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-serve-dir-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.html");
      fs.writeFileSync(secret, "<!doctype html><h1>SECRET</h1>");
      fs.symlinkSync(secret, path.join(tmpRoot, "leak-unguarded.html"));
      const res = await runServe(tmpRoot, "leak-unguarded.html");
      expect(res.status).toBe(200);
      expect(await readBody(res.body)).toContain("SECRET");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(path.join(tmpRoot, "leak-unguarded.html"), { force: true });
    }
  });
});
