/**
 * Regression: a working-tree watcher rebuilt on the SAME repo must still
 * deliver events (juspay/kolu#2065).
 *
 * `@parcel/watcher` keeps a PROCESS-GLOBAL registry of `Watcher` objects keyed
 * by `(dir, ignorePaths, ignoreGlobs)` (`Watcher::getShared`) and a backend-side
 * subscription set keyed by the same equality (`Backend::watch` /
 * `Backend::unwatch`). `subscribe()` and `unsubscribe()` each do their backend
 * half on a libuv worker thread, so two calls that overlap complete in
 * ARBITRARY order. Drop the last listener and immediately re-subscribe the same
 * repo with the same ignore set and the two halves can interleave as:
 *
 *   1. re-`subscribe` finds the retiring watcher still in `mSubscriptions`
 *      (equal by dir+ignore) and therefore installs NO inotify/FSEvents watches;
 *   2. the retiring `unsubscribe` then erases that entry and tears the OS
 *      watches down.
 *
 * The new subscription is live from JS's point of view — it resolved, it holds
 * callbacks — and receives NOTHING, forever. Measured directly against
 * `@parcel/watcher@2.5.6`: 18/25 un-awaited teardowns produced a dead watcher,
 * 0/25 awaited ones did.
 *
 * In kolu that is a Code tab whose git status freezes at whatever the snapshot
 * said when the stream opened: the tree renders, `git.getStatus` answered once,
 * and no later edit ever pulses. It is why #2065's e2e scenario times out for
 * ~60s while the same page's file list is perfectly healthy.
 *
 * WHY THE TEST LOADS THE THREADPOOL. Both parcel halves are `napi` async work,
 * so they run on the libuv threadpool. On an IDLE process the teardown is
 * dequeued first and finishes during the ignore enumeration that precedes the
 * rebuild's `subscribe`, and the race stays hidden — which is exactly why #2065
 * only ever showed under a loaded 8-worker suite and never in a single-scenario
 * run. Saturating the pool reproduces that: both halves queue, then start
 * together the moment threads free. Measured against `@parcel/watcher@2.5.6`,
 * un-awaited teardowns went 10/10 dead under this pressure at every rebuild
 * delay from 15ms to 200ms, while awaited ones went 0/10.
 *
 * The invariant this pins: after a full teardown + rebuild of one repo's shared
 * watcher, a write STILL reaches the new listener.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchWorkingTree } from "./working-tree-watcher.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Occupy every libuv threadpool slot for a moment, so parcel's teardown and
 *  rebuild work items both wait in the queue and then start together — the
 *  loaded-CI ordering, on an otherwise idle test host. `pbkdf2` is the
 *  cheapest honest way to hold a pool thread for a bounded time. */
function saturateThreadpool(): void {
  const size = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
  for (let i = 0; i < size; i++) {
    crypto.pbkdf2(`churn-${i}`, "salt", 400_000, 32, "sha512", () => {});
  }
}

/** Subscribe and resolve once the watcher is genuinely installed. The install
 *  is async (git ignore enumeration, then the parcel subscribe) and fires one
 *  post-install reconciliation tick when it lands — that tick IS the ready
 *  signal, so this waits on the real handle rather than a sleep. */
async function subscribeInstalled(
  repo: string,
  onChange: () => void,
): Promise<() => void> {
  let installed!: () => void;
  const ready = new Promise<void>((resolve) => {
    installed = resolve;
  });
  let seenReconcile = false;
  const off = watchWorkingTree(repo, () => {
    if (!seenReconcile) {
      seenReconcile = true;
      installed();
      return;
    }
    onChange();
  });
  await ready;
  return off;
}

describe("watchWorkingTree rebuild", () => {
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

  it(
    "still delivers events after the shared watcher is torn down and rebuilt",
    async () => {
      const CYCLES = 4;
      const file = path.join(repo, "a.txt");
      const dead: number[] = [];

      for (let cycle = 0; cycle < CYCLES; cycle++) {
        const off1 = await subscribeInstalled(repo, () => {});
        // Drop the last listener — this retires the shared parcel subscription —
        // and rebuild immediately, the way a stream re-subscribe does. The pool
        // is loaded first so the two halves overlap, as they do under CI load.
        saturateThreadpool();
        off1();

        let fired = 0;
        const off2 = await subscribeInstalled(repo, () => {
          fired++;
        });

        fs.writeFileSync(file, `edit-${cycle}\n`);
        // Generous budget: the watcher debounce is 150ms; a live handle answers
        // far inside this. A dead one never answers at all.
        for (let waited = 0; waited < 3000 && fired === 0; waited += 50) {
          await sleep(50);
        }
        if (fired === 0) dead.push(cycle);
        off2();
        await sleep(50);
      }

      expect(dead).toEqual([]);
    },
    { timeout: 60_000, retry: 2 },
  );

  /**
   * The other half of #2065, and the one that actually reddened CI: parcel
   * watches a newly created directory but never SCANS it. `watchDir` adds the
   * inotify watch and returns, so anything that was already inside when the
   * watch went on is invisible to that subscription **forever**.
   *
   * `mkdir -p src/feature` is the whole reproduction. `src` is created, then
   * `src/feature` microseconds later — long before parcel's poll thread gets
   * to the `src` create event and adds its watch. No create event is ever
   * generated for `src/feature` on any watch parcel holds, and nothing rescans,
   * so every later edit under it is lost. Measured against
   * `@parcel/watcher@2.5.6` with the scenario's exact shell sequence:
   * `src/feature` went blind in 4-6 of 6 trials at every subscribe→mkdir delay
   * from 0ms to 400ms, while `seed/` (a direct child of the watched root, whose
   * create event parcel does see) went blind 0/6. That asymmetry is the
   * `seed`/`src` alternation the issue reports.
   *
   * It hides behind a race for WHEN the watcher installs, not how loaded the
   * box is: kolu subscribes as soon as the terminal's repoRoot is known, so
   * whether that lands before or after the scenario's `mkdir` decides it — and
   * an isolated run reliably lands after.
   */
  it(
    "watches a subtree that was created before parcel could watch its parent",
    async () => {
      const git = simpleGit(repo);
      let fired = 0;
      const off = await subscribeInstalled(repo, () => {
        fired++;
      });

      // The scenario's shape: a nested directory tree created in one burst,
      // right after the watcher went on.
      fs.mkdirSync(path.join(repo, "src", "feature"), { recursive: true });
      fs.writeFileSync(path.join(repo, "src", "feature", "a.txt"), "a\n");
      await git.add(".");
      await git.commit("tree");
      // Let the rebuild's debounce fire and its recursive walk land.
      await sleep(1500);

      fired = 0;
      fs.writeFileSync(path.join(repo, "src", "feature", "a.txt"), "edited\n");
      for (let waited = 0; waited < 3000 && fired === 0; waited += 50) {
        await sleep(50);
      }
      off();
      expect(fired).toBeGreaterThan(0);
    },
    { timeout: 60_000, retry: 2 },
  );
});
