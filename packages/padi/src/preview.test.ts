/** Tests for padi's `readPreview` — the ONE range-capable byte read behind both
 *  `padiSurface.procedures.preview.read` and kolu-server's re-backed Hono
 *  preview route. This is where the `..`/`%2f`/symlink 403 coverage lives now
 *  that the guard moved out of kolu-server (`iframePreviewRoute.ts`): a repo-
 *  local symlink escaping the root is rejected 403 before any byte is read, and
 *  a lexical `..`/`%2f` traversal is rejected 400 by serve-dir's per-segment
 *  guard — exercising the SHIPPED `readPreview`, not a re-derived copy. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPreview } from "./preview.ts";

/** Decode `readPreview`'s base64 body back to a UTF-8 string for assertions. */
function decodeBody(bodyBase64: string): string {
  return Buffer.from(bodyBase64, "base64").toString("utf8");
}

describe("readPreview realpath guard blocks symlink escape", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "padi-preview-guard-"));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("403s a symlink whose real target escapes the root (no content leaks)", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "padi-preview-guard-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.html");
      fs.writeFileSync(secret, "<!doctype html><h1>SECRET</h1>");
      fs.symlinkSync(secret, path.join(tmpRoot, "leak.html"));
      const res = await readPreview({
        repoPath: tmpRoot,
        filePath: "leak.html",
      });
      expect(res.status).toBe(403);
      expect(decodeBody(res.bodyBase64)).not.toContain("SECRET");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("allows an in-root file through the same read (200, body intact)", async () => {
    fs.writeFileSync(
      path.join(tmpRoot, "ok.html"),
      "<!doctype html><h1>ok</h1>",
    );
    const res = await readPreview({ repoPath: tmpRoot, filePath: "ok.html" });
    expect(res.status).toBe(200);
    expect(decodeBody(res.bodyBase64)).toContain("ok");
  });
});

describe("readPreview rejects lexical traversal (repo-relative)", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "padi-preview-trav-"));
    fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("400s a literal `..` dot segment instead of serving the sibling", async () => {
    const res = await readPreview({
      repoPath: tmpRoot,
      filePath: "foo/../secret.html",
    });
    expect(res.status).toBe(400);
    expect(decodeBody(res.bodyBase64)).not.toContain("SECRET");
  });

  it("400s an encoded `%2f` smuggled slash instead of traversing", async () => {
    // serve-dir decodes `%2f` → `/`, splits, and the per-segment `..` check
    // rejects it — the raw tail keeps `%2f` encoded so the single decode fires.
    const res = await readPreview({
      repoPath: tmpRoot,
      filePath: "foo%2f..%2fpasswd",
    });
    expect(res.status).toBe(400);
  });
});

describe("readPreview forwards Range → 206 ranged bytes", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "padi-preview-range-"));
    fs.writeFileSync(path.join(tmpRoot, "clip.bin"), "0123456789");
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("answers a satisfiable single range with 206 and just those bytes", async () => {
    const res = await readPreview({
      repoPath: tmpRoot,
      filePath: "clip.bin",
      range: "bytes=0-3",
    });
    expect(res.status).toBe(206);
    expect(decodeBody(res.bodyBase64)).toBe("0123");
  });

  it("reads the whole file (200) when no Range is given", async () => {
    const res = await readPreview({ repoPath: tmpRoot, filePath: "clip.bin" });
    expect(res.status).toBe(200);
    expect(decodeBody(res.bodyBase64)).toBe("0123456789");
  });
});

describe("readPreview caps an unranged/open-ended read (no unbounded inline buffer)", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "padi-preview-cap-"));
    fs.writeFileSync(path.join(tmpRoot, "small.bin"), "0123456789");
    // A SPARSE file just OVER the 64 MiB inline cap — `ftruncate` sizes it
    // without writing 64 MiB of bytes, so the test stays fast and the
    // Content-Length gate can reject it before any byte is read.
    const fd = fs.openSync(path.join(tmpRoot, "big.bin"), "w");
    fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1);
    fs.closeSync(fd);
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("refuses an open-ended range over the cap with PreviewTooLarge (via Content-Length)", async () => {
    await expect(
      readPreview({
        repoPath: tmpRoot,
        filePath: "big.bin",
        range: "bytes=0-",
      }),
    ).rejects.toMatchObject({ _tag: "PreviewTooLarge" });
  });

  it("refuses a HUGE bounded range that resolves to ~the whole file with PreviewTooLarge", async () => {
    // `bytes=0-99999999999` is shape-bounded (both ends present) but serve-dir
    // clamps its end to the file size, so it resolves to the whole 64 MiB+1 file.
    // The old shape-only `isBoundedRange` let exactly this ride the UNCAPPED
    // `arrayBuffer()` path — the cap bypass. Keying the cap on the RESOLVED
    // Content-Length closes it; reverting to the shape check makes this NOT throw.
    await expect(
      readPreview({
        repoPath: tmpRoot,
        filePath: "big.bin",
        range: "bytes=0-99999999999",
      }),
    ).rejects.toMatchObject({ _tag: "PreviewTooLarge" });
  });

  it("leaves a BOUNDED range over the same big file unchanged (206, just those bytes)", async () => {
    const res = await readPreview({
      repoPath: tmpRoot,
      filePath: "big.bin",
      range: "bytes=0-3",
    });
    expect(res.status).toBe(206);
    // 4 sparse bytes → non-empty base64; the bounded path is never capped.
    expect(res.bodyBase64.length).toBeGreaterThan(0);
  });

  it("serves a small unranged file whole (200) — comfortably under the cap", async () => {
    const res = await readPreview({ repoPath: tmpRoot, filePath: "small.bin" });
    expect(res.status).toBe(200);
    expect(decodeBody(res.bodyBase64)).toBe("0123456789");
  });
});
