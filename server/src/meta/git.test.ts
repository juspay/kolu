import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { simpleGit } from "simple-git";
import { gitInfoEqual, resolveGitInfo } from "./git.ts";
import type { GitInfo } from "kolu-common";

describe("gitInfoEqual", () => {
  const info: GitInfo = {
    repoRoot: "/home/user/repo",
    repoName: "repo",
    worktreePath: "/home/user/repo",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/home/user/repo",
  };

  it("returns true for identical references", () => {
    expect(gitInfoEqual(info, info)).toBe(true);
  });

  it("returns true for both null", () => {
    expect(gitInfoEqual(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    expect(gitInfoEqual(info, null)).toBe(false);
    expect(gitInfoEqual(null, info)).toBe(false);
  });

  it("returns true for equal values", () => {
    expect(gitInfoEqual(info, { ...info })).toBe(true);
  });

  // Fields that ARE compared
  it.each([
    { field: "repoRoot", value: "/other" },
    { field: "branch", value: "develop" },
    { field: "worktreePath", value: "/other" },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(gitInfoEqual(info, { ...info, [field]: value })).toBe(false);
  });

  // Fields that are NOT compared (intentional — only identity-level fields matter)
  it.each([
    { field: "repoName", value: "other" },
    { field: "isWorktree", value: true },
  ] as const)("ignores $field differences", ({ field, value }) => {
    expect(gitInfoEqual(info, { ...info, [field]: value })).toBe(true);
  });
});

describe("resolveGitInfo", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-resolve-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for non-git directory", async () => {
    const dir = path.join(tmpDir, "not-a-repo");
    fs.mkdirSync(dir, { recursive: true });
    expect(await resolveGitInfo(dir)).toBeNull();
  });

  it("resolves a plain git repo", async () => {
    const repoDir = path.join(tmpDir, "plain-repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const git = simpleGit(repoDir);
    await git.init();
    await git.checkoutLocalBranch("main");
    // Need at least one commit for branch to exist
    fs.writeFileSync(path.join(repoDir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");

    const info = await resolveGitInfo(repoDir);
    expect(info).not.toBeNull();
    expect(info!.repoRoot).toBe(fs.realpathSync(repoDir));
    expect(info!.repoName).toBe("plain-repo");
    expect(info!.branch).toBe("main");
    expect(info!.isWorktree).toBe(false);
    expect(info!.mainRepoRoot).toBe(fs.realpathSync(repoDir));
  });

  it("resolves a worktree", async () => {
    const mainDir = path.join(tmpDir, "main-repo");
    fs.mkdirSync(mainDir, { recursive: true });
    const git = simpleGit(mainDir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(mainDir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");

    // Create a worktree
    const worktreeDir = path.join(tmpDir, "my-worktree");
    await git.raw(["worktree", "add", "-b", "feature", worktreeDir]);

    const info = await resolveGitInfo(worktreeDir);
    expect(info).not.toBeNull();
    expect(info!.repoRoot).toBe(fs.realpathSync(worktreeDir));
    expect(info!.repoName).toBe("main-repo");
    expect(info!.branch).toBe("feature");
    expect(info!.isWorktree).toBe(true);
    expect(info!.mainRepoRoot).toBe(fs.realpathSync(mainDir));
  });

  it("resolves from a subdirectory", async () => {
    const repoDir = path.join(tmpDir, "sub-repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const git = simpleGit(repoDir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(repoDir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");

    const subDir = path.join(repoDir, "src", "deep");
    fs.mkdirSync(subDir, { recursive: true });

    const info = await resolveGitInfo(subDir);
    expect(info).not.toBeNull();
    expect(info!.repoRoot).toBe(fs.realpathSync(repoDir));
    expect(info!.branch).toBe("main");
  });

  it("detects detached HEAD", async () => {
    const repoDir = path.join(tmpDir, "detached-repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const git = simpleGit(repoDir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(repoDir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");
    // Detach HEAD
    const hash = (await git.revparse(["HEAD"])).trim();
    await git.checkout(hash);

    const info = await resolveGitInfo(repoDir);
    expect(info).not.toBeNull();
    expect(info!.branch).toBe("HEAD");
  });
});
