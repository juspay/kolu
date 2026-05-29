import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BINARY_PREVIEWABLE_EXTENSIONS } from "kolu-git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contentTypeForPath,
  resolvePreviewPath,
  serveResolvedFile,
} from "./iframePreviewRoute";

// The classifier (`isBinaryPreviewable` / `isRasterImage`) and its own tests
// live in `kolu-git/previewable`. This suite covers the route's serving
// layer and the one invariant that couples it to that classifier:

describe("CONTENT_TYPES covers every binary-previewable extension", () => {
  // `isBinaryPreviewable` routes these to `kind:"binary"`; if any lacks a
  // real Content-Type the route serves `application/octet-stream` and the
  // browser downloads instead of rendering. Keeps the two in step now that
  // the extension list lives in a different package from CONTENT_TYPES.
  it.each([
    ...BINARY_PREVIEWABLE_EXTENSIONS,
  ])("%s has a non-octet Content-Type", (ext) => {
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
