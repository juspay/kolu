/** Pins the dir-children watcher's SEMANTICS — refcount sharing, burst
 *  coalescing, error-retirement, install-failure absorption — with `fs.watch`
 *  mocked (the sibling `refcounted-dir-watcher.test.ts` reasoning: a real
 *  kernel watcher adds an unrelated inotify/FSEvents scheduling race to
 *  exactly the windows under test). */

import fs from "node:fs";
import type { FSWatcher } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COALESCE_DEBOUNCE_MS } from "./coalesce-schedule.ts";
import {
  _dirChildrenWatcherCount,
  _resetDirChildrenWatchers,
  subscribeDirChildren,
} from "./dir-children-watcher.ts";

interface MockWatch {
  fire: () => void;
  error: (e: Error) => void;
  closed: boolean;
}

function mockFsWatch(): MockWatch[] {
  const installs: MockWatch[] = [];
  vi.spyOn(fs, "watch").mockImplementation(((_dir: string, cb: () => void) => {
    const handlers = new Map<string, (e: Error) => void>();
    const m: MockWatch = {
      fire: () => cb(),
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

describe("subscribeDirChildren", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetDirChildrenWatchers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shares ONE handle per dir and coalesces a burst into one tick", () => {
    const installs = mockFsWatch();
    const seenA: number[] = [];
    const seenB: number[] = [];
    subscribeDirChildren("/some/dir", () => seenA.push(1));
    subscribeDirChildren("/some/dir", () => seenB.push(1));
    expect(installs).toHaveLength(1);
    expect(_dirChildrenWatcherCount()).toBe(1);

    installs[0]?.fire();
    installs[0]?.fire();
    installs[0]?.fire();
    expect(seenA).toHaveLength(0); // debounced, not synchronous
    vi.advanceTimersByTime(COALESCE_DEBOUNCE_MS + 1);
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);
  });

  it("tears the handle down on LAST unsubscribe only, idempotently", () => {
    const installs = mockFsWatch();
    const unsubA = subscribeDirChildren("/some/dir", () => {});
    const unsubB = subscribeDirChildren("/some/dir", () => {});
    unsubA();
    unsubA(); // double-call must not tear down B's subscription
    expect(installs[0]?.closed).toBe(false);
    expect(_dirChildrenWatcherCount()).toBe(1);
    unsubB();
    expect(installs[0]?.closed).toBe(true);
    expect(_dirChildrenWatcherCount()).toBe(0);
  });

  it("dispatches one final tick and retires when the watch errors; a later subscribe reinstalls", () => {
    const installs = mockFsWatch();
    const seen: number[] = [];
    subscribeDirChildren("/some/dir", () => seen.push(1));
    installs[0]?.error(new Error("EPERM: dir deleted"));
    // The final tick is synchronous — retire destroys the coalesce timer, so
    // a scheduled tick would be silently lost.
    expect(seen).toHaveLength(1);
    expect(installs[0]?.closed).toBe(true);
    expect(_dirChildrenWatcherCount()).toBe(0);

    subscribeDirChildren("/some/dir", () => {});
    expect(installs).toHaveLength(2);
    expect(_dirChildrenWatcherCount()).toBe(1);
  });

  it("absorbs an install-time failure into a never-firing subscription", () => {
    vi.spyOn(fs, "watch").mockImplementation(() => {
      throw new Error("ENOENT: no such directory");
    });
    const unsub = subscribeDirChildren("/gone/dir", () => {
      throw new Error("must never fire");
    });
    expect(_dirChildrenWatcherCount()).toBe(0);
    unsub(); // and the no-op unsubscribe is safe
  });
});
