/**
 * Daemon soak: `watchWorkingTree` must not leak child processes across
 * sustained subscribe/unsubscribe cycles.
 *
 * The regression (kolu#1691): parcel auto-selects its watcher backend by
 * probing **watchman** first, on *every* subscribe, via a native
 * `popen("watchman … get-sockname 2>/dev/null")`. On a host without watchman
 * (every kolu pool box) that probe's error path never `pclose()`s, so the
 * `/bin/sh` it forked leaks as an unreaped zombie — one per subscribe. Node's
 * libuv can't reap a native-`popen` child, so in a long-lived daemon they pile
 * up unbounded and drag the event loop; a remote-bound padi serving a whole e2e
 * run degraded in its back half. The fix pins the OS-native backend so the
 * probe never runs.
 *
 * This is exactly the coverage class two long-lived-daemon incidents (this and
 * kolu#1680) were begging for: the leak is invisible to a spin-up/tear-down
 * unit test and only shows under *sustained* life. We assert the structural
 * invariant — child count returns to baseline — rather than a timing p99, which
 * the remote-e2e lane itself now guards.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchWorkingTree } from "./working-tree-watcher.ts";

/** Count this process's direct children currently in the zombie (`Z`) state —
 *  i.e. dead but unreaped. Portable across the Linux and macOS CI lanes; a
 *  reaped child leaves no row, so a healthy watcher yields zero. */
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
      const unsubscribe = watchWorkingTree(repo, () => {});
      // Let the async parcel install (and its backend selection) complete
      // before tearing down — that is where the leaking probe fires.
      await sleep(80);
      unsubscribe();
    }
    // Give any unreaped child ample time to surface as a zombie.
    await sleep(1500);

    // Without the backend pin, this is `baseline + CYCLES` (one leaked `sh`
    // per subscribe). With it, no probe runs and no child leaks.
    expect(zombieChildCount() - baseline).toBe(0);
  });
});
