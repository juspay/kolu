import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";

/** Tests in this file that gate on `fs.watch` event delivery are
 *  unreliable on darwin — FSEvents coalesces and can take >12s to
 *  deliver a single change under contention. The dispatcher logic
 *  itself (snapshot + try/catch per listener, in
 *  `@kolu/dir-watch/refcounted-dir-watcher.ts:96-106`) is verified by
 *  linux+inotify CI on every commit; the darwin skips here only avoid
 *  the platform layer's non-determinism. Local darwin devs also skip
 *  these — running them on a busy laptop produces false negatives.
 *  Tracked: juspay/kolu#320 for a proper fix (test seam or polling
 *  fallback in the production watcher path). */
const SKIP_DARWIN_FSWATCH = process.platform === "darwin";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  type GitInfo,
  getDiff,
  getStatus,
  gitInfoEqual,
  parseNameStatus,
  resolveGitInfo,
  resolveUnder,
  subscribeGitInfo,
  watchGitHead,
  worktreeCreate,
} from "./index.ts";
import {
  _resetSharedCwdGitWatchers,
  _sharedCwdGitWatcherCount,
} from "./cwd-git-watcher.ts";
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import {
  _resetSharedHeadWatchers,
  _sharedHeadWatcherCount,
} from "./head-watcher.ts";

// --- getDiff: renames ---

describe("getDiff", () => {
  let tmpDir: string;

  async function initRepo() {
    const dir = path.join(tmpDir, `diff-repo-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const git = simpleGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    return { dir, git };
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-diff-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pure rename: old path and content, no diff hunks", async () => {
    const { dir, git } = await initRepo();
    const content = "export const x = 1;\n";

    fs.writeFileSync(path.join(dir, "old-name.ts"), content);
    await git.add("old-name.ts");
    await git.commit("add old-name.ts");

    await git.raw(["mv", "old-name.ts", "new-name.ts"]);

    const result = await getDiff(
      dir,
      "new-name.ts",
      "local",
      undefined,
      "old-name.ts",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.oldFileName).toBe("old-name.ts");
    expect(result.value.newFileName).toBe("new-name.ts");
    // No content change — hunks contain the rename header but no +/- lines.
    const diffLines = result.value.hunks
      .join("")
      .split("\n")
      .filter(
        (l) => /^[+-]/.test(l) && !l.startsWith("---") && !l.startsWith("+++"),
      );
    expect(diffLines).toEqual([]);
  });

  it("rename + edit: old path and content, hunks show only the delta", async () => {
    const { dir, git } = await initRepo();

    fs.writeFileSync(path.join(dir, "utils.ts"), "export const a = 1;\n");
    await git.add("utils.ts");
    await git.commit("add utils.ts");

    fs.mkdirSync(path.join(dir, "lib"));
    await git.raw(["mv", "utils.ts", "lib/utils.ts"]);
    fs.writeFileSync(
      path.join(dir, "lib", "utils.ts"),
      "export const a = 1;\nexport const b = 2;\n",
    );

    const result = await getDiff(
      dir,
      "lib/utils.ts",
      "local",
      undefined,
      "utils.ts",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.oldFileName).toBe("utils.ts");
    expect(result.value.newFileName).toBe("lib/utils.ts");
    // Hunks should show only the added line, not the entire file as an addition.
    // Extract the meaningful diff lines (skip headers, no-newline markers).
    const diffLines = result.value.hunks
      .join("")
      .split("\n")
      .filter(
        (l) => /^[+-]/.test(l) && !l.startsWith("---") && !l.startsWith("+++"),
      );
    expect(diffLines).toEqual(["+export const b = 2;"]);
  });

  /** Bytes guaranteed to trigger git's binary detection — NUL at byte 4. */
  const BINARY_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);

  it("modified binary file: binary=true, hunks empty", async () => {
    const { dir, git } = await initRepo();

    fs.writeFileSync(path.join(dir, "image.png"), BINARY_BYTES);
    await git.add("image.png");
    await git.commit("add binary");

    fs.writeFileSync(
      path.join(dir, "image.png"),
      Buffer.concat([BINARY_BYTES, BINARY_BYTES]),
    );

    const result = await getDiff(dir, "image.png", "local");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.binary).toBe(true);
    expect(result.value.hunks).toEqual([]);
    expect(result.value.newFileName).toBe("image.png");
  });

  it("untracked binary file: binary=true via --no-index", async () => {
    const { dir, git } = await initRepo();
    // Need an initial commit so HEAD exists.
    fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
    await git.add("seed.txt");
    await git.commit("seed");

    fs.writeFileSync(path.join(dir, "blob.bin"), BINARY_BYTES);

    const result = await getDiff(dir, "blob.bin", "local");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.binary).toBe(true);
    expect(result.value.hunks).toEqual([]);
  });

  it("text file: binary=false", async () => {
    const { dir, git } = await initRepo();

    fs.writeFileSync(path.join(dir, "readme.txt"), "hello\n");
    await git.add("readme.txt");
    await git.commit("add text");

    fs.writeFileSync(path.join(dir, "readme.txt"), "hello\nworld\n");

    const result = await getDiff(dir, "readme.txt", "local");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.binary).toBe(false);
    expect(result.value.hunks.length).toBe(1);
  });
});

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
      { path: "new/path.ts", status: "R", oldPath: "old/path.ts" },
    ]);
  });

  it("extracts the destination from copies (C<score>)", () => {
    const raw = "C075\tsrc.ts\tdst.ts\n";
    expect(parseNameStatus(raw)).toEqual([
      { path: "dst.ts", status: "C", oldPath: "src.ts" },
    ]);
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

// --- getStatus: untracked files (#552) ---

describe("getStatus local mode includes untracked files alongside tracked changes", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-status-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns both modified tracked files and untracked files", async () => {
    const dir = path.join(tmpDir, "mixed-status");
    fs.mkdirSync(dir, { recursive: true });
    const git = simpleGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");

    // Create and commit a tracked file
    fs.writeFileSync(path.join(dir, "tracked.txt"), "initial\n");
    await git.add("tracked.txt");
    await git.commit("add tracked file");

    // Modify the tracked file (unstaged)
    fs.writeFileSync(path.join(dir, "tracked.txt"), "modified\n");

    // Create an untracked file
    fs.writeFileSync(path.join(dir, "untracked.txt"), "new\n");

    const result = await getStatus(dir, "local");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.value.files.map((f) => f.path);
    expect(paths).toContain("tracked.txt");
    expect(paths).toContain("untracked.txt");

    // Verify statuses
    const tracked = result.value.files.find((f) => f.path === "tracked.txt");
    const untracked = result.value.files.find(
      (f) => f.path === "untracked.txt",
    );
    expect(tracked?.status).toBe("M");
    expect(untracked?.status).toBe("?");
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

    const result = await worktreeCreate(repos.cloneDir, "feat-default");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branch).toBe("feat-default");

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

    const result = await worktreeCreate(repos.cloneDir, "feat-fresh");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const worktreeGit = simpleGit(result.value.path);
    const worktreeHead = (await worktreeGit.revparse(["HEAD"])).trim();
    expect(worktreeHead).toBe(latestCommit);

    await cloneGit.raw(["worktree", "remove", result.value.path, "--force"]);
  });

  it("returns WORKTREE_NAME_COLLISION when the branch already exists", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-test-"));
    const repos = await setupRepos();

    const first = await worktreeCreate(repos.cloneDir, "shared-name");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await worktreeCreate(repos.cloneDir, "shared-name");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("WORKTREE_NAME_COLLISION");

    await simpleGit(repos.cloneDir).raw([
      "worktree",
      "remove",
      first.value.path,
      "--force",
    ]);
  });
});

// --- watchGitHead: shared refcounted watcher (#748) ---

describe("watchGitHead", () => {
  let tmpDir: string;

  /** Create a git repo with one commit and return its path + .git absolute path. */
  async function initRepo(name: string) {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const git = simpleGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(dir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");
    return { dir, git, gitDir: path.join(dir, ".git") };
  }

  /** Wait until `predicate` returns true or `timeout` elapses. Polls so we
   *  pick up real fs.watch events rather than guessing at a fixed sleep. */
  async function waitFor(
    predicate: () => boolean,
    timeout = 2000,
  ): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(
      `waitFor: predicate did not become true within ${timeout}ms`,
    );
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-watch-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Hard-reset the module-scope registry so a previous test that timed
    // out (and never reached its `stop*()` calls) cannot leak into this
    // one. Without this, a single 5s vitest timeout cascades into every
    // following test's afterEach (#955).
    _resetSharedHeadWatchers();
  });

  afterEach(() => {
    // Defensive: any test that leaks a subscription would skew the count
    // for the next test. The `beforeEach` above keeps the count truthful
    // even when a test fails — the assertion below is still the place a
    // *clean* test surfaces a real leak.
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  it("returns a no-op for non-git directories", () => {
    const dir = path.join(tmpDir, "no-git");
    fs.mkdirSync(dir, { recursive: true });
    const stop = watchGitHead(dir, () => {});
    expect(_sharedHeadWatcherCount()).toBe(0);
    stop(); // must not throw
  });

  it("two subscribers in the same repo share one fs.watch entry", async () => {
    const { dir } = await initRepo("shared-one-repo");
    const stop1 = watchGitHead(dir, () => {});
    const stop2 = watchGitHead(dir, () => {});
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop1();
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop2();
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  it("two subscribers from different cwds in the same repo also share", async () => {
    // Issue scope: terminals open in different subdirs of the same repo
    // must dedupe to one watcher.
    const { dir } = await initRepo("shared-subdir-repo");
    const sub = path.join(dir, "src", "deep");
    fs.mkdirSync(sub, { recursive: true });

    const stop1 = watchGitHead(dir, () => {});
    const stop2 = watchGitHead(sub, () => {});
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop1();
    stop2();
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  it("different repos get independent shared watchers", async () => {
    const a = await initRepo("repo-a");
    const b = await initRepo("repo-b");
    const stopA = watchGitHead(a.dir, () => {});
    const stopB = watchGitHead(b.dir, () => {});
    expect(_sharedHeadWatcherCount()).toBe(2);
    stopA();
    stopB();
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  it("a fresh subscribe after teardown installs a new watcher", async () => {
    const { dir } = await initRepo("rebuild-repo");
    const stop1 = watchGitHead(dir, () => {});
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop1();
    expect(_sharedHeadWatcherCount()).toBe(0);
    const stop2 = watchGitHead(dir, () => {});
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop2();
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  it("double-cleanup from the same subscriber is a safe no-op", async () => {
    const { dir } = await initRepo("idempotent-repo");
    const stop1 = watchGitHead(dir, () => {});
    const stop2 = watchGitHead(dir, () => {});
    stop1();
    stop1(); // must not double-tear-down or affect stop2's subscription
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop2();
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  /** Wait for an fs.watch-driven predicate, re-touching HEAD between
   *  attempts. FSEvents on darwin coalesces and can take seconds to
   *  deliver under load — a single fixed `waitFor` budget races that
   *  latency and produces the `watchGitHead` darwin-only flake tracked
   *  in #320. Each attempt waits up to `perAttemptMs` for the predicate;
   *  if it doesn't fire, the next iteration rewrites HEAD to force
   *  another change event. Up to 6 attempts × 2s = 12s overall budget. */
  async function waitForHeadEvent(
    predicate: () => boolean,
    gitDir: string,
    perAttemptMs = 2000,
    attempts = 6,
  ): Promise<void> {
    const head = path.join(gitDir, "HEAD");
    for (let i = 0; i < attempts; i++) {
      try {
        await waitFor(predicate, perAttemptMs);
        return;
      } catch {
        if (i === attempts - 1)
          throw new Error("HEAD-event predicate never fired");
        // Re-touch HEAD with its own bytes so fs.watch fires another
        // change event without altering repo state.
        const content = fs.readFileSync(head);
        fs.writeFileSync(head, content);
      }
    }
  }

  it.skipIf(SKIP_DARWIN_FSWATCH)(
    "a HEAD change fans out to every subscriber on the shared watcher",
    async () => {
      const { dir, git, gitDir } = await initRepo("dispatch-repo");
      let aFires = 0;
      let bFires = 0;
      const stopA = watchGitHead(dir, () => {
        aFires++;
      });
      const stopB = watchGitHead(dir, () => {
        bFires++;
      });
      expect(_sharedHeadWatcherCount()).toBe(1);

      // Branch switch rewrites .git/HEAD, which is what we're watching.
      await git.checkoutLocalBranch("feature");

      await waitForHeadEvent(() => aFires > 0 && bFires > 0, gitDir);

      expect(aFires).toBeGreaterThan(0);
      expect(bFires).toBeGreaterThan(0);

      stopA();
      stopB();
      expect(_sharedHeadWatcherCount()).toBe(0);
    },
  );

  it.skipIf(SKIP_DARWIN_FSWATCH)(
    "a listener that throws does not block its peers",
    async () => {
      const { dir, git, gitDir } = await initRepo("fault-isolation-repo");
      let bFires = 0;
      const stopA = watchGitHead(dir, () => {
        throw new Error("boom");
      });
      const stopB = watchGitHead(dir, () => {
        bFires++;
      });

      await git.checkoutLocalBranch("feature");
      await waitForHeadEvent(() => bFires > 0, gitDir);

      expect(bFires).toBeGreaterThan(0);
      stopA();
      stopB();
      expect(_sharedHeadWatcherCount()).toBe(0);
    },
  );
});

// --- subscribeGitInfo: watcher lifecycle invariants (#748 regression) ---

describe.skipIf(SKIP_DARWIN_FSWATCH)("subscribeGitInfo watcher churn", () => {
  let tmpDir: string;

  /** Create a git repo with one commit. */
  async function initRepo(name: string) {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const git = simpleGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(dir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");
    return { dir, git };
  }

  /** Wait until `predicate` returns true or `timeout` elapses. */
  async function waitFor(
    predicate: () => boolean,
    timeout = 2000,
  ): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(
      `waitFor: predicate did not become true within ${timeout}ms`,
    );
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-sub-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // See companion comment in the `watchGitHead` describe — module-scope
    // registry reset breaks the leak-cascade (#955).
    _resetSharedHeadWatchers();
    _resetSharedCwdGitWatchers();
  });

  afterEach(() => {
    expect(_sharedHeadWatcherCount()).toBe(0);
    expect(_sharedCwdGitWatcherCount()).toBe(0);
  });

  /** Tracks watcher install/retire log lines as a vitest-friendly counter. */
  function makeLog() {
    let installs = 0;
    let retires = 0;
    let cwdInstalls = 0;
    let cwdRetires = 0;
    const log = {
      info(_obj: unknown, msg: string) {
        if (msg === "git: head watcher installed") installs++;
        if (msg === "git: head watcher retired") retires++;
        if (msg === "git: cwd watcher installed") cwdInstalls++;
        if (msg === "git: cwd watcher retired") cwdRetires++;
      },
      debug() {},
      warn() {},
      error() {},
    };
    return {
      log,
      get installs() {
        return installs;
      },
      get retires() {
        return retires;
      },
      get cwdInstalls() {
        return cwdInstalls;
      },
      get cwdRetires() {
        return cwdRetires;
      },
    };
  }

  // The lifecycle log surfaced this on real cwd transitions: setCwd to a
  // git repo installed the watcher synchronously, then the async resolve
  // saw `currentInfo === null` and tore down + re-installed at the same
  // gitDir. Two install events and a wasted retire per cd into a repo.
  it("setCwd into a git repo installs the watcher exactly once", async () => {
    const nonGitDir = path.join(tmpDir, "not-a-repo");
    fs.mkdirSync(nonGitDir, { recursive: true });
    const { dir: repoDir } = await initRepo("cd-target");

    const counter = makeLog();
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      nonGitDir,
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    sub.setCwd(repoDir);

    // First update is the GitInfo for repoDir. The initial null→null
    // resolve is deduped via gitInfoEqual and never reaches onChange.
    await waitFor(() => updates.length >= 1);
    expect(updates[0]?.repoRoot).toBe(fs.realpathSync(repoDir));

    sub.stop();

    // The bug: 2 installs + 1 retire on a single cd into a repo, plus
    // 1 retire on stop. The fix: 1 install on cd into the repo,
    // 1 retire on stop. (No watcher on the initial non-git dir.)
    expect(counter.installs).toBe(1);
    expect(counter.retires).toBe(1);
  });

  // `git init` in the cwd a terminal is already sitting in must reach the
  // Code browser and path pill — but the shell doesn't re-emit OSC 7 when
  // cwd hasn't changed, so the provider can't rely on `setCwd` to learn
  // about the new `.git`.
  it("detects `git init` in the current cwd without an OSC 7 setCwd", async () => {
    const dir = path.join(tmpDir, "git-init-osc7-less");
    fs.mkdirSync(dir, { recursive: true });

    const counter = makeLog();
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      dir,
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    // Initial subscribe on a non-git dir installs the cwd watcher, not the
    // HEAD watcher — there's nothing inside `.git/` to watch yet.
    expect(counter.installs).toBe(0);
    expect(counter.cwdInstalls).toBe(1);

    // `git init` (no setCwd / OSC 7 follow-up). The cwd watcher must fire
    // on `.git` appearing, trigger a re-resolve, and swap to the HEAD
    // watcher.
    const git = simpleGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(dir, "f.txt"), "x");
    await git.add(".");
    await git.commit("initial");

    await waitFor(() => updates.length >= 1, 3000);
    expect(updates[0]?.repoRoot).toBe(fs.realpathSync(dir));

    sub.stop();

    expect(counter.installs).toBe(1);
    expect(counter.retires).toBe(1);
    expect(counter.cwdRetires).toBe(1);
  });

  it("setCwd defense-in-depth still works if the cwd watcher missed the event", async () => {
    // Some filesystems (bind-mounted containers, polling fallback) can lose
    // events. A same-cwd setCwd from a downstream caller is the belt-and-
    // braces fallback for that case.
    const dir = path.join(tmpDir, "git-init-via-setcwd");
    fs.mkdirSync(dir, { recursive: true });

    const counter = makeLog();
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      dir,
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    const git = simpleGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(dir, "f.txt"), "x");
    await git.add(".");
    await git.commit("initial");

    // Explicit re-resolve via setCwd. The cwd watcher may also have fired
    // by now; both paths converge on the same end state.
    sub.setCwd(dir);

    await waitFor(() => updates.length >= 1);
    expect(updates[0]?.repoRoot).toBe(fs.realpathSync(dir));

    sub.stop();

    // Even with both paths potentially firing, the HEAD watcher is
    // installed exactly once.
    expect(counter.installs).toBe(1);
    expect(counter.retires).toBe(1);
  });

  it("setCwd between two distinct git repos: 1 install + 1 retire per transition", async () => {
    const a = await initRepo("transition-a");
    const b = await initRepo("transition-b");

    const counter = makeLog();
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      a.dir,
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    // Initial subscribe installed on a's gitDir synchronously.
    expect(counter.installs).toBe(1);

    // Wait for the initial GitInfo to publish before swapping.
    await waitFor(() => updates.length >= 1);

    sub.setCwd(b.dir);
    await waitFor(() => updates.length >= 2);

    sub.stop();

    // Initial install on a + retire on transition + install on b + retire on stop.
    expect(counter.installs).toBe(2);
    expect(counter.retires).toBe(2);
  });

  // Regression: an fs watcher event fires after the test's last awaited
  // update but before `stop()`. The debounced listener calls `resolve()`,
  // which awaits git subprocesses. If `stop()` runs while that resolve is
  // in flight, the resume path would hit `ensureMode("head")` with the
  // watcher slot already null and install a fresh watcher that nobody
  // retires — leaking past the subscription's lifetime. Manifested as a
  // flaky `_sharedHeadWatcherCount() === 0` afterEach failure under CI
  // load.
  it("stop() during an in-flight resolve does not reinstall the watcher", async () => {
    const { dir, git } = await initRepo("stop-race");

    const counter = makeLog();
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      dir,
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    await waitFor(() => updates.length >= 1);

    // Rewrite .git/HEAD to schedule a debounced watcher event. After the
    // debounce window, the listener will call `resolve()`, which then
    // awaits its git subprocesses — that's the window where stop() must
    // make subsequent ensureMode calls into no-ops.
    await git.checkoutLocalBranch("other");
    await new Promise((r) => setTimeout(r, WATCHER_DEBOUNCE_MS + 20));
    sub.stop();

    // Drain any in-flight resolve so a reinstalled watcher (without the
    // stopped gate) would be observable here.
    await new Promise((r) => setTimeout(r, 300));

    expect(_sharedHeadWatcherCount()).toBe(0);
    expect(counter.installs).toBe(counter.retires);
  });
});
