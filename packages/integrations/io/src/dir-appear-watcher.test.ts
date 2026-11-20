import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchDirWhenReady } from "./dir-appear-watcher.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(300);

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

    expect(events.length).toBe(1);

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
    stops.push(
      watchDirWhenReady(nested, () => {
        events.push(1);
        if (events.length === 1)
          fs.writeFileSync(path.join(nested, "startup"), "x");
      }),
    );
    expect(events.length).toBe(0);

    fs.mkdirSync(path.join(tmp, "a"));
    fs.mkdirSync(path.join(tmp, "a", "b"));
    expect(events.length).toBe(0);

    fs.mkdirSync(nested);
    const ancestors = [tmp, path.join(tmp, "a"), path.join(tmp, "a", "b")];
    await waitForWatch(
      () => events.length >= 1,
      () => {
        for (const ancestor of ancestors)
          fs.writeFileSync(path.join(ancestor, ".nudge"), "");
      },
    );

    const beforeWrite = events.length;
    const file = path.join(nested, "f");
    fs.writeFileSync(file, "x");
    await waitForWatch(
      () => events.length > beforeWrite,
      () => retouch(file),
    );
  });

  it("unsubscribe is idempotent and silences further events", async () => {
    const dir = path.join(tmp, "gone");
    fs.mkdirSync(dir);
    const events: number[] = [];
    const stop = watchDirWhenReady(dir, () => events.push(1));
    stop();
    stop();

    fs.writeFileSync(path.join(dir, "a"), "x");
    await settle();
    expect(events.length).toBe(1);
  });
});
