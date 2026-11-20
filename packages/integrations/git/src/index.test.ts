import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { testGit } from "./testGit.ts";

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
  _resetSharedConfigWatchers,
  _settledSharedConfigWatchers,
  _sharedConfigWatcherCount,
} from "./config-watcher.ts";
import {
  _resetSharedCwdGitWatchers,
  _settledSharedCwdGitWatchers,
  _sharedCwdGitWatcherCount,
} from "./cwd-git-watcher.ts";
import { SKIP_DARWIN_FSWATCH } from "./fs-watch-delivery.testlib.ts";
import { isInsideWorkTree, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import {
  _resetSharedHeadWatchers,
  _settledSharedHeadWatchers,
  _sharedHeadWatcherCount,
} from "./head-watcher.ts";
import {
  type GitInfo,
  getDiff,
  getStatus,
  gitDiffOutputEqual,
  gitInfoEqual,
  parseNameStatus,
  resolveGitInfo,
  resolveUnder,
  subscribeGitInfo,
  watchGitConfig,
  watchGitHead,
  worktreeCreate,
} from "./index.ts";

async function settleWatchers(): Promise<void> {
  await _settledSharedHeadWatchers();
  await _settledSharedConfigWatchers();
  await _settledSharedCwdGitWatchers();
}

describe("getDiff", () => {
  let tmpDir: string;

  async function initRepo() {
    const dir = path.join(tmpDir, `diff-repo-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const git = testGit(dir);
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
    const diffLines = result.value.hunks
      .join("")
      .split("\n")
      .filter(
        (l) => /^[+-]/.test(l) && !l.startsWith("---") && !l.startsWith("+++"),
      );
    expect(diffLines).toEqual(["+export const b = 2;"]);
  });

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

  it("does not dedupe a binary-to-text classification change", () => {
    expect(
      gitDiffOutputEqual(
        {
          oldFileName: null,
          newFileName: "note.txt",
          hunks: [],
          binary: true,
        },
        {
          oldFileName: null,
          newFileName: "note.txt",
          hunks: [],
          binary: false,
        },
      ),
    ).toBe(false);
  });
});

const ROOT = "/tmp/kolu-test-repo";

describe("resolveUnder", () => {
  describe("accepts paths inside the root", () => {
    it.each([
      ["file.txt", "file.txt"],
      ["dir/file.txt", "dir/file.txt"],
      ["a/b/c/d.txt", "a/b/c/d.txt"],
      ["./file.txt", "file.txt"],
      ["dir//file.txt", path.join("dir", "file.txt")],
      ["dir/./file.txt", path.join("dir", "file.txt")],
      ["dir/../other.txt", "other.txt"],
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
      "/etc/passwd",
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

describe("parseNameStatus", () => {
  it("parses simple M/A/D records", () => {
    const raw = "M\0src/foo.ts\0A\0src/bar.ts\0D\0old.ts\0";
    expect(parseNameStatus(raw)).toEqual([
      { path: "old.ts", status: "D" },
      { path: "src/bar.ts", status: "A" },
      { path: "src/foo.ts", status: "M" },
    ]);
  });

  it("extracts the new path from renames (R<score>)", () => {
    const raw = "R100\0old/path.ts\0new/path.ts\0";
    expect(parseNameStatus(raw)).toEqual([
      { path: "new/path.ts", status: "R", oldPath: "old/path.ts" },
    ]);
  });

  it("extracts the destination from copies (C<score>)", () => {
    const raw = "C075\0src.ts\0dst.ts\0";
    expect(parseNameStatus(raw)).toEqual([
      { path: "dst.ts", status: "C", oldPath: "src.ts" },
    ]);
  });

  it("handles type-change (T) records", () => {
    const raw = "T\0link.txt\0";
    expect(parseNameStatus(raw)).toEqual([{ path: "link.txt", status: "T" }]);
  });

  it("throws on an unrecognized status letter instead of silently bucketing it as untracked", () => {
    const raw = "X\0unknown.txt\0";
    expect(() => parseNameStatus(raw)).toThrow(/unrecognized change-status/i);
  });

  it("returns empty array for empty input", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus("\0")).toEqual([]);
  });

  it("sorts output by path", () => {
    const raw = "M\0z.ts\0M\0a.ts\0M\0m.ts\0";
    expect(parseNameStatus(raw).map((f) => f.path)).toEqual([
      "a.ts",
      "m.ts",
      "z.ts",
    ]);
  });

  it("keeps a path that contains a tab or newline intact (the -z win)", () => {
    // git C-quotes and quote-wraps such a path in text output; `-z` emits it
    // verbatim as a single NUL-delimited token.
    const raw = "A\0wei\trd\nname.md\0M\0plain.ts\0";
    expect(parseNameStatus(raw)).toEqual([
      { path: "plain.ts", status: "M" },
      { path: "wei\trd\nname.md", status: "A" },
    ]);
  });
});

describe("gitInfoEqual", () => {
  const info: GitInfo = {
    repoRoot: "/home/user/repo",
    repoName: "repo",
    worktreePath: "/home/user/repo",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/home/user/repo",
    remoteUrl: null,
    isBare: false,
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

  it.each([
    { field: "repoRoot", value: "/other" },
    { field: "branch", value: "develop" },
    { field: "worktreePath", value: "/other" },
    { field: "remoteUrl", value: "https://github.com/o/r.git" },
    { field: "isBare", value: true },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(gitInfoEqual(info, { ...info, [field]: value })).toBe(false);
  });

  it.each([
    { field: "repoName", value: "other" },
    { field: "isWorktree", value: true },
  ] as const)("ignores $field differences", ({ field, value }) => {
    expect(gitInfoEqual(info, { ...info, [field]: value })).toBe(true);
  });
});

describe("resolveGitInfo", () => {
  let tmpDir: string;

  async function initRepo(name: string, branch = "main") {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const git = testGit(dir);
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
    expect(result.value.isBare).toBe(false);
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
    expect(result.value.isBare).toBe(false);
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
    const dir = path.join(tmpDir, "plain-bare");
    fs.mkdirSync(dir, { recursive: true });
    await testGit(dir).init(true);

    const result = await resolveGitInfo(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repoName).toBe("plain-bare");
    expect(result.value.repoRoot).toBe(fs.realpathSync(dir));
    expect(result.value.mainRepoRoot).toBe(fs.realpathSync(dir));
    expect(result.value.isBare).toBe(true);
  });

  it("resolves a bare repo with .git-suffix convention", async () => {
    const dir = path.join(tmpDir, "suffixed.git");
    fs.mkdirSync(dir, { recursive: true });
    await testGit(dir).init(true);

    const result = await resolveGitInfo(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repoName).toBe("suffixed");
    expect(result.value.repoRoot).toBe(fs.realpathSync(dir));
    expect(result.value.isBare).toBe(true);
  });

  it("resolves a sibling of a `.git` bare repo (project-layout)", async () => {
    const proj = path.join(tmpDir, "proj");
    const gitDir = path.join(proj, ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    await testGit(gitDir).init(true);
    const sibling = path.join(proj, ".worktrees");
    fs.mkdirSync(sibling, { recursive: true });

    const result = await resolveGitInfo(sibling);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repoName).toBe("proj");
    expect(result.value.repoName).not.toBe(".worktrees");
    expect(result.value.mainRepoRoot).toBe(fs.realpathSync(proj));
    expect(result.value.isBare).toBe(true);
    const watcherAnswer = await isInsideWorkTree(result.value.repoRoot);
    expect(watcherAnswer).toEqual({ ok: true, value: false });
  });
});

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
    const git = testGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");

    fs.writeFileSync(path.join(dir, "tracked.txt"), "initial\n");
    await git.add("tracked.txt");
    await git.commit("add tracked file");

    fs.writeFileSync(path.join(dir, "tracked.txt"), "modified\n");

    fs.writeFileSync(path.join(dir, "untracked.txt"), "new\n");

    const result = await getStatus(dir, "local");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.value.files.map((f) => f.path);
    expect(paths).toContain("tracked.txt");
    expect(paths).toContain("untracked.txt");

    const tracked = result.value.files.find((f) => f.path === "tracked.txt");
    const untracked = result.value.files.find(
      (f) => f.path === "untracked.txt",
    );
    expect(tracked?.status).toBe("M");
    expect(untracked?.status).toBe("?");
  });
});

describe("worktreeCreate", () => {
  let tmpDir: string;
  let templateDir: string;
  let templateBare: string;
  let firstMainCommit: string;
  let latestMainCommit: string;

  beforeAll(async () => {
    templateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-template-"));
    const seedDir = path.join(templateDir, "seed");
    templateBare = path.join(templateDir, "bare.git");
    fs.mkdirSync(seedDir);
    const seedGit = testGit(seedDir);
    await seedGit.init();
    await seedGit.raw(["checkout", "-b", "master"]);
    fs.writeFileSync(path.join(seedDir, "README.md"), "init");
    await seedGit.add(".");
    await seedGit.commit("initial commit");
    await seedGit.raw(["checkout", "-b", "main"]);
    fs.writeFileSync(path.join(seedDir, "new-file.txt"), "main branch");
    await seedGit.add(".");
    await seedGit.commit("commit on main");
    firstMainCommit = (await seedGit.revparse(["HEAD"])).trim();
    fs.writeFileSync(path.join(seedDir, "new-file.txt"), "new content");
    await seedGit.add(".");
    await seedGit.commit("new commit");
    latestMainCommit = (await seedGit.revparse(["HEAD"])).trim();
    await seedGit.raw(["clone", "--bare", seedDir, templateBare]);
    await testGit(templateBare).raw([
      "update-ref",
      "refs/test/main-first",
      firstMainCommit,
    ]);
  });

  afterAll(() => {
    fs.rmSync(templateDir, { recursive: true, force: true });
  });

  async function setupRepos(defaultBranch = "main") {
    const bareDir = path.join(tmpDir, "bare.git");
    const cloneDir = path.join(tmpDir, "clone");
    fs.cpSync(templateBare, bareDir, { recursive: true });
    const bareGit = testGit(bareDir);
    if (defaultBranch === "master") {
      await bareGit.raw(["update-ref", "-d", "refs/heads/main"]);
      await bareGit.raw(["symbolic-ref", "HEAD", "refs/heads/master"]);
    } else {
      await bareGit.raw(["update-ref", "refs/heads/main", firstMainCommit]);
      await bareGit.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);
    }
    await testGit().clone(bareDir, cloneDir);
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

    const bareGit = testGit(repos.bareDir);
    await bareGit.raw([
      "update-ref",
      "refs/heads/main",
      "refs/test/main-first",
    ]);
    await bareGit.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);

    const result = await worktreeCreate(repos.cloneDir, "feat-default");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branch).toBe("feat-default");

    const worktreeGit = testGit(result.value.path);
    const worktreeHead = (await worktreeGit.revparse(["HEAD"])).trim();
    expect(worktreeHead).toBe(firstMainCommit);

    await testGit(repos.cloneDir).raw([
      "worktree",
      "remove",
      result.value.path,
      "--force",
    ]);
  });

  it("creates worktree from latest origin commit, not stale local ref", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-test-"));
    const repos = await setupRepos();

    await testGit(repos.bareDir).raw([
      "update-ref",
      "refs/heads/main",
      latestMainCommit,
    ]);

    const cloneGit = testGit(repos.cloneDir);
    const staleCommit = (await cloneGit.revparse(["origin/main"])).trim();
    expect(staleCommit).not.toBe(latestMainCommit);

    const result = await worktreeCreate(repos.cloneDir, "feat-fresh");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const worktreeGit = testGit(result.value.path);
    const worktreeHead = (await worktreeGit.revparse(["HEAD"])).trim();
    expect(worktreeHead).toBe(latestMainCommit);

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

    await testGit(repos.cloneDir).raw([
      "worktree",
      "remove",
      first.value.path,
      "--force",
    ]);
  });
});

describe("watchGitHead", () => {
  let tmpDir: string;

  function initRepo(name: string) {
    const dir = path.join(tmpDir, name);
    const gitDir = path.join(dir, ".git");
    fs.mkdirSync(path.join(gitDir, "objects"), { recursive: true });
    fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(
      path.join(gitDir, "config"),
      "[core]\n\trepositoryformatversion = 0\n\tbare = false\n",
    );
    const git = testGit(dir);
    return { dir, git, gitDir };
  }

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
    _resetSharedHeadWatchers();
  });

  afterEach(() => {
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  it("returns a no-op for non-git directories", async () => {
    const dir = path.join(tmpDir, "no-git");
    fs.mkdirSync(dir, { recursive: true });
    const stop = watchGitHead(dir, "test", () => {});
    await settleWatchers();
    expect(_sharedHeadWatcherCount()).toBe(0);
    stop();
  });

  it("two subscribers in the same repo share one fs.watch entry", async () => {
    const { dir } = await initRepo("shared-one-repo");
    const stop1 = watchGitHead(dir, "test", () => {});
    const stop2 = watchGitHead(dir, "test", () => {});
    await settleWatchers();
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop1();
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop2();
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  it("two subscribers from different cwds in the same repo also share", async () => {
    const { dir } = await initRepo("shared-subdir-repo");
    const sub = path.join(dir, "src", "deep");
    fs.mkdirSync(sub, { recursive: true });

    const stop1 = watchGitHead(dir, "test", () => {});
    const stop2 = watchGitHead(sub, "test", () => {});
    await settleWatchers();
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop1();
    stop2();
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  it("different repos get independent shared watchers", async () => {
    const a = await initRepo("repo-a");
    const b = await initRepo("repo-b");
    const stopA = watchGitHead(a.dir, "test", () => {});
    const stopB = watchGitHead(b.dir, "test", () => {});
    await settleWatchers();
    expect(_sharedHeadWatcherCount()).toBe(2);
    stopA();
    stopB();
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  it("double-cleanup from the same subscriber is a safe no-op", async () => {
    const { dir } = await initRepo("idempotent-repo");
    const stop1 = watchGitHead(dir, "test", () => {});
    const stop2 = watchGitHead(dir, "test", () => {});
    await settleWatchers();
    stop1();
    stop1();
    expect(_sharedHeadWatcherCount()).toBe(1);
    stop2();
    expect(_sharedHeadWatcherCount()).toBe(0);
  });

  /** FSEvents on darwin coalesces and can take seconds to deliver a change
   *  event under load, so each attempt re-touches HEAD to force another. */
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
      const stopA = watchGitHead(dir, "test", () => {
        aFires++;
      });
      const stopB = watchGitHead(dir, "test", () => {
        bFires++;
      });
      await settleWatchers();
      expect(_sharedHeadWatcherCount()).toBe(1);

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
      const stopA = watchGitHead(dir, "test", () => {
        throw new Error("boom");
      });
      const stopB = watchGitHead(dir, "test", () => {
        bFires++;
      });
      await settleWatchers();

      await git.checkoutLocalBranch("feature");
      await waitForHeadEvent(() => bFires > 0, gitDir);

      expect(bFires).toBeGreaterThan(0);
      stopA();
      stopB();
      expect(_sharedHeadWatcherCount()).toBe(0);
    },
  );
});

describe("watchGitConfig", () => {
  let tmpDir: string;

  async function initRepo(name: string) {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const git = testGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(dir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");
    return { dir, git };
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-config-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    _resetSharedConfigWatchers();
  });

  afterEach(() => {
    expect(_sharedConfigWatcherCount()).toBe(0);
  });

  it("returns a no-op for non-git directories", async () => {
    const dir = path.join(tmpDir, "no-git");
    fs.mkdirSync(dir, { recursive: true });
    const stop = watchGitConfig(dir, "test", () => {});
    await settleWatchers();
    expect(_sharedConfigWatcherCount()).toBe(0);
    stop();
  });

  it("refcount goes 0→1→0 across subscribe/unsubscribe", async () => {
    const { dir } = await initRepo("config-refcount");
    expect(_sharedConfigWatcherCount()).toBe(0);
    const stop = watchGitConfig(dir, "test", () => {});
    await settleWatchers();
    expect(_sharedConfigWatcherCount()).toBe(1);
    stop();
    expect(_sharedConfigWatcherCount()).toBe(0);
  });

  it("worktrees of the same repo collapse to one config handle", async () => {
    const { dir, git } = await initRepo("config-shared-repo");
    const worktreeDir = path.join(tmpDir, "config-shared-worktree");
    await git.raw(["worktree", "add", "-b", "feature", worktreeDir]);

    const stopMain = watchGitConfig(dir, "test", () => {});
    const stopWorktree = watchGitConfig(worktreeDir, "test", () => {});
    await settleWatchers();
    expect(_sharedConfigWatcherCount()).toBe(1);
    stopMain();
    expect(_sharedConfigWatcherCount()).toBe(1);
    stopWorktree();
    expect(_sharedConfigWatcherCount()).toBe(0);
  });
});

describe.skipIf(SKIP_DARWIN_FSWATCH)("subscribeGitInfo dual watcher", () => {
  let tmpDir: string;

  async function initRepo(name: string) {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const git = testGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(dir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");
    return { dir, git };
  }

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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-dual-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    _resetSharedHeadWatchers();
    _resetSharedConfigWatchers();
  });

  afterEach(() => {
    expect(_sharedHeadWatcherCount()).toBe(0);
    expect(_sharedConfigWatcherCount()).toBe(0);
  });

  it("in-repo subscribe installs HEAD + config, stop retires both", async () => {
    const { dir } = await initRepo("dual-in-repo");

    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(dir, "test", (info) => {
      updates.push(info);
    });

    await settleWatchers();
    expect(_sharedHeadWatcherCount()).toBe(1);
    expect(_sharedConfigWatcherCount()).toBe(1);

    await waitFor(() => updates.length >= 1);

    sub.stop();

    expect(_sharedHeadWatcherCount()).toBe(0);
    expect(_sharedConfigWatcherCount()).toBe(0);
  });
});

describe.skipIf(SKIP_DARWIN_FSWATCH)("subscribeGitInfo watcher churn", () => {
  let tmpDir: string;

  async function initRepo(name: string) {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const git = testGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(dir, "file.txt"), "hello");
    await git.add(".");
    await git.commit("initial");
    return { dir, git };
  }

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
    _resetSharedHeadWatchers();
    _resetSharedConfigWatchers();
    _resetSharedCwdGitWatchers();
  });

  afterEach(() => {
    expect(_sharedHeadWatcherCount()).toBe(0);
    expect(_sharedConfigWatcherCount()).toBe(0);
    expect(_sharedCwdGitWatcherCount()).toBe(0);
  });

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

  it("setCwd into a git repo installs the watcher exactly once", async () => {
    const nonGitDir = path.join(tmpDir, "not-a-repo");
    fs.mkdirSync(nonGitDir, { recursive: true });
    const { dir: repoDir } = await initRepo("cd-target");

    const counter = makeLog();
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      nonGitDir,
      "test",
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    sub.setCwd(repoDir);

    await waitFor(() => updates.length >= 1);
    expect(updates[0]?.repoRoot).toBe(fs.realpathSync(repoDir));

    await settleWatchers();
    sub.stop();

    expect(counter.installs).toBe(1);
    expect(counter.retires).toBe(1);
  });

  it("publishes the first answer outside a repo, then only changes", async () => {
    const dir = path.join(tmpDir, "first-answer-not-a-repo");
    fs.mkdirSync(dir, { recursive: true });

    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(dir, "test", (info) => {
      updates.push(info);
    });

    await waitFor(() => updates.length >= 1);
    expect(updates).toEqual([null]);

    const other = path.join(tmpDir, "first-answer-other");
    fs.mkdirSync(other, { recursive: true });
    sub.setCwd(other);
    await settleWatchers();
    await new Promise((r) => setTimeout(r, 300));
    expect(updates).toEqual([null]);

    await settleWatchers();
    sub.stop();
  });

  it("publishes nothing when git fails for a reason other than not-a-repo", async () => {
    const gone = path.join(tmpDir, "first-answer-gone");
    const errors: string[] = [];
    const log = {
      info() {},
      debug() {},
      warn() {},
      error(_obj: unknown, msg: string) {
        errors.push(msg);
      },
    };
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      gone,
      "test",
      (info) => {
        updates.push(info);
      },
      log,
    );

    await waitFor(() => errors.includes("git resolution failed"));
    await settleWatchers();
    expect(updates).toEqual([]);

    sub.stop();
  });

  it("detects `git init` in the current cwd without an OSC 7 setCwd", async () => {
    const dir = path.join(tmpDir, "git-init-osc7-less");
    fs.mkdirSync(dir, { recursive: true });

    const counter = makeLog();
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      dir,
      "test",
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    await settleWatchers();
    expect(counter.installs).toBe(0);
    expect(counter.cwdInstalls).toBe(1);

    const git = testGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(dir, "f.txt"), "x");
    await git.add(".");
    await git.commit("initial");

    await waitFor(() => updates.some((u) => u !== null), 3000);
    expect(updates[0]).toBeNull();
    expect(updates.find((u) => u !== null)?.repoRoot).toBe(
      fs.realpathSync(dir),
    );

    await settleWatchers();
    sub.stop();

    expect(counter.installs).toBe(1);
    expect(counter.retires).toBe(1);
    expect(counter.cwdRetires).toBe(1);
  });

  it("setCwd defense-in-depth still works if the cwd watcher missed the event", async () => {
    const dir = path.join(tmpDir, "git-init-via-setcwd");
    fs.mkdirSync(dir, { recursive: true });

    const counter = makeLog();
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      dir,
      "test",
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    const git = testGit(dir);
    await git.init();
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(dir, "f.txt"), "x");
    await git.add(".");
    await git.commit("initial");

    sub.setCwd(dir);

    await waitFor(() => updates.some((u) => u !== null));
    expect(updates.find((u) => u !== null)?.repoRoot).toBe(
      fs.realpathSync(dir),
    );

    await settleWatchers();
    sub.stop();

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
      "test",
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    await settleWatchers();
    expect(counter.installs).toBe(1);

    await waitFor(() => updates.length >= 1);

    sub.setCwd(b.dir);
    await waitFor(() => updates.length >= 2);

    await settleWatchers();
    sub.stop();

    expect(counter.installs).toBe(2);
    expect(counter.retires).toBe(2);
  });

  it("stop() during an in-flight resolve does not reinstall the watcher", async () => {
    const { dir, git } = await initRepo("stop-race");

    const counter = makeLog();
    const updates: (GitInfo | null)[] = [];
    const sub = subscribeGitInfo(
      dir,
      "test",
      (info) => {
        updates.push(info);
      },
      counter.log,
    );

    await waitFor(() => updates.length >= 1);
    await settleWatchers();

    await git.checkoutLocalBranch("other");
    await new Promise((r) => setTimeout(r, WATCHER_DEBOUNCE_MS + 20));
    sub.stop();

    await new Promise((r) => setTimeout(r, 300));

    expect(_sharedHeadWatcherCount()).toBe(0);
    expect(counter.installs).toBe(counter.retires);
  });
});
