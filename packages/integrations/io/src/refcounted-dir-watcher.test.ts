import fs from "node:fs";
import type { FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirFilenameWatcher,
  DIR_FILENAME_POLL_MS,
  listDirWatcherRows,
} from "./refcounted-dir-watcher.ts";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeTestLog(): { log: unknown; errors: string[] } {
  const errors: string[] = [];
  const log = {
    info() {},
    debug() {},
    warn() {},
    error(obj: { err?: unknown }) {
      errors.push(String(obj.err));
    },
  };
  return { log, errors };
}

describe("createDirFilenameWatcher async install", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "refcounted-watcher-test-"));
    vi.spyOn(fs, "watch").mockReturnValue({
      close() {},
    } as FSWatcher);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("watch() returns synchronously while resolveDir is still pending", async () => {
    const gate = deferred<string | null>();
    const w = createDirFilenameWatcher({
      resolveDir: () => gate.promise,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(tmpDir, "test", () => {});
    expect(typeof stop).toBe("function");
    expect(w._watcherCount()).toBe(0);

    await Promise.resolve();
    expect(w._watcherCount()).toBe(0);

    gate.resolve(tmpDir);
    await w._whenSettled();
    expect(w._watcherCount()).toBe(1);

    stop();
    expect(w._watcherCount()).toBe(0);
  });

  it("fires a reconciliation tick once the watcher is installed", async () => {
    let fires = 0;
    const w = createDirFilenameWatcher({
      resolveDir: async (cwd) => cwd,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(tmpDir, "test", () => {
      fires++;
    });
    expect(fires).toBe(0);

    await w._whenSettled();
    expect(fires).toBe(1);

    stop();
  });

  it("reconciles a changed file when the fs.watch edge is dropped", async () => {
    const head = path.join(tmpDir, "HEAD");
    fs.writeFileSync(head, "ref: refs/heads/master\n");
    const onChange = vi.fn();
    const w = createDirFilenameWatcher({
      resolveDir: async (cwd) => cwd,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(tmpDir, "test", onChange);
    await w._whenSettled();
    expect(onChange).toHaveBeenCalledTimes(1);
    onChange.mockClear();

    fs.writeFileSync(head, "ref: refs/heads/watcher-test\n");
    await new Promise((resolve) =>
      setTimeout(resolve, DIR_FILENAME_POLL_MS + 500),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a throwing reconcile listener is caught, not propagated", async () => {
    const { log, errors } = makeTestLog();
    const w = createDirFilenameWatcher({
      resolveDir: async (cwd) => cwd,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(
      tmpDir,
      "test",
      () => {
        throw new Error("reconcile boom");
      },
      log as never,
    );
    await w._whenSettled();
    expect(errors.some((e) => e.includes("reconcile boom"))).toBe(true);
    expect(w._watcherCount()).toBe(1);

    stop();
  });

  it("unsubscribing before the resolution settles cancels the install", async () => {
    const gate = deferred<string | null>();
    const w = createDirFilenameWatcher({
      resolveDir: () => gate.promise,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(tmpDir, "test", () => {});
    stop();

    gate.resolve(tmpDir);
    await w._whenSettled();
    expect(w._watcherCount()).toBe(0);
  });

  it("a fresh subscribe after teardown installs a new watcher", async () => {
    const w = createDirFilenameWatcher({
      resolveDir: async (cwd) => cwd,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop1 = w.watch(tmpDir, "test", () => {});
    await w._whenSettled();
    expect(w._watcherCount()).toBe(1);
    stop1();
    expect(w._watcherCount()).toBe(0);

    const stop2 = w.watch(tmpDir, "test", () => {});
    await w._whenSettled();
    expect(w._watcherCount()).toBe(1);
    stop2();
    expect(w._watcherCount()).toBe(0);

    expect(fs.watch).toHaveBeenCalledTimes(2);
  });

  it("lists one row for a directory two askers share, gone with the last", async () => {
    const w = createDirFilenameWatcher({
      resolveDir: async (cwd) => cwd,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "rows-test",
    });
    const rowsHere = () =>
      listDirWatcherRows().filter((r) => r.kind === "rows-test");

    const stopA = w.watch(tmpDir, "terminal a", () => {});
    const stopB = w.watch(
      tmpDir,
      () => ["stream b"],
      () => {},
    );
    await w._whenSettled();
    const rows = rowsHere();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dir: tmpDir,
      file: "HEAD",
      askers: ["terminal a", "stream b"],
    });
    expect(rows[0]?.installMs).toBeGreaterThanOrEqual(0);

    stopA();
    expect(rowsHere()[0]?.askers).toEqual(["stream b"]);
    stopB();
    expect(rowsHere()).toEqual([]);
  });

  it("a resolveDir that rejects is caught and logged, never thrown", async () => {
    const { log, errors } = makeTestLog();
    const w = createDirFilenameWatcher({
      resolveDir: () => Promise.reject(new Error("resolver boom")),
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(tmpDir, "test", () => {}, log as never);
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

    w.watch(tmpDir, "test", () => {});
    w._reset();

    gate.resolve(tmpDir);
    await w._whenSettled();
    expect(w._watcherCount()).toBe(0);
  });
});
