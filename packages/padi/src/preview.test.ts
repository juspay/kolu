import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cause, Effect, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPreview as readPreviewEffect } from "./preview.ts";

function readPreview(...args: Parameters<typeof readPreviewEffect>) {
  return Effect.runPromiseExit(readPreviewEffect(...args)).then((exit) =>
    Exit.isSuccess(exit)
      ? exit.value
      : Promise.reject(Cause.squash(exit.cause)),
  );
}

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
    expect(res.bodyBase64.length).toBeGreaterThan(0);
  });

  it("serves a small unranged file whole (200) — comfortably under the cap", async () => {
    const res = await readPreview({ repoPath: tmpRoot, filePath: "small.bin" });
    expect(res.status).toBe(200);
    expect(decodeBody(res.bodyBase64)).toBe("0123456789");
  });
});
