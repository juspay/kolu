/** Unit matrix for `watchDirWhenReady` — the ancestor-wait that attaches an
 *  `fs.watch` to a directory which may not exist yet. Real timers (OS watch
 *  delivery is a real async channel; fake timers cannot drive it). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchDirWhenReady } from "./dir-appear-watcher.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** fs.watch delivery on Linux is quick but not synchronous; settle windows
 *  stay generous so the assertion is about logic, never scheduler luck. */
const settle = () => sleep(300);

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
  it("fires once on attach (reconcile kick), then on events in the dir", async () => {
    const dir = path.join(tmp, "present");
    fs.mkdirSync(dir);
    const events: number[] = [];
    stops.push(watchDirWhenReady(dir, () => events.push(1)));

    expect(events.length).toBe(1); // the attach kick, synchronous

    fs.writeFileSync(path.join(dir, "a"), "x");
    await settle();
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("waits up the ancestor chain and attaches when the dir appears", async () => {
    const nested = path.join(tmp, "a", "b", "c");
    const events: number[] = [];
    stops.push(watchDirWhenReady(nested, () => events.push(1)));
    expect(events.length).toBe(0); // nothing yet — no dir anywhere down a/b/c

    fs.mkdirSync(path.join(tmp, "a"));
    await settle();
    fs.mkdirSync(path.join(tmp, "a", "b"));
    await settle();
    // Intermediate levels do not fire — the target isn't attached yet.
    expect(events.length).toBe(0);

    fs.mkdirSync(nested);
    await settle();
    expect(events.length).toBe(1); // attach kick

    fs.writeFileSync(path.join(nested, "f"), "x");
    await settle();
    expect(events.length).toBeGreaterThanOrEqual(2);
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
