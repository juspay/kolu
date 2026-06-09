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
    // The local-untracked branch diffs `/dev/null` against the resolved
    // absolute path; a `leak.txt -> /outside/secret.txt` symlink would
    // surface the external file's content verbatim without the realpath guard.
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
    // A *tracked* symlink to an outside target is diffed via `git diff HEAD --
    // <rel>`, where `rel` is a pathspec git resolves against the tree — it
    // never dereferences the working-tree link. The realpath guard must stay
    // scoped to the untracked `--no-index` fallback so this case keeps
    // rendering regardless of whether the target exists on the host.
    const secret = path.join(outside, "secret.txt");
    fs.writeFileSync(secret, "TOP SECRET\n");

    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.checkoutLocalBranch("main");
    // Commit the symlink, then retarget it in the working tree so the tracked
    // `git diff HEAD -- <rel>` path produces a real (non-empty) diff.
    fs.symlinkSync(secret, path.join(repo, "link"));
    await git.add("link");
    await git.commit("add link");
    fs.rmSync(path.join(repo, "link"));
    fs.symlinkSync(path.join(outside, "other.txt"), path.join(repo, "link"));

    const result = await getDiff(repo, "link", "local");
    // The only requirement is that the symlink-resolving guard does NOT reject
    // this tracked diff based on the host filesystem.
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
    // `git init` with no remote and no commits: there is no `origin`, so
    // branch mode has nothing to diff against. It must NOT error — an error
    // here is logged at ERROR by the surface's onStreamReadError on every
    // repo-change tick (the bug). Expect an empty, base-less status instead.
    await simpleGit(repo).init();

    const result = await getStatus(repo, "branch");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files).toEqual([]);
    expect(result.value.base).toBeNull();
  });

  it("degrades gracefully on a remote-less repo that has commits", async () => {
    // Even with local history, a repo with no `origin` remote has no base
    // branch to compare against — branch mode is meaningless, not broken.
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
    expect(result.value.files).toEqual([]);
    expect(result.value.base).toBeNull();
  });

  it("still surfaces the actionable error when an origin remote exists but isn't fetched", async () => {
    // A repo *with* an `origin` remote whose default branch hasn't been
    // fetched is a genuinely actionable state — the user can run `git fetch`.
    // Keep the BASE_BRANCH_NOT_FOUND error so explicit Branch mode can prompt.
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

describe("getStatus branch mode — unicode paths", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-unicode-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("returns a unicode branch-diff path verbatim — no C-quoting, no spurious folder", async () => {
    // The branch-mode file list comes from `git diff --name-status <base>`.
    // Without `core.quotePath=false`, git emits `"People/Am\303\251lie.md"`
    // (octal-escaped, quote-wrapped); the leading quote then became a spurious
    // `"People` folder and the leaf rendered as `Am\303\251lie.md"`.
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
    // Synthesize the remote-tracking base `getStatus` diffs against, with no
    // real remote: point `origin/main` (and origin/HEAD) at the base commit.
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
