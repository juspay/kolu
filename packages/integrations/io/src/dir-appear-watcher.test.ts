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
 *  a single inotify tick; not the positive-path wait — see `waitFor`. */
const settle = () => sleep(300);

// FS-event delivery latency is backend-dependent (FSEvents on a loaded
// darwin box routinely exceeds a fixed 300ms window) — park on the
// CONDITION, not a sleep calendar. Same helper as pi's subscribeSessionsTree.
async function waitFor(
  cond: () => boolean,
  timeoutMs = process.platform === "darwin" ? 15_000 : 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) await sleep(50);
  expect(cond()).toBe(true);
}

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
    timeout: 20_000,
  }, async () => {
    const dir = path.join(tmp, "present");
    fs.mkdirSync(dir);
    const events: number[] = [];
    stops.push(watchDirWhenReady(dir, () => events.push(1)));

    expect(events.length).toBe(1); // the attach kick, synchronous

    fs.writeFileSync(path.join(dir, "a"), "x");
    await waitFor(() => events.length >= 2);
  });

  it("waits up the ancestor chain and attaches when the dir appears", {
    timeout: 20_000,
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
    await waitFor(() => events.length === 1); // attach kick

    fs.writeFileSync(path.join(nested, "f"), "x");
    await waitFor(() => events.length >= 2);
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
