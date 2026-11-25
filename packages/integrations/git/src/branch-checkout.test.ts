/**
 * WHERE A BRANCH IS CHECKED OUT, as git answers it — on real repositories.
 *
 * The root is one answer whatever path inside the repository asks (its root,
 * a linked worktree, a subfolder), so two spellings of one repository name
 * one root. The checkout is the main checkout, a linked worktree, or none.
 * And the subscription asks again after each way the answer can move: a
 * worktree added or removed, a switch inside a linked worktree, a switch in
 * the main checkout.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  _resetSharedWorktreesWatchers,
  _settledSharedWorktreesWatchers,
  branchCheckout,
  parseWorktreeList,
  subscribeBranchCheckout,
} from "./branch-checkout.ts";
import { SKIP_DARWIN_FSWATCH } from "./fs-watch-delivery.testlib.ts";
import {
  _resetSharedHeadWatchers,
  _settledSharedHeadWatchers,
  _sharedHeadWatcherCount,
} from "./head-watcher.ts";
import type { BranchCheckout } from "./schemas.ts";
import type { Logger } from "kolu-shared";
import { testGit } from "./testGit.ts";

let tmpDir: string;

beforeAll(() => {
  // realpath: git answers canonical paths, and macOS's /tmp is a symlink.
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "kolu-git-checkout-test-")),
  );
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A repository on `main` with one commit and a `feature` branch. */
async function repo(name: string) {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const git = testGit(dir);
  await git.init();
  await git.checkoutLocalBranch("main");
  fs.writeFileSync(path.join(dir, "README"), "hello\n");
  await git.add("README");
  await git.commit("first");
  await git.branch(["feature"]);
  await git.branch(["other"]);
  return { dir, git };
}

const at = (root: string, where: string): BranchCheckout => ({
  kind: "repository",
  root,
  checkout: { kind: "at", path: where },
});

describe("where a branch is checked out", () => {
  it("answers one root from the root, a linked worktree and a subfolder", async () => {
    const { dir, git } = await repo("one-root");
    const linked = path.join(dir, ".worktrees", "feature");
    await git.raw(["worktree", "add", linked, "feature"]);
    const sub = path.join(dir, "src", "deep");
    fs.mkdirSync(sub, { recursive: true });

    for (const from of [dir, linked, sub, `${dir}/`])
      expect(await branchCheckout(from, "feature"), from).toEqual(
        at(dir, linked),
      );
  });

  it("answers the main checkout for the branch it is on", async () => {
    const { dir } = await repo("main-checkout");
    expect(await branchCheckout(dir, "main")).toEqual(at(dir, dir));
  });

  it("answers none for a branch checked out nowhere, or that does not exist", async () => {
    const { dir } = await repo("nowhere");
    for (const branch of ["feature", "not-yet-cut"])
      expect(await branchCheckout(dir, branch)).toEqual({
        kind: "repository",
        root: dir,
        checkout: { kind: "none" },
      });
  });

  it("answers not-a-repository for a folder git does not know, or no folder", async () => {
    const plain = path.join(tmpDir, "plain");
    fs.mkdirSync(plain, { recursive: true });
    expect(await branchCheckout(plain, "main")).toEqual({
      kind: "not-a-repository",
    });
    expect(await branchCheckout(path.join(tmpDir, "absent"), "main")).toEqual({
      kind: "not-a-repository",
    });
  });

  it("answers unavailable for a path kolu could not read, not no-repository", async () => {
    // Root reads every folder, so the case is not one it can be in.
    if (process.getuid?.() === 0) return;
    const shut = path.join(tmpDir, "shut");
    fs.mkdirSync(path.join(shut, "inner"), { recursive: true });
    fs.chmodSync(shut, 0o000);
    try {
      const answer = await branchCheckout(path.join(shut, "inner"), "main");
      expect(answer.kind).toBe("unavailable");
    } finally {
      fs.chmodSync(shut, 0o755);
    }
  });

  it("answers a repository reached through a symlink with its main checkout as its root", async () => {
    const { dir } = await repo("through-a-link");
    const link = path.join(tmpDir, "the-link");
    fs.symlinkSync(dir, link);
    expect(await branchCheckout(link, "main")).toEqual(at(dir, dir));
  });

  it("leaves out a bare repository's own entry and a worktree whose folder is gone", () => {
    expect(
      parseWorktreeList(
        [
          "worktree /srv/r.git",
          "bare",
          "",
          "worktree /srv/r/a",
          "HEAD 1111111111111111111111111111111111111111",
          "branch refs/heads/a",
          "",
          "worktree /srv/r/b",
          "HEAD 2222222222222222222222222222222222222222",
          "branch refs/heads/b",
          "prunable gitdir file points to non-existent location",
          "",
          "worktree /srv/r/c",
          "HEAD 3333333333333333333333333333333333333333",
          "detached",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { path: "/srv/r/a", branch: "a" },
      { path: "/srv/r/c", branch: null },
    ]);
  });
});

describe.skipIf(SKIP_DARWIN_FSWATCH)(
  "following where a branch is checked out",
  () => {
    beforeEach(() => {
      _resetSharedHeadWatchers();
      _resetSharedWorktreesWatchers();
    });

    afterEach(() => {
      _resetSharedHeadWatchers();
      _resetSharedWorktreesWatchers();
    });

    /** Every answer the subscription gave, in order — and every warning
     *  it logged. */
    async function follow(dir: string, branch: string) {
      const answers: BranchCheckout[] = [];
      const warned: unknown[] = [];
      const quiet = () => {};
      const log = {
        warn: (...args: unknown[]) => warned.push(args),
        error: (...args: unknown[]) => warned.push(args),
        info: quiet,
        debug: quiet,
        trace: quiet,
      };
      const stop = subscribeBranchCheckout(
        dir,
        branch,
        "test",
        (answer) => answers.push(answer),
        log as unknown as Logger,
      );
      await waitFor(() => answers.length > 0);
      await _settledSharedWorktreesWatchers();
      await _settledSharedHeadWatchers();
      return { answers, warned, stop };
    }

    /** Wait until `predicate` holds, polling — the watch is real `fs.watch`
     *  with a one-second stat behind it. */
    async function waitFor(
      predicate: () => boolean,
      timeout = 5000,
    ): Promise<void> {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((done) => setTimeout(done, 25));
      }
      throw new Error(`waitFor: not true within ${timeout}ms`);
    }

    it("asks again when a worktree is added for the branch, and when it is removed", async () => {
      const { dir, git } = await repo("follow-add-remove");
      const { answers, stop } = await follow(dir, "feature");
      expect(answers).toEqual([
        { kind: "repository", root: dir, checkout: { kind: "none" } },
      ]);

      const linked = path.join(dir, ".worktrees", "feature");
      await git.raw(["worktree", "add", linked, "feature"]);
      await waitFor(() => answers.length === 2);
      expect(answers[1]).toEqual(at(dir, linked));

      await git.raw(["worktree", "remove", linked]);
      await waitFor(() => answers.length === 3);
      expect(answers[2]).toEqual({
        kind: "repository",
        root: dir,
        checkout: { kind: "none" },
      });
      stop();
    });

    it("asks again on a switch inside a linked worktree", async () => {
      const { dir, git } = await repo("follow-linked-switch");
      const linked = path.join(dir, ".worktrees", "work");
      await git.raw(["worktree", "add", linked, "other"]);
      const { answers, stop } = await follow(dir, "feature");
      expect(answers).toEqual([
        { kind: "repository", root: dir, checkout: { kind: "none" } },
      ]);

      await testGit(linked).checkout("feature");
      await waitFor(() => answers.length === 2);
      expect(answers[1]).toEqual(at(dir, linked));
      stop();
    });

    it("asks again on a switch in the main checkout", async () => {
      const { dir, git } = await repo("follow-main-switch");
      const { answers, stop } = await follow(dir, "feature");

      await git.checkout("feature");
      await waitFor(() => answers.length === 2);
      expect(answers[1]).toEqual(at(dir, dir));

      await git.checkout("main");
      await waitFor(() => answers.length === 3);
      expect(answers[2]).toEqual({
        kind: "repository",
        root: dir,
        checkout: { kind: "none" },
      });
      stop();
    });

    it("keeps every HEAD watcher through an answer git could not give", async () => {
      // A switch written by hand while git cannot read its own config: the
      // HEAD watcher asks, and git answers nothing it can list. The watchers
      // the last LISTING armed stay — an error is not a listing.
      const { dir } = await repo("follow-through-an-error");
      const linked = path.join(dir, ".worktrees", "work");
      await testGit(dir).raw(["worktree", "add", linked, "other"]);
      const { answers, stop } = await follow(dir, "feature");
      // The main checkout and the linked one.
      expect(_sharedHeadWatcherCount()).toBe(2);
      const config = path.join(dir, ".git", "config");
      const good = fs.readFileSync(config, "utf-8");
      try {
        fs.writeFileSync(config, "[core\n");
        fs.writeFileSync(
          path.join(dir, ".git", "HEAD"),
          "ref: refs/heads/other\n",
        );
        await waitFor(() => answers.at(-1)?.kind === "unavailable");
        await _settledSharedHeadWatchers();
        expect(_sharedHeadWatcherCount()).toBe(2);
      } finally {
        fs.writeFileSync(config, good);
        stop();
      }
    });

    it("answers once a folder that was no repository becomes one", async () => {
      const dir = path.join(tmpDir, "becomes-a-repo");
      fs.mkdirSync(dir, { recursive: true });
      const { answers, stop } = await follow(dir, "main");
      expect(answers).toEqual([{ kind: "not-a-repository" }]);
      await testGit(dir).init();
      await waitFor(() => answers.length === 2);
      expect(answers[1]?.kind).toBe("repository");
      stop();
    });

    it("asks again, on its own, while git's last answer is unavailable (N3)", async () => {
      // Root reads every folder, so the case is not one it can be in.
      if (process.getuid?.() === 0) return;
      // A repository kolu cannot read yet — its parent shut — answers
      // `unavailable`. Opening the parent touches nothing in the repository,
      // so no watcher can be what asks again: the spaced re-ask is.
      const shut = path.join(tmpDir, "shut-at-first");
      const { dir } = await repo("shut-at-first/inner");
      fs.chmodSync(shut, 0o000);
      try {
        const { answers, warned, stop } = await follow(dir, "main");
        expect(answers.map((one) => one.kind)).toEqual(["unavailable"]);
        // Past one re-ask, still shut: the same answer is said once.
        await new Promise((done) => setTimeout(done, 3_500));
        expect(warned).toHaveLength(1);
        fs.chmodSync(shut, 0o755);
        await waitFor(() => answers.length === 2, 10_000);
        expect(answers[1]).toEqual(at(dir, dir));
        stop();
      } finally {
        fs.chmodSync(shut, 0o755);
      }
    }, 20_000);
  },
);
