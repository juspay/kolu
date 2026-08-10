import fs from "node:fs";
import type { FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirWatcher,
  DIR_WATCH_POLL_MS,
} from "./refcounted-dir-watcher.ts";

/** A promise plus its resolver — lets a test hold a `resolveDir` open and
 *  release it on demand, so the async-install window is observable. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A no-op logger that records `error` payloads, so a test can assert a
 *  caught failure was logged rather than thrown. */
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

describe("createDirWatcher async install", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "refcounted-watcher-test-"));
    // These tests pin install/reconcile/refcount semantics, not Node's kernel
    // watcher. A real fs.watch adds an unrelated inotify/FSEvents scheduling
    // race to the exact async-install window under test.
    const handle = {
      close() {},
      on() {
        return handle;
      },
    };
    vi.spyOn(fs, "watch").mockReturnValue(handle as unknown as FSWatcher);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The core regression guard: a `resolveDir` that blocks must NOT block the
  // caller. A synchronous resolver (the old design) would freeze the event
  // loop here; the async contract returns immediately and attaches later.
  // This is the property whose absence caused the 2026-06-28 25-minute wedge.
  it("watch() returns synchronously while resolveDir is still pending", async () => {
    const gate = deferred<string | null>();
    const w = createDirWatcher({
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

  // Lost-update guard: the consumer snapshots BEFORE `watch()` and the handle
  // attaches a tick later, so a change in that window would be invisible without
  // a reconciliation tick. `watch()` must fire `onChange` once the handle is
  // live so the consumer re-reads and converges.
  it("fires a reconciliation tick once the watcher is installed", async () => {
    let fires = 0;
    const w = createDirWatcher({
      resolveDir: async (cwd) => cwd,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(tmpDir, () => {
      fires++;
    });
    // Nothing fires synchronously — the resolve hasn't settled yet.
    expect(fires).toBe(0);

    await w._whenSettled();
    // Exactly one reconcile tick after the handle attaches.
    expect(fires).toBe(1);

    stop();
  });

  it("reconciles a changed file when the fs.watch edge is dropped", async () => {
    const head = path.join(tmpDir, "HEAD");
    fs.writeFileSync(head, "ref: refs/heads/master\n");
    const onChange = vi.fn();
    const w = createDirWatcher({
      resolveDir: async (cwd) => cwd,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(tmpDir, onChange);
    await w._whenSettled();
    expect(onChange).toHaveBeenCalledTimes(1); // install reconciliation
    onChange.mockClear();

    // `beforeEach` replaced fs.watch with a no-op handle, so only the stat
    // floor can observe this post-install branch-identity rewrite.
    fs.writeFileSync(head, "ref: refs/heads/watcher-test\n");
    await new Promise((resolve) =>
      setTimeout(resolve, DIR_WATCH_POLL_MS + 500),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  // A throwing reconcile listener must be caught (logged), never reject the
  // settle promise — otherwise the server's unhandledRejection handler exits.
  it("a throwing reconcile listener is caught, not propagated", async () => {
    const { log, errors } = makeTestLog();
    const w = createDirWatcher({
      resolveDir: async (cwd) => cwd,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop = w.watch(
      tmpDir,
      () => {
        throw new Error("reconcile boom");
      },
      log as never,
    );
    // Must settle without an unhandled rejection.
    await w._whenSettled();
    expect(errors.some((e) => e.includes("reconcile boom"))).toBe(true);
    expect(w._watcherCount()).toBe(1);

    stop();
  });

  it("unsubscribing before the resolution settles cancels the install", async () => {
    const gate = deferred<string | null>();
    const w = createDirWatcher({
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

  it("a fresh subscribe after teardown installs a new watcher", async () => {
    const w = createDirWatcher({
      resolveDir: async (cwd) => cwd,
      filename: "HEAD",
      debounceMs: 10,
      logLabel: "test",
    });

    const stop1 = w.watch(tmpDir, () => {});
    await w._whenSettled();
    expect(w._watcherCount()).toBe(1);
    stop1();
    expect(w._watcherCount()).toBe(0);

    const stop2 = w.watch(tmpDir, () => {});
    await w._whenSettled();
    expect(w._watcherCount()).toBe(1);
    stop2();
    expect(w._watcherCount()).toBe(0);

    expect(fs.watch).toHaveBeenCalledTimes(2);
  });

  it("a resolveDir that rejects is caught and logged, never thrown", async () => {
    const { log, errors } = makeTestLog();
    const w = createDirWatcher({
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
    const w = createDirWatcher({
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

/** The SAME factory with no `filename`: every direct-child event fires the
 *  listener (the Code tab's plain-directory browse levels). These cases used to
 *  pin a second, cloned module; they now pin the one receptacle, which is the
 *  point — the difference between the two targets is a parameter, so the
 *  refcount / coalesce / error-retire / install-absorb semantics are asserted
 *  once for both. `fs.watch` is mocked for the same reason as above: a real
 *  kernel watcher adds an unrelated inotify/FSEvents scheduling race to exactly
 *  the windows under test. */
describe("createDirWatcher with no filename (every direct child)", () => {
  interface MockWatch {
    fire: () => void;
    error: (e: Error) => void;
    closed: boolean;
  }

  function mockFsWatch(): MockWatch[] {
    const installs: MockWatch[] = [];
    vi.spyOn(fs, "watch").mockImplementation(((
      _dir: string,
      cb: (event: string, filename: string) => void,
    ) => {
      const handlers = new Map<string, (e: Error) => void>();
      const m: MockWatch = {
        fire: () => cb("rename", "child.txt"),
        error: (e) => handlers.get("error")?.(e),
        closed: false,
      };
      installs.push(m);
      const handle = {
        close() {
          m.closed = true;
        },
        on(event: string, h: (e: Error) => void) {
          handlers.set(event, h);
          return handle;
        },
      };
      return handle as unknown as FSWatcher;
    }) as typeof fs.watch);
    return installs;
  }

  function dirChildren() {
    return createDirWatcher({
      resolveDir: async (dir: string) => dir,
      debounceMs: 10,
      logLabel: "test: children",
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shares ONE handle per dir and coalesces a burst into one tick", async () => {
    const installs = mockFsWatch();
    const w = dirChildren();
    const seenA: number[] = [];
    const seenB: number[] = [];
    w.watch("/some/dir", () => seenA.push(1));
    w.watch("/some/dir", () => seenB.push(1));
    await w._whenSettled();
    expect(installs).toHaveLength(1);
    expect(w._watcherCount()).toBe(1);
    // Each subscriber got its post-install reconcile tick.
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);

    vi.useFakeTimers();
    installs[0]?.fire();
    installs[0]?.fire();
    installs[0]?.fire();
    expect(seenA).toHaveLength(1); // debounced, not synchronous
    vi.advanceTimersByTime(11);
    expect(seenA).toHaveLength(2);
    expect(seenB).toHaveLength(2);
    w._reset();
  });

  it("tears the handle down on LAST unsubscribe only, idempotently", async () => {
    const installs = mockFsWatch();
    const w = dirChildren();
    const unsubA = w.watch("/some/dir", () => {});
    const unsubB = w.watch("/some/dir", () => {});
    await w._whenSettled();
    unsubA();
    unsubA(); // double-call must not tear down B's subscription
    expect(installs[0]?.closed).toBe(false);
    expect(w._watcherCount()).toBe(1);
    unsubB();
    expect(installs[0]?.closed).toBe(true);
    expect(w._watcherCount()).toBe(0);
  });

  it("dispatches one final tick and retires when the watch errors; a later subscribe reinstalls", async () => {
    const installs = mockFsWatch();
    const w = dirChildren();
    const seen: number[] = [];
    w.watch("/some/dir", () => seen.push(1));
    await w._whenSettled();
    expect(seen).toHaveLength(1); // install reconciliation
    installs[0]?.error(new Error("EPERM: dir deleted"));
    // The final tick is synchronous — retire destroys the coalesce timer, so
    // a scheduled tick would be silently lost.
    expect(seen).toHaveLength(2);
    expect(installs[0]?.closed).toBe(true);
    expect(w._watcherCount()).toBe(0);

    w.watch("/some/dir", () => {});
    await w._whenSettled();
    expect(installs).toHaveLength(2);
    expect(w._watcherCount()).toBe(1);
    w._reset();
  });

  it("absorbs an install-time failure into a never-firing subscription", async () => {
    vi.spyOn(fs, "watch").mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such directory"), {
        code: "ENOENT",
      });
    });
    const w = dirChildren();
    const unsub = w.watch("/gone/dir", () => {
      throw new Error("must never fire");
    });
    await w._whenSettled();
    expect(w._watcherCount()).toBe(0);
    unsub(); // and the no-op unsubscribe is safe
  });
});
