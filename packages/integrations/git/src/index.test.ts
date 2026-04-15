import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { simpleGit } from "simple-git";
import {
  gitInfoEqual,
  resolveGitInfo,
  parseNameStatus,
  resolveUnder,
  worktreeCreate,
  type GitInfo,
} from "./index.ts";

// Mock randomName to return a predictable value
vi.mock("./random-name.ts", () => ({
  randomName: () => "test-worktree",
}));

// --- resolveUnder ---

const ROOT = "/tmp/kolu-test-repo";

describe("resolveUnder", () => {
  describe("accepts paths inside the root", () => {
    it.each([
      ["file.txt", "file.txt"],
      ["dir/file.txt", "dir/file.txt"],
      ["a/b/c/d.txt", "a/b/c/d.txt"],
      // path.resolve normalizes redundant separators / "."
      ["./file.txt", "file.txt"],
      ["dir//file.txt", path.join("dir", "file.txt")],
      ["dir/./file.txt", path.join("dir", "file.txt")],
      // "foo/../bar" normalizes to "bar" — still inside.
      ["dir/../other.txt", "other.txt"],
      // absolute path that *is* inside the root
      [`${ROOT}/inner/file.txt`, path.join("inner", "file.txt")],
    ])("child %j → rel %j", (child, expectedRel) => {
      const result = resolveUnder(ROOT, child);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rel).toBe(expectedRel);
        expect(result.value.abs).toBe(path.resolve(ROOT, child));
      }
    });

    it("returns empty rel when child is the root itself", () => {
      const result = resolveUnder(ROOT, ".");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rel).toBe("");
        expect(result.value.abs).toBe(path.resolve(ROOT));
      }
    });
  });

  describe("rejects paths that escape the root", () => {
    it.each([
      "../escape.txt",
      "../../etc/passwd",
      "dir/../../escape.txt",
      "a/b/../../../out.txt",
      // absolute path outside the root
      "/etc/passwd",
      // sibling directory that shares a name prefix — the classic
      // `startsWith(root + sep)` bug if the check is written wrong.
      // `/tmp/kolu-test-repo-evil` is outside `/tmp/kolu-test-repo`.
      "/tmp/kolu-test-repo-evil/file.txt",
    ])("child %j returns PATH_ESCAPES_ROOT", (child) => {
      const result = resolveUnder(ROOT, child);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
      }
    });
  });

  describe("normalizes the root argument", () => {
    it("accepts a relative root by resolving against cwd", () => {
      const result = resolveUnder(".", "file.txt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.abs).toBe(path.resolve(".", "file.txt"));
      }
    });

    it("accepts a root with a trailing slash", () => {
      const result = resolveUnder(`${ROOT}/`, "inner/file.txt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rel).toBe(path.join("inner", "file.txt"));
      }
    });
  });
});

// --- parseNameStatus ---

describe("parseNameStatus", () => {
  it("parses simple M/A/D lines", () => {
    const raw = "M\tsrc/foo.ts\nA\tsrc/bar.ts\nD\told.ts\n";
    expect(parseNameStatus(raw)).toEqual([
      { path: "old.ts", status: "D" },
      { path: "src/bar.ts", status: "A" },
      { path: "src/foo.ts", status: "M" },
    ]);
  });

  it("extracts the new path from renames (R<score>)", () => {
    const raw = "R100\told/path.ts\tnew/path.ts\n";
    expect(parseNameStatus(raw)).toEqual([
      { path: "new/path.ts", status: "R" },
    ]);
  });

  it("extracts the destination from copies (C<score>)", () => {
    const raw = "C075\tsrc.ts\tdst.ts\n";
    expect(parseNameStatus(raw)).toEqual([{ path: "dst.ts", status: "C" }]);
  });

  it("handles type-change (T) lines", () => {
    const raw = "T\tlink.txt\n";
    expect(parseNameStatus(raw)).toEqual([{ path: "link.txt", status: "T" }]);
  });

  it("falls back to '?' for unknown status letters", () => {
    const raw = "X\tunknown.txt\n";
    expect(parseNameStatus(raw)).toEqual([
      { path: "unknown.txt", status: "?" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus("\n")).toEqual([]);
  });

  it("sorts output by path", () => {
    const raw = "M\tz.ts\nM\ta.ts\nM\tm.ts\n";
    expect(parseNameStatus(raw).map((f) => f.path)).toEqual([
      "a.ts",
      "m.ts",
      "z.ts",
    ]);
  });

  it("skips blank lines in the middle", () => {
    const raw = "M\tfoo.ts\n\nA\tbar.ts\n";
    expect(parseNameStatus(raw)).toEqual([
      { path: "bar.ts", status: "A" },
      { path: "foo.ts", status: "M" },
    ]);
  });
});

// --- gitInfoEqual ---

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

// --- resolveGitInfo ---

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

  it("returns NOT_A_REPO for non-git directory", async () => {
    const dir = path.join(tmpDir, "not-a-repo");
    fs.mkdirSync(dir, { recursive: true });
    const result = await resolveGitInfo(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_A_REPO");
  });

  it("resolves a plain git repo", async () => {
    const { dir } = await initRepo("plain-repo");

    const result = await resolveGitInfo(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repoRoot).toBe(fs.realpathSync(dir));
    expect(result.value.repoName).toBe("plain-repo");
    expect(result.value.branch).toBe("main");
    expect(result.value.isWorktree).toBe(false);
    expect(result.value.mainRepoRoot).toBe(fs.realpathSync(dir));
  });

  it("resolves a worktree", async () => {
    const { dir: mainDir, git } = await initRepo("main-repo");
    const worktreeDir = path.join(tmpDir, "my-worktree");
    await git.raw(["worktree", "add", "-b", "feature", worktreeDir]);

    const result = await resolveGitInfo(worktreeDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repoRoot).toBe(fs.realpathSync(worktreeDir));
    expect(result.value.repoName).toBe("main-repo");
    expect(result.value.branch).toBe("feature");
    expect(result.value.isWorktree).toBe(true);
    expect(result.value.mainRepoRoot).toBe(fs.realpathSync(mainDir));
  });

  it("resolves from a subdirectory", async () => {
    const { dir } = await initRepo("sub-repo");
    const subDir = path.join(dir, "src", "deep");
    fs.mkdirSync(subDir, { recursive: true });

    const result = await resolveGitInfo(subDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repoRoot).toBe(fs.realpathSync(dir));
    expect(result.value.branch).toBe("main");
  });

  it("detects detached HEAD", async () => {
    const { dir, git } = await initRepo("detached-repo");
    const hash = (await git.revparse(["HEAD"])).trim();
    await git.checkout(hash);

    const result = await resolveGitInfo(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branch).toBe("HEAD");
  });

  it("resolves a bare repo when cwd is the bare dir", async () => {
    // Canonical bare repo: `/tmp/foo` is itself bare; cwd == bare dir.
    const dir = path.join(tmpDir, "plain-bare");
    fs.mkdirSync(dir, { recursive: true });
    await simpleGit(dir).init(true);

    const result = await resolveGitInfo(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repoName).toBe("plain-bare");
    expect(result.value.repoRoot).toBe(fs.realpathSync(dir));
    expect(result.value.mainRepoRoot).toBe(fs.realpathSync(dir));
  });

  it("resolves a bare repo with .git-suffix convention", async () => {
    // `/tmp/foo.git` — bare repo dir suffixed with `.git`. Expected
    // repoName strips the suffix.
    const dir = path.join(tmpDir, "suffixed.git");
    fs.mkdirSync(dir, { recursive: true });
    await simpleGit(dir).init(true);

    const result = await resolveGitInfo(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repoName).toBe("suffixed");
    expect(result.value.repoRoot).toBe(fs.realpathSync(dir));
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

    const result = await resolveGitInfo(sibling);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repoName).toBe("proj");
    expect(result.value.repoName).not.toBe(".worktrees");
    expect(result.value.mainRepoRoot).toBe(fs.realpathSync(proj));
  });
});

// --- worktreeCreate ---

describe("worktreeCreate", () => {
  let tmpDir: string;

  /** Create a bare repo with one commit on a given branch, clone it. */
  async function setupRepos(defaultBranch = "main") {
    const bareDir = path.join(tmpDir, "bare.git");
    const cloneDir = path.join(tmpDir, "clone");
    const seedDir = path.join(tmpDir, "seed");
    fs.mkdirSync(seedDir);
    const seedGit = simpleGit(seedDir);
    await seedGit.init();
    await seedGit.raw(["checkout", "-b", defaultBranch]);
    fs.writeFileSync(path.join(seedDir, "README.md"), "init");
    await seedGit.add(".");
    await seedGit.commit("initial commit");
    await seedGit.raw(["clone", "--bare", seedDir, bareDir]);
    await simpleGit().clone(bareDir, cloneDir);
    return { bareDir, cloneDir };
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses latest remote HEAD after remote changes its default branch", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-test-"));
    const repos = await setupRepos("master");

    // Change bare repo's default branch to "main"
    const bareGit = simpleGit(repos.bareDir);
    const pusherDir = path.join(tmpDir, "pusher");
    await simpleGit().clone(repos.bareDir, pusherDir);
    const pusherGit = simpleGit(pusherDir);
    await pusherGit.raw(["checkout", "-b", "main"]);
    fs.writeFileSync(path.join(pusherDir, "new-file.txt"), "main branch");
    await pusherGit.add(".");
    await pusherGit.commit("commit on main");
    await pusherGit.push("origin", "main");
    const mainHead = (await pusherGit.revparse(["HEAD"])).trim();

    await bareGit.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);

    const result = await worktreeCreate(repos.cloneDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const worktreeGit = simpleGit(result.value.path);
    const worktreeHead = (await worktreeGit.revparse(["HEAD"])).trim();
    expect(worktreeHead).toBe(mainHead);

    await simpleGit(repos.cloneDir).raw([
      "worktree",
      "remove",
      result.value.path,
      "--force",
    ]);
  });

  it("creates worktree from latest origin commit, not stale local ref", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-test-"));
    const repos = await setupRepos();

    // Push a new commit to bare (simulating someone else pushing)
    const pusherDir = path.join(tmpDir, "pusher");
    await simpleGit().clone(repos.bareDir, pusherDir);
    const pusherGit = simpleGit(pusherDir);
    fs.writeFileSync(path.join(pusherDir, "new-file.txt"), "new content");
    await pusherGit.add(".");
    await pusherGit.commit("new commit");
    await pusherGit.push("origin", "main");
    const latestCommit = (await pusherGit.revparse(["HEAD"])).trim();

    const cloneGit = simpleGit(repos.cloneDir);
    const staleCommit = (await cloneGit.revparse(["origin/main"])).trim();
    expect(staleCommit).not.toBe(latestCommit);

    const result = await worktreeCreate(repos.cloneDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const worktreeGit = simpleGit(result.value.path);
    const worktreeHead = (await worktreeGit.revparse(["HEAD"])).trim();
    expect(worktreeHead).toBe(latestCommit);

    await cloneGit.raw(["worktree", "remove", result.value.path, "--force"]);
  });
});
