import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, statFileMtimeMs } from "./browse.ts";

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

  it("rejects a symlink that escapes the repo root", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-readfile-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.txt");
      fs.writeFileSync(secret, "TOP SECRET\n");
      fs.symlinkSync(secret, path.join(tmpDir, "leak.txt"));
      const result = await readFile(tmpDir, "leak.txt");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("follows a symlink that stays inside the repo", async () => {
    fs.writeFileSync(path.join(tmpDir, "target.txt"), "inside\n");
    fs.symlinkSync(
      path.join(tmpDir, "target.txt"),
      path.join(tmpDir, "alias.txt"),
    );
    const result = await readFile(tmpDir, "alias.txt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.content).toBe("inside\n");
  });
});

describe("statFileMtimeMs", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-statmtime-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects a symlink that escapes the repo root", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-statmtime-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.txt");
      fs.writeFileSync(secret, "TOP SECRET\n");
      fs.symlinkSync(secret, path.join(tmpDir, "leak.txt"));
      const result = await statFileMtimeMs(tmpDir, "leak.txt");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
