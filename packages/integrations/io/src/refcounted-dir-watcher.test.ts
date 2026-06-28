import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDirFilenameWatcher } from "./refcounted-dir-watcher.ts";

/** A promise plus its resolver — lets a test hold a `resolveDir` open and
 *  release it on demand, so the async-install window is observable. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createDirFilenameWatcher async install", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "refcounted-watcher-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The core regression guard: a `resolveDir` that blocks must NOT block the
  // caller. A synchronous resolver (the old design) would freeze the event
  // loop here; the async contract returns immediately and attaches later.
  // This is the property whose absence caused the 2026-06-28 25-minute wedge.
  it("watch() returns synchronously while resolveDir is still pending", async () => {
    const gate = deferred<string | null>();
    const w = createDirFilenameWatcher({
      resolveDir: () => gate.promise,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    // If `watch()` awaited `resolveDir`, this line would never be reached
    // until the gate opened. It returns an unsubscribe immediately, and the
    // install has not happened yet (the resolver hasn't resolved).
    const stop = w.watch(tmpDir, () => {});
    expect(typeof stop).toBe("function");
    expect(w._watcherCount()).toBe(0);

    // The event loop is live: a microtask runs while resolveDir is parked.
    await Promise.resolve();
    expect(w._watcherCount()).toBe(0);

    // Release the gate at the real dir → the install settles and attaches.
    gate.resolve(tmpDir);
    await w._whenSettled();
    expect(w._watcherCount()).toBe(1);

    stop();
    expect(w._watcherCount()).toBe(0);
  });

  it("unsubscribing before the resolution settles cancels the install", async () => {
    const gate = deferred<string | null>();
    const w = createDirFilenameWatcher({
      resolveDir: () => gate.promise,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(tmpDir, () => {});
    stop(); // cancel while the resolver is still pending

    gate.resolve(tmpDir);
    await w._whenSettled();
    // The pending install saw the cancellation and never attached.
    expect(w._watcherCount()).toBe(0);
  });

  it("a resolveDir that rejects is caught and logged, never thrown", async () => {
    const errors: string[] = [];
    const log = {
      info() {},
      debug() {},
      warn() {},
      error(obj: { err?: unknown }) {
        errors.push(String(obj.err));
      },
    };
    const w = createDirFilenameWatcher({
      resolveDir: () => Promise.reject(new Error("resolver boom")),
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    // Must not throw synchronously...
    const stop = w.watch(tmpDir, () => {}, log as never);
    // ...nor reject the in-flight install (otherwise an unhandled rejection).
    await w._whenSettled();

    expect(w._watcherCount()).toBe(0);
    expect(errors.some((e) => e.includes("resolver boom"))).toBe(true);
    stop();
  });

  it("_reset() discards a resolution still pending from before the reset", async () => {
    const gate = deferred<string | null>();
    const w = createDirFilenameWatcher({
      resolveDir: () => gate.promise,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    w.watch(tmpDir, () => {});
    w._reset(); // bumps the generation while the resolution is in flight

    gate.resolve(tmpDir);
    await w._whenSettled();
    // The stale resolution must not install into the fresh registry.
    expect(w._watcherCount()).toBe(0);
  });
});
