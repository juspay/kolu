import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  let repo: string;

  function git(...args: string[]) {
    execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  }

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-listall-test-"));
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("commit", "--allow-empty", "-qm", "init");
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("lists tracked and untracked files, excluding gitignored ones", async () => {
    fs.mkdirSync(path.join(repo, "lib"), { recursive: true });
    fs.writeFileSync(path.join(repo, "lib", "tracked.ts"), "a\n");
    fs.writeFileSync(path.join(repo, ".gitignore"), "ignored.log\n");
    git("add", "lib/tracked.ts", ".gitignore");
    git("commit", "-qm", "add tracked");
    fs.writeFileSync(path.join(repo, "untracked.txt"), "u\n");
    fs.writeFileSync(path.join(repo, "ignored.log"), "i\n");

    const result = await listAll(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain("lib/tracked.ts");
    expect(result.value).toContain("untracked.txt");
    expect(result.value).not.toContain("ignored.log");
  });

  // Regression: `git ls-files --cached` keeps entries whose blobs still
  // live in the index even after the file is removed from disk. Without
  // an explicit subtraction of `--deleted`, the Code tab's browse mode
  // shows ghost rows for `rm`'d files until the deletion is staged, and
  // — worse — the snapshot equality check upstream then treats pre-rm
  // and post-rm listings as identical and suppresses the watcher tick
  // entirely, so the row never disappears at all.
  it("omits files deleted from disk but still in the index", async () => {
    fs.writeFileSync(path.join(repo, "doomed.ts"), "x\n");
    git("add", "doomed.ts");
    git("commit", "-qm", "add doomed");
    const before = await listAll(repo);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value).toContain("doomed.ts");

    fs.unlinkSync(path.join(repo, "doomed.ts"));
    const after = await listAll(repo);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value).not.toContain("doomed.ts");
  });
});
