import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAll, readFile } from "./browse.ts";

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

describe("listAll", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-listall-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function initRepo(name: string): Promise<string> {
    const dir = path.join(tmpDir, `${name}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    await simpleGit(dir).init();
    return dir;
  }

  it("lists tracked and untracked files that exist in the working tree", async () => {
    const dir = await initRepo("visible-files");
    fs.writeFileSync(path.join(dir, ".gitignore"), "*.log\n");
    fs.writeFileSync(path.join(dir, "tracked.txt"), "tracked\n");
    fs.writeFileSync(path.join(dir, "untracked.txt"), "untracked\n");
    fs.writeFileSync(path.join(dir, "ignored.log"), "ignored\n");
    await simpleGit(dir).add([".gitignore", "tracked.txt"]);
    await simpleGit(dir).commit("init");

    const result = await listAll(dir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      ".gitignore",
      "tracked.txt",
      "untracked.txt",
    ]);
  });

  it("omits tracked files deleted from the working tree", async () => {
    const dir = await initRepo("deleted-files");
    fs.writeFileSync(path.join(dir, "gone.txt"), "gone\n");
    await simpleGit(dir).add("gone.txt");
    await simpleGit(dir).commit("init");

    fs.rmSync(path.join(dir, "gone.txt"));

    const result = await listAll(dir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});
