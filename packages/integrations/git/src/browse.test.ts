import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fsExists, readFile } from "./browse.ts";

describe("readFile", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-readfile-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads file content", async () => {
    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "world\n");
    const result = await readFile(tmpDir, "hello.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe("world\n");
    expect(result.value.truncated).toBe(false);
  });

  it("rejects path traversal", async () => {
    const result = await readFile(tmpDir, "../../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    }
  });

  it("returns error for non-existent file", async () => {
    const result = await readFile(tmpDir, "nope.txt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("GIT_FAILED");
    }
  });
});

describe("fsExists", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-fsexists-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns true for an existing file", async () => {
    fs.writeFileSync(path.join(tmpDir, "present.txt"), "x");
    const result = await fsExists(tmpDir, "present.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(true);
  });

  it("returns false for a missing file", async () => {
    const result = await fsExists(tmpDir, "missing.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(false);
  });

  it("returns false for a directory (not a regular file)", async () => {
    fs.mkdirSync(path.join(tmpDir, "subdir"));
    const result = await fsExists(tmpDir, "subdir");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(false);
  });

  it("rejects path traversal", async () => {
    const result = await fsExists(tmpDir, "../../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    }
  });

  it("treats a non-directory path segment as a miss, not an error", async () => {
    fs.writeFileSync(path.join(tmpDir, "leaf.txt"), "x");
    const result = await fsExists(tmpDir, "leaf.txt/deeper.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(false);
  });
});
