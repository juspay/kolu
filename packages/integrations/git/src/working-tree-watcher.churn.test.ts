/**
 * Regression: a working-tree watcher rebuilt on the SAME repo must still
 * deliver events (juspay/kolu#2065).
 *
 * `@parcel/watcher` keeps a process-global registry of `Watcher` objects keyed
 * by `(dir, ignorePaths, ignoreGlobs)` and a backend-side subscription set
 * keyed by the same equality, and `subscribe()`/`unsubscribe()` each do their
 * backend half on a libuv worker thread, so two overlapping calls complete in
 * ARBITRARY order: a re-`subscribe` can find the retiring watcher still
 * registered and install no OS watches, after which the retiring `unsubscribe`
 * tears the existing ones down. The new subscription then receives nothing,
 * forever. Measured against `@parcel/watcher@2.5.6`: 18/25 un-awaited
 * teardowns produced a dead watcher, 0/25 awaited ones did.
 *
 * Both halves are `napi` async work on the libuv threadpool, so on an idle
 * process the teardown finishes first and hides the race; saturating the pool
 * reproduces the loaded-CI ordering (10/10 dead un-awaited, 0/10 awaited).
 *
 * Both cases gate on an event ARRIVING, so both run on linux/inotify only.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKIP_DARWIN_FSWATCH } from "./fs-watch-delivery.testlib.ts";
import { subscribeInstalled } from "./working-tree-watcher.testlib.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Occupy every libuv threadpool slot for a moment, so parcel's teardown and
 *  rebuild work items both wait in the queue and then start together. */
function saturateThreadpool(): void {
  const size = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
  for (let i = 0; i < size; i++) {
    crypto.pbkdf2(`churn-${i}`, "salt", 400_000, 32, "sha512", () => {});
  }
}

describe.skipIf(SKIP_DARWIN_FSWATCH)("watchWorkingTree rebuild", () => {
  let repo: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wt-churn-"));
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "a@b.c");
    await git.addConfig("user.name", "a");
    fs.writeFileSync(path.join(repo, "a.txt"), "hi\n");
    await git.add(".");
    await git.commit("init");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("still delivers events after the shared watcher is torn down and rebuilt", async () => {
    const CYCLES = 4;
    const file = path.join(repo, "a.txt");
    const dead: number[] = [];

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const off1 = await subscribeInstalled(repo, () => {});
      saturateThreadpool();
      off1();

      let fired = 0;
      const off2 = await subscribeInstalled(repo, () => {
        fired++;
      });

      fs.writeFileSync(file, `edit-${cycle}\n`);
      for (let waited = 0; waited < 3000 && fired === 0; waited += 50) {
        await sleep(50);
      }
      if (fired === 0) dead.push(cycle);
      off2();
      await sleep(50);
    }

    expect(dead).toEqual([]);
  }, 60_000);

  /**
   * The other half of #2065: parcel watches a newly created directory but
   * never SCANS it — `watchDir` adds the inotify watch and returns, so
   * anything already inside when the watch went on is invisible to that
   * subscription forever. `mkdir -p src/feature` reproduces it: no create
   * event is ever generated for `src/feature` on any watch parcel holds.
   * Measured against `@parcel/watcher@2.5.6`: `src/feature` went blind in 4-6
   * of 6 trials at every subscribe→mkdir delay from 0ms to 400ms, while a
   * direct child of the watched root went blind 0/6.
   */
  it("watches a subtree that was created before parcel could watch its parent", async () => {
    const git = simpleGit(repo);
    let fired = 0;
    const off = await subscribeInstalled(repo, () => {
      fired++;
    });

    fs.mkdirSync(path.join(repo, "src", "feature"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "feature", "a.txt"), "a\n");
    await git.add(".");
    await git.commit("tree");
    await sleep(1500);

    fired = 0;
    fs.writeFileSync(path.join(repo, "src", "feature", "a.txt"), "edited\n");
    for (let waited = 0; waited < 3000 && fired === 0; waited += 50) {
      await sleep(50);
    }
    off();
    expect(fired).toBeGreaterThan(0);
  }, 60_000);
});
