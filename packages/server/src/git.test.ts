import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { simpleGit } from "simple-git";
import { initHostname } from "./hostname.ts";
import { initLog } from "./log.ts";
import { worktreeCreate } from "./git.ts";

initHostname();
initLog();

// Mock randomName to return a predictable value
vi.mock("./randomName.ts", () => ({
  randomName: () => "test-worktree",
}));

/**
 * Helper: create a bare repo with one commit on a given branch, clone it.
 * Returns { bareDir, cloneDir } inside a temp directory.
 */
async function setupRepos(defaultBranch = "main"): Promise<{
  tmpDir: string;
  bareDir: string;
  cloneDir: string;
}> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-test-"));
  const bareDir = path.join(tmpDir, "bare.git");
  const cloneDir = path.join(tmpDir, "clone");

  // Create a bare repo and seed it with one commit via a temp working copy
  const seedDir = path.join(tmpDir, "seed");
  fs.mkdirSync(seedDir);
  const seedGit = simpleGit(seedDir);
  await seedGit.init();
  await seedGit.raw(["checkout", "-b", defaultBranch]);
  fs.writeFileSync(path.join(seedDir, "README.md"), "init");
  await seedGit.add(".");
  await seedGit.commit("initial commit");
  await seedGit.raw(["clone", "--bare", seedDir, bareDir]);

  // Clone from bare
  await simpleGit().clone(bareDir, cloneDir);

  return { tmpDir, bareDir, cloneDir };
}

describe("worktreeCreate", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses latest remote HEAD after remote changes its default branch", async () => {
    // 1. Create bare repo with "master" as default, clone it
    const repos = await setupRepos("master");
    tmpDir = repos.tmpDir;

    // 2. Change bare repo's default branch to "main"
    const bareGit = simpleGit(repos.bareDir);
    // Create "main" branch in the bare repo with a new commit
    const pusherDir = path.join(tmpDir, "pusher");
    await simpleGit().clone(repos.bareDir, pusherDir);
    const pusherGit = simpleGit(pusherDir);
    await pusherGit.raw(["checkout", "-b", "main"]);
    fs.writeFileSync(path.join(pusherDir, "new-file.txt"), "main branch");
    await pusherGit.add(".");
    await pusherGit.commit("commit on main");
    await pusherGit.push("origin", "main");
    const mainHead = (await pusherGit.revparse(["HEAD"])).trim();

    // Point bare repo's HEAD to main
    await bareGit.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);

    // At this point, the clone's origin/HEAD still points to origin/master (stale).
    // worktreeCreate should detect the remote's actual default (main) and use it.
    const result = await worktreeCreate(repos.cloneDir);

    const worktreeGit = simpleGit(result.path);
    const worktreeHead = (await worktreeGit.revparse(["HEAD"])).trim();
    expect(worktreeHead).toBe(mainHead);

    // Clean up worktree
    await simpleGit(repos.cloneDir).raw([
      "worktree",
      "remove",
      result.path,
      "--force",
    ]);
  });

  it("creates worktree from latest origin commit, not stale local ref", async () => {
    const repos = await setupRepos();
    tmpDir = repos.tmpDir;

    // Push a new commit to bare (simulating someone else pushing)
    const pusherDir = path.join(tmpDir, "pusher");
    await simpleGit().clone(repos.bareDir, pusherDir);
    const pusherGit = simpleGit(pusherDir);
    fs.writeFileSync(path.join(pusherDir, "new-file.txt"), "new content");
    await pusherGit.add(".");
    await pusherGit.commit("new commit");
    await pusherGit.push("origin", "main");
    const latestCommit = (await pusherGit.revparse(["HEAD"])).trim();

    // The clone is now behind — its origin/main is stale
    const cloneGit = simpleGit(repos.cloneDir);
    const staleCommit = (await cloneGit.revparse(["origin/main"])).trim();
    expect(staleCommit).not.toBe(latestCommit);

    // worktreeCreate should fetch and create from the latest commit
    const result = await worktreeCreate(repos.cloneDir);

    const worktreeGit = simpleGit(result.path);
    const worktreeHead = (await worktreeGit.revparse(["HEAD"])).trim();
    expect(worktreeHead).toBe(latestCommit);

    // Clean up worktree
    await cloneGit.raw(["worktree", "remove", result.path, "--force"]);
  });
});
