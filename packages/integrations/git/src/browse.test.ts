import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { simpleGit } from "simple-git";
import { listDir, readFile } from "./browse.ts";

describe("listDir", () => {
  let tmpDir: string;

  async function initRepo(name: string) {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const git = simpleGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    return { dir, git };
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-browse-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists tracked files and directories at the root", async () => {
    const { dir, git } = await initRepo("tracked-root");
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "README.md"), "hello");
    fs.writeFileSync(path.join(dir, "src/index.ts"), "export {}");
    await git.add(".");
    await git.commit("initial");

    const result = await listDir(dir, "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const names = result.value.map((e) => e.name);
    expect(names).toContain("README.md");
    expect(names).toContain("src");

    const src = result.value.find((e) => e.name === "src");
    expect(src?.isDirectory).toBe(true);
    expect(src?.path).toBe("src");

    const readme = result.value.find((e) => e.name === "README.md");
    expect(readme?.isDirectory).toBe(false);
  });

  it("lists entries in a subdirectory", async () => {
    const { dir, git } = await initRepo("subdir");
    fs.mkdirSync(path.join(dir, "pkg/lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "pkg/index.ts"), "x");
    fs.writeFileSync(path.join(dir, "pkg/lib/util.ts"), "y");
    await git.add(".");
    await git.commit("initial");

    const result = await listDir(dir, "pkg");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((e) => e.name)).toEqual(["lib", "index.ts"]);
    expect(result.value[0]?.isDirectory).toBe(true);
    expect(result.value[0]?.path).toBe("pkg/lib");
    expect(result.value[1]?.path).toBe("pkg/index.ts");
  });

  it("includes untracked-but-not-ignored files", async () => {
    const { dir, git } = await initRepo("untracked");
    fs.writeFileSync(path.join(dir, "tracked.ts"), "a");
    await git.add(".");
    await git.commit("initial");

    // Create an untracked file after commit
    fs.writeFileSync(path.join(dir, "untracked.ts"), "b");

    const result = await listDir(dir, "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const names = result.value.map((e) => e.name);
    expect(names).toContain("tracked.ts");
    expect(names).toContain("untracked.ts");
  });

  it("excludes gitignored files", async () => {
    const { dir, git } = await initRepo("ignored");
    fs.writeFileSync(path.join(dir, ".gitignore"), "build/\n*.log\n");
    fs.writeFileSync(path.join(dir, "keep.ts"), "a");
    await git.add(".");
    await git.commit("initial");

    // Create ignored files
    fs.mkdirSync(path.join(dir, "build"));
    fs.writeFileSync(path.join(dir, "build/out.js"), "x");
    fs.writeFileSync(path.join(dir, "debug.log"), "y");

    const result = await listDir(dir, "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const names = result.value.map((e) => e.name);
    expect(names).toContain("keep.ts");
    expect(names).not.toContain("build");
    expect(names).not.toContain("debug.log");
  });

  it("sorts directories first, then files, alphabetically", async () => {
    const { dir, git } = await initRepo("sort-order");
    fs.mkdirSync(path.join(dir, "zebra"));
    fs.mkdirSync(path.join(dir, "alpha"));
    fs.writeFileSync(path.join(dir, "zebra/z.ts"), "z");
    fs.writeFileSync(path.join(dir, "alpha/a.ts"), "a");
    fs.writeFileSync(path.join(dir, "middle.ts"), "m");
    fs.writeFileSync(path.join(dir, "aaa.ts"), "a");
    await git.add(".");
    await git.commit("initial");

    const result = await listDir(dir, "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const names = result.value.map((e) => e.name);
    // Directories first (alphabetical), then files (alphabetical)
    expect(names).toEqual(["alpha", "zebra", "aaa.ts", "middle.ts"]);
  });

  it("rejects path traversal", async () => {
    const { dir } = await initRepo("traversal");
    const result = await listDir(dir, "../etc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    }
  });

  it("works in an empty repo (no commits)", async () => {
    const { dir } = await initRepo("empty");
    // Create an untracked file — no HEAD exists yet
    fs.writeFileSync(path.join(dir, "new.ts"), "x");

    const result = await listDir(dir, "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((e) => e.name)).toContain("new.ts");
  });
});

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
