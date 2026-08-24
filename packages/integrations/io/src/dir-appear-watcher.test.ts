/** Unit matrix for `watchDirWhenReady` — the ancestor-wait that attaches an
 *  `fs.watch` to a directory which may not exist yet. Real timers (OS watch
 *  delivery is a real async channel; fake timers cannot drive it). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchDirWhenReady } from "./dir-appear-watcher.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Negative-path drain (unsubscribe silenced further events). Longer than
 *  a single inotify tick; not the positive-path wait — see `waitForWatch`. */
const settle = () => sleep(300);

/** Wait for an fs.watch-driven predicate, re-nudging between attempts.
 *  FSEvents on darwin coalesces and can drop a one-shot create — a single
 *  wait budget races that latency (watchGitHead / #320). */
async function waitForWatch(
  cond: () => boolean,
  nudge: () => void,
  perAttemptMs = process.platform === "darwin" ? 2_000 : 1_000,
  attempts = 6,
) {
  for (let i = 0; i < attempts; i++) {
    const deadline = Date.now() + perAttemptMs;
    while (!cond() && Date.now() < deadline) await sleep(50);
    if (cond()) return;
    if (i === attempts - 1) {
      expect(cond()).toBe(true);
      return;
    }
    nudge();
  }
}

const retouch = (file: string) => {
  const content = fs.readFileSync(file);
  fs.writeFileSync(file, content);
};

let tmp: string;
let stops: Array<() => void>;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-dir-appear-"));
  stops = [];
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("watchDirWhenReady", () => {
  it("fires once on attach (reconcile kick), then on events in the dir", {
    timeout: 25_000,
  }, async () => {
    const dir = path.join(tmp, "present");
    fs.mkdirSync(dir);
    const events: number[] = [];
    stops.push(watchDirWhenReady(dir, () => events.push(1)));

    expect(events.length).toBe(1); // the attach kick, synchronous

    const file = path.join(dir, "a");
    fs.writeFileSync(file, "x");
    await waitForWatch(
      () => events.length >= 2,
      () => retouch(file),
    );
  });

  it("waits up the ancestor chain and attaches when the dir appears", {
    timeout: 25_000,
  }, async () => {
    const nested = path.join(tmp, "a", "b", "c");
    const events: number[] = [];
    stops.push(watchDirWhenReady(nested, () => events.push(1)));
    expect(events.length).toBe(0); // nothing yet — no dir anywhere down a/b/c

    fs.mkdirSync(path.join(tmp, "a"));
    fs.mkdirSync(path.join(tmp, "a", "b"));
    // Intermediate levels do not fire — the target isn't attached yet.
    expect(events.length).toBe(0);

    fs.mkdirSync(nested);
    const nudge = path.join(tmp, "a", "b", ".nudge");
    await waitForWatch(
      () => events.length === 1, // attach kick
      () => fs.writeFileSync(nudge, ""),
    );

    const file = path.join(nested, "f");
    fs.writeFileSync(file, "x");
    await waitForWatch(
      () => events.length >= 2,
      () => retouch(file),
    );
  });

  it("unsubscribe is idempotent and silences further events", async () => {
    const dir = path.join(tmp, "gone");
    fs.mkdirSync(dir);
    const events: number[] = [];
    const stop = watchDirWhenReady(dir, () => events.push(1));
    stop();
    stop(); // idempotent

    fs.writeFileSync(path.join(dir, "a"), "x");
    await settle();
    expect(events.length).toBe(1); // only the pre-unsubscribe kick
  });
});
