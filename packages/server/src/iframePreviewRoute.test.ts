import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contentTypeForPath,
  isIframePreviewable,
  resolvePreviewPath,
  serveResolvedFile,
} from "./iframePreviewRoute";

describe("isIframePreviewable", () => {
  it("classifies HTML artifacts and their vector/document siblings", () => {
    expect(isIframePreviewable("out.html")).toBe(true);
    expect(isIframePreviewable("out.HTM")).toBe(true);
    expect(isIframePreviewable("logo.svg")).toBe(true);
    expect(isIframePreviewable("doc.pdf")).toBe(true);
  });

  it("classifies raster images (regression: were read as UTF-8 garbage)", () => {
    // Before the fix these fell through to the text-read path in
    // `surface.ts` and rendered as binary noise in the Code browser.
    expect(isIframePreviewable("icon-512.png")).toBe(true);
    expect(isIframePreviewable("photo.JPG")).toBe(true);
    expect(isIframePreviewable("photo.jpeg")).toBe(true);
    expect(isIframePreviewable("anim.gif")).toBe(true);
    expect(isIframePreviewable("hero.webp")).toBe(true);
    expect(isIframePreviewable("favicon.ico")).toBe(true);
  });

  it("leaves source files on the text path", () => {
    expect(isIframePreviewable("main.ts")).toBe(false);
    expect(isIframePreviewable("README.md")).toBe(false);
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
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("serves an existing HTML file with the right Content-Type", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "page.html"),
    );
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.body.toString()).toBe("<!doctype html><h1>hi</h1>");
  });

  it("serves a nested asset", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "sub/child.svg"),
    );
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/svg+xml");
  });

  it("404s for missing files (with valid path)", async () => {
    const res = await serveResolvedFile(resolvePreviewPath(tmpRoot, "no.html"));
    expect(res.status).toBe(404);
  });

  it("404s for a directory (not a file)", async () => {
    const res = await serveResolvedFile(resolvePreviewPath(tmpRoot, "sub"));
    expect(res.status).toBe(404);
  });

  it("propagates the resolver's 400 verbatim", async () => {
    const res = await serveResolvedFile(
      resolvePreviewPath(tmpRoot, "../escape"),
    );
    expect(res.status).toBe(400);
  });
});
