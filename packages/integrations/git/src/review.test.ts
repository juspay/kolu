import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDiff, getStatus } from "./review.ts";

describe("getDiff path authority", () => {
  let repo: string;
  let outside: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-repo-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-outside-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("rejects a repo-local symlink escaping the root before the --no-index fallback reads it", async () => {
    const secret = path.join(outside, "secret.txt");
    fs.writeFileSync(secret, "TOP SECRET\n");
    fs.symlinkSync(secret, path.join(repo, "leak.txt"));

    const result = await getDiff(repo, "leak.txt", "local");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("still rejects lexical traversal", async () => {
    const result = await getDiff(repo, "../../etc/passwd", "local");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("renders a tracked symlink pointing outside the repo (pathspec, never read off disk)", async () => {
    // A tracked symlink is diffed via `git diff HEAD -- <rel>`, where `rel` is
    // a pathspec git resolves against the tree — it never dereferences the
    // working-tree link.
    const secret = path.join(outside, "secret.txt");
    fs.writeFileSync(secret, "TOP SECRET\n");

    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.checkoutLocalBranch("main");
    fs.symlinkSync(secret, path.join(repo, "link"));
    await git.add("link");
    await git.commit("add link");
    fs.rmSync(path.join(repo, "link"));
    fs.symlinkSync(path.join(outside, "other.txt"), path.join(repo, "link"));

    const result = await getDiff(repo, "link", "local");
    expect(result.ok).toBe(true);
  });
});

describe("getStatus branch mode — no resolvable base", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-nobase-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("degrades gracefully on a fresh repo with no remote and no commits (issue #1244)", async () => {
    await simpleGit(repo).init();

    const result = await getStatus(repo, "branch");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe("branch");
    if (result.value.mode !== "branch") return;
    expect(result.value.files).toEqual([]);
    expect(result.value.base).toBeNull();
  });

  it("degrades gracefully on a remote-less repo that has commits", async () => {
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
    await git.add(".");
    await git.commit("init");

    const result = await getStatus(repo, "branch");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe("branch");
    if (result.value.mode !== "branch") return;
    expect(result.value.files).toEqual([]);
    expect(result.value.base).toBeNull();
    expect("branch" in result.value).toBe(false);
    expect("workingTree" in result.value).toBe(false);
  });

  it("still surfaces the actionable error when an origin remote exists but isn't fetched", async () => {
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
    await git.add(".");
    await git.commit("init");
    await git.addRemote("origin", "https://example.invalid/repo.git");

    const result = await getStatus(repo, "branch");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BASE_BRANCH_NOT_FOUND");
  });
});

describe("getStatus local mode — branch tracking + working-tree counts (R4.7)", () => {
  let repo: string;
  let remote: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-local-"));
    remote = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-remote-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });

  it("reports ahead/behind vs upstream and staged·modified·untracked counts", async () => {
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(repo, "tracked.txt"), "one\n");
    await git.add("tracked.txt");
    await git.commit("init");

    await simpleGit().raw(["init", "--bare", remote]);
    await git.addRemote("origin", remote);
    await git.raw(["push", "-u", "origin", "main"]);

    fs.writeFileSync(path.join(repo, "committed.txt"), "x\n");
    await git.add("committed.txt");
    await git.commit("ahead by one");
    fs.writeFileSync(path.join(repo, "staged.txt"), "s\n");
    await git.add("staged.txt");
    fs.writeFileSync(path.join(repo, "tracked.txt"), "one\ntwo\n");
    fs.writeFileSync(path.join(repo, "untracked.txt"), "u\n");

    const result = await getStatus(repo, "local");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe("local");
    if (result.value.mode !== "local") return;

    expect("base" in result.value).toBe(false);
    expect(result.value.branch).toEqual({
      name: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
    });
    expect(result.value.workingTree).toEqual({
      staged: 1,
      modified: 1,
      untracked: 1,
    });
    const paths = result.value.files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining(["staged.txt", "tracked.txt", "untracked.txt"]),
    );
  });

  it("reports a null upstream and zero ahead/behind when no branch is tracked", async () => {
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.checkoutLocalBranch("work");
    fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
    await git.add("a.txt");
    await git.commit("init");
    fs.writeFileSync(path.join(repo, "b.txt"), "untracked\n");

    const result = await getStatus(repo, "local");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe("local");
    if (result.value.mode !== "local") return;
    expect(result.value.branch).toEqual({
      name: "work",
      upstream: null,
      ahead: 0,
      behind: 0,
    });
    expect(result.value.workingTree).toEqual({
      staged: 0,
      modified: 0,
      untracked: 1,
    });
  });
});

describe("getStatus branch mode — unicode paths", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-unicode-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("returns a unicode branch-diff path verbatim — no C-quoting, no spurious folder", async () => {
    // Without `core.quotePath=false`, git emits `"People/Am\303\251lie.md"` —
    // octal-escaped and double-quote-wrapped.
    const leaf = "Amélie.md";
    const rel = `People/${leaf}`;

    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(repo, "README.md"), "base\n");
    await git.add(".");
    await git.commit("base");
    await git.raw(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await git.raw([
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    ]);

    fs.mkdirSync(path.join(repo, "People"));
    fs.writeFileSync(path.join(repo, "People", leaf), "bio\n");
    await git.add(".");
    await git.commit("add unicode file");

    const result = await getStatus(repo, "branch");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.files.map((f) => f.path);
    expect(paths).toContain(rel);
    expect(result.value.files).toContainEqual({ path: rel, status: "A" });
    for (const p of paths) {
      expect(p).not.toContain('"');
      expect(p).not.toContain("\\3");
    }
  });
});

describe("getDiff — a directory replaced by a file", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-typechange-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const writeDir = () => {
    fs.mkdirSync(path.join(repo, "skills", "odu"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills", "odu", "SKILL.md"), "# odu\n");
    fs.writeFileSync(path.join(repo, "skills", "odu", "serve"), "serve\n");
  };
  const writeLink = () => {
    fs.mkdirSync(path.join(repo, "skills"), { recursive: true });
    fs.symlinkSync("../plugin/odu", path.join(repo, "skills", "odu"));
  };
  const directions = [
    {
      name: "directory replaced by a symlink",
      before: writeDir,
      after: writeLink,
      linkSign: "+",
      childSign: "-",
    },
    {
      name: "symlink replaced by a directory",
      before: writeLink,
      after: writeDir,
      linkSign: "-",
      childSign: "+",
    },
  ];
  it.each(
    directions.flatMap((d) =>
      (["branch", "local"] as const).map((mode) => ({ ...d, mode })),
    ),
  )("$mode mode, $name: the path's diff carries every file under it", async ({
    mode,
    before,
    after,
    linkSign,
    childSign,
  }) => {
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.checkoutLocalBranch("main");
    before();
    await git.add(".");
    await git.commit("base");
    await git.raw(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await git.raw([
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    ]);

    fs.rmSync(path.join(repo, "skills", "odu"), { recursive: true });
    after();
    await git.add(["-A", "."]);
    if (mode === "branch") await git.commit("type change");

    const status = await getStatus(repo, mode);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.files.map((f) => f.path).sort()).toEqual([
      "skills/odu",
      "skills/odu/SKILL.md",
      "skills/odu/serve",
    ]);

    const result = await getDiff(repo, "skills/odu", mode);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const raw = result.value.hunks.join("");
    expect(raw).toContain("diff --git a/skills/odu b/skills/odu");
    expect(raw).toContain(`${linkSign}../plugin/odu`);
    expect(raw).toContain("diff --git a/skills/odu/SKILL.md");
    expect(raw).toContain(`${childSign}# odu`);
    expect(raw).toContain("diff --git a/skills/odu/serve");
  });
});

describe("getDiff — the user's diff prefix config", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-prefix-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  // Isolate each setting locally so inherited prefix config cannot mask it.
  it.each([
    ["diff.mnemonicPrefix", "true"],
    ["diff.noprefix", "true"],
    ["diff.srcPrefix", "src/"],
  ])("%s=%s still yields a/ b/ headers, tracked and untracked", async (key, value) => {
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.addConfig("diff.mnemonicPrefix", "false");
    await git.addConfig("diff.noprefix", "false");
    await git.addConfig("diff.srcPrefix", "a/");
    await git.addConfig("diff.dstPrefix", "b/");
    await git.addConfig(key, value);
    await git.checkoutLocalBranch("main");
    fs.writeFileSync(path.join(repo, "tracked.txt"), "one\n");
    await git.add(".");
    await git.commit("base");
    fs.writeFileSync(path.join(repo, "tracked.txt"), "two\n");
    fs.writeFileSync(path.join(repo, "new.txt"), "new\n");

    const tracked = await getDiff(repo, "tracked.txt", "local");
    expect(tracked.ok).toBe(true);
    if (!tracked.ok) return;
    const trackedRaw = tracked.value.hunks.join("");
    expect(trackedRaw).toContain("diff --git a/tracked.txt b/tracked.txt");
    expect(trackedRaw).toContain("--- a/tracked.txt");
    expect(trackedRaw).toContain("+++ b/tracked.txt");

    const untracked = await getDiff(repo, "new.txt", "local");
    expect(untracked.ok).toBe(true);
    if (!untracked.ok) return;
    const untrackedRaw = untracked.value.hunks.join("");
    expect(untrackedRaw).toContain("--- /dev/null");
    expect(untrackedRaw).toContain(`+++ b${path.join(repo, "new.txt")}\n`);
  });
});
