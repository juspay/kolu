import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchWorkingTree } from "./working-tree-watcher.ts";

describe("watchWorkingTree recursive coverage", () => {
  let repo: string | undefined;
  let unsubscribe: (() => void) | undefined;

  afterEach(() => {
    unsubscribe?.();
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
  });

  it("observes later edits below a nested subtree created in one burst", async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wt-nested-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });

    let changes = 0;
    unsubscribe = watchWorkingTree(repo, () => {
      changes += 1;
    });

    // The first synthetic reconciliation means Parcel's initial root watch is
    // live. Create both directory levels synchronously: on Linux, `feature/`
    // can otherwise exist before inotify has attached its new `src/` watch.
    await vi.waitFor(() => expect(changes).toBeGreaterThanOrEqual(1), {
      timeout: 5_000,
    });
    fs.mkdirSync(path.join(repo, "src", "feature"), { recursive: true });
    const nested = path.join(repo, "src", "feature", "a.txt");
    fs.writeFileSync(nested, "initial\n");

    await vi.waitFor(() => expect(changes).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
    });
    fs.writeFileSync(nested, "edited\n");

    // This is the event the stale root subscription loses: the new file is
    // below the descendant inotify never saw. The directory-create rebuild
    // either watches it before this edit or reconciles the edit after swapping.
    await vi.waitFor(() => expect(changes).toBeGreaterThanOrEqual(3), {
      timeout: 5_000,
    });
  });
});
