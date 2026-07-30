import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _createdPathNeedsRepair,
  _sharedWorkingTreeWatcherCount,
  _waitForWorkingTreeWatcherRetirement,
  watchWorkingTree,
} from "./working-tree-watcher.ts";

describe("watchWorkingTree recursive coverage", () => {
  let repo: string | undefined;
  let unsubscribe: (() => void) | undefined;

  afterEach(async () => {
    unsubscribe?.();
    if (repo) {
      await _waitForWorkingTreeWatcherRetirement(repo);
      expect(_sharedWorkingTreeWatcherCount()).toBe(0);
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("observes later edits below a nested subtree created in one burst", async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wt-nested-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });

    let changes = 0;
    const lifecycle: string[] = [];
    const log: Logger = {
      debug() {},
      warn() {},
      error() {},
      info: (_obj, msg) => lifecycle.push(msg),
    };
    unsubscribe = watchWorkingTree(
      repo,
      () => {
        changes += 1;
      },
      log,
    );

    // The first synthetic reconciliation means Parcel's initial root watch is
    // live. Create both directory levels synchronously: on Linux, `feature/`
    // can otherwise exist before inotify has attached its new `src/` watch.
    await vi.waitFor(() => expect(changes).toBeGreaterThanOrEqual(1), {
      timeout: 5_000,
    });
    fs.mkdirSync(path.join(repo, "src", "feature"), { recursive: true });
    const nested = path.join(repo, "src", "feature", "a.txt");
    fs.writeFileSync(nested, "initial\n");

    // Wait for the actual structural repair, not merely another listener fire:
    // its synthetic reconciliation could otherwise satisfy a count-only
    // assertion without the later nested edit ever reaching Parcel.
    await vi.waitFor(
      () => expect(lifecycle).toContain("git: working-tree watcher rebuilt"),
      { timeout: 5_000 },
    );
    await vi.waitFor(() => expect(changes).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
    });
    const beforeNestedEdit = changes;
    fs.writeFileSync(nested, "edited\n");

    // This is the event the stale root subscription loses: the new file is
    // below the descendant inotify never saw. The directory-create rebuild
    // either watches it before this edit or reconciles the edit after swapping.
    await vi.waitFor(() => expect(changes).toBeGreaterThan(beforeNestedEdit), {
      timeout: 5_000,
    });

    unsubscribe();
    unsubscribe = undefined;
    await _waitForWorkingTreeWatcherRetirement(repo);
    expect(_sharedWorkingTreeWatcherCount()).toBe(0);
  });

  it("coalesces a sustained directory-create burst instead of rebuilding per mkdir", async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wt-burst-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });

    let changes = 0;
    const lifecycle: string[] = [];
    const log: Logger = {
      debug() {},
      warn() {},
      error() {},
      info: (_obj, msg) => lifecycle.push(msg),
    };
    unsubscribe = watchWorkingTree(
      repo,
      () => {
        changes += 1;
      },
      log,
    );
    await vi.waitFor(() => expect(changes).toBeGreaterThanOrEqual(1), {
      timeout: 5_000,
    });

    for (let i = 0; i < 12; i += 1) {
      const dir = path.join(repo, `created-${i}`);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "file.txt"), `${i}\n`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await vi.waitFor(
      () =>
        expect(
          lifecycle.filter(
            (message) => message === "git: working-tree watcher rebuilt",
          ).length,
        ).toBeGreaterThanOrEqual(1),
      { timeout: 5_000 },
    );
    // All creates fit inside one trailing repair window. Allow one extra repair
    // for a platform backend that delivers the final batch after the first
    // replacement, but never the one-rebuild-per-directory pathology.
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(
      lifecycle.filter(
        (message) => message === "git: working-tree watcher rebuilt",
      ).length,
    ).toBeLessThanOrEqual(2);
  });

  it("does not rebuild for observed transient-file churn", async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wt-transient-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });

    let changes = 0;
    const lifecycle: string[] = [];
    const log: Logger = {
      debug() {},
      warn() {},
      error() {},
      info: (_obj, msg) => lifecycle.push(msg),
    };
    unsubscribe = watchWorkingTree(
      repo,
      () => {
        changes += 1;
      },
      log,
    );
    await vi.waitFor(() => expect(changes).toBeGreaterThanOrEqual(1), {
      timeout: 5_000,
    });
    const beforeChurn = changes;

    // Keep one file present until its debounced listener fire, proving this
    // backend is delivering file-create traffic during the test.
    fs.writeFileSync(path.join(repo, "observed.txt"), "observed\n");
    await vi.waitFor(() => expect(changes).toBeGreaterThan(beforeChurn), {
      timeout: 5_000,
    });

    const vanished: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const transient = path.join(repo, `.probe-${i}`);
      fs.writeFileSync(transient, "probe\n");
      fs.unlinkSync(transient);
      vanished.push(transient);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Pin the exact ENOENT classification independently of backend event
    // coalescing, then give the real watch ample time to betray a rebuild.
    await expect(
      Promise.all(vanished.map(_createdPathNeedsRepair)),
    ).resolves.toEqual(Array.from({ length: vanished.length }, () => false));
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(
      lifecycle.filter(
        (message) => message === "git: working-tree watcher rebuilt",
      ),
    ).toHaveLength(0);
  });
});
