/**
 * Daemon soak: `watchWorkingTree` must not leak child processes across
 * sustained subscribe/unsubscribe cycles (kolu#1691).
 *
 * parcel auto-selects its watcher backend by probing watchman first, on EVERY
 * subscribe, via a native `popen("watchman … get-sockname 2>/dev/null")`. On a
 * host without watchman that probe's error path never `pclose()`s, so the
 * `/bin/sh` it forked leaks as an unreaped zombie — one per subscribe, and
 * libuv cannot reap a native-`popen` child. The fix pins the OS-native backend
 * so the probe never runs.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchWorkingTree } from "./working-tree-watcher.ts";

function zombieChildCount(): number {
  const out = execFileSync("ps", ["-Ao", "ppid,stat"], { encoding: "utf-8" });
  return out.split("\n").filter((line) => {
    const cols = line.trim().split(/\s+/);
    return Number(cols[0]) === process.pid && (cols[1] ?? "").includes("Z");
  }).length;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("watchWorkingTree child-process lifetime", () => {
  let repo: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wt-reap-"));
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "a@b.c");
    await git.addConfig("user.name", "a");
    fs.writeFileSync(path.join(repo, "a.txt"), "hi");
    await git.add(".");
    await git.commit("init");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("reaps every child across sustained subscribe/unsubscribe cycles", async () => {
    const baseline = zombieChildCount();

    const CYCLES = 12;
    for (let i = 0; i < CYCLES; i++) {
      const unsubscribe = watchWorkingTree(repo, "test", () => {});
      await sleep(80);
      unsubscribe();
    }
    await sleep(1500);

    expect(zombieChildCount() - baseline).toBe(0);
  });
});
