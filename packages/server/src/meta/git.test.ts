import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { simpleGit } from "simple-git";
import { initHostname } from "../hostname.ts";
import { initLog } from "../log.ts";
import { gitInfoEqual, resolveGitInfo } from "./git.ts";
import type { GitInfo } from "kolu-common";

initHostname();
initLog();

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

  /** Create a git repo with one commit on a branch. */
  async function initRepo(name: string, branch = "main") {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const git = simpleGit(dir);
    await git.init();
    await git.checkoutLocalBranch(branch);
    fs.writeFileSync(path.join(dir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");
    return { dir, git };
  }

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
    const { dir } = await initRepo("plain-repo");

    const info = await resolveGitInfo(dir);
    expect(info).not.toBeNull();
    expect(info!.repoRoot).toBe(fs.realpathSync(dir));
    expect(info!.repoName).toBe("plain-repo");
    expect(info!.branch).toBe("main");
    expect(info!.isWorktree).toBe(false);
    expect(info!.mainRepoRoot).toBe(fs.realpathSync(dir));
  });

  it("resolves a worktree", async () => {
    const { dir: mainDir, git } = await initRepo("main-repo");
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
    const { dir } = await initRepo("sub-repo");
    const subDir = path.join(dir, "src", "deep");
    fs.mkdirSync(subDir, { recursive: true });

    const info = await resolveGitInfo(subDir);
    expect(info).not.toBeNull();
    expect(info!.repoRoot).toBe(fs.realpathSync(dir));
    expect(info!.branch).toBe("main");
  });

  it("detects detached HEAD", async () => {
    const { dir, git } = await initRepo("detached-repo");
    const hash = (await git.revparse(["HEAD"])).trim();
    await git.checkout(hash);

    const info = await resolveGitInfo(dir);
    expect(info).not.toBeNull();
    expect(info!.branch).toBe("HEAD");
  });

  it("resolves a bare repo when cwd is the bare dir", async () => {
    // Canonical bare repo: `/tmp/foo` is itself bare; cwd == bare dir.
    const dir = path.join(tmpDir, "plain-bare");
    fs.mkdirSync(dir, { recursive: true });
    await simpleGit(dir).init(true);

    const info = await resolveGitInfo(dir);
    expect(info).not.toBeNull();
    expect(info!.repoName).toBe("plain-bare");
    expect(info!.repoRoot).toBe(fs.realpathSync(dir));
    expect(info!.mainRepoRoot).toBe(fs.realpathSync(dir));
  });

  it("resolves a bare repo with .git-suffix convention", async () => {
    // `/tmp/foo.git` — bare repo dir suffixed with `.git`. Expected
    // repoName strips the suffix.
    const dir = path.join(tmpDir, "suffixed.git");
    fs.mkdirSync(dir, { recursive: true });
    await simpleGit(dir).init(true);

    const info = await resolveGitInfo(dir);
    expect(info).not.toBeNull();
    expect(info!.repoName).toBe("suffixed");
    expect(info!.repoRoot).toBe(fs.realpathSync(dir));
  });

  it("resolves a sibling of a `.git` bare repo (project-layout)", async () => {
    // Project layout: `/tmp/proj/.git` is bare, siblings like
    // `/tmp/proj/.worktrees/` are normal directories. `cd` into a sibling
    // must NOT report the sibling's basename as the repo name — that's
    // how `.worktrees` ended up in the recent-repos palette. The
    // repoName must come from the bare repo's location, not cwd.
    const proj = path.join(tmpDir, "proj");
    const gitDir = path.join(proj, ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    await simpleGit(gitDir).init(true);
    const sibling = path.join(proj, ".worktrees");
    fs.mkdirSync(sibling, { recursive: true });

    const info = await resolveGitInfo(sibling);
    expect(info).not.toBeNull();
    expect(info!.repoName).toBe("proj");
    expect(info!.repoName).not.toBe(".worktrees");
    expect(info!.mainRepoRoot).toBe(fs.realpathSync(proj));
  });
});
