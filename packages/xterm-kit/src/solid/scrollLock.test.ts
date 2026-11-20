import type { Terminal } from "@xterm/xterm";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScrollLock, SCROLL_INTENT_WINDOW_MS } from "./scrollLock";

function fakeXtermScrollSemantics() {
  const handlers: ((y: number) => void)[] = [];
  const buf = { baseY: 0, viewportY: 0, type: "normal" as const };
  const written: string[] = [];
  const trace: string[] = [];
  const grid = { cols: 80, rows: 24 };

  function fire() {
    for (const h of [...handlers]) h(buf.viewportY);
  }

  const term = {
    buffer: { active: buf },
    get cols() {
      return grid.cols;
    },
    get rows() {
      return grid.rows;
    },
    onScroll(h: (y: number) => void) {
      handlers.push(h);
      return {
        dispose() {
          const i = handlers.indexOf(h);
          if (i >= 0) handlers.splice(i, 1);
        },
      };
    },
    write(d: string, cb?: () => void) {
      written.push(d);
      trace.push(`w:${d}`);
      cb?.();
    },
    resize(cols: number, rows: number) {
      grid.cols = cols;
      grid.rows = rows;
      trace.push(`r:${cols}x${rows}`);
    },
    scrollToBottom() {
      if (buf.viewportY === buf.baseY) return;
      buf.viewportY = buf.baseY;
      fire();
    },
  };

  return {
    term: term as unknown as Terminal,
    buf,
    written,
    trace,
    grid: () => ({ cols: grid.cols, rows: grid.rows }),
    emitOutputAtBottom(lines: number) {
      buf.baseY += lines;
      buf.viewportY = buf.baseY;
      fire();
    },
    scrollUp(lines: number) {
      buf.viewportY = Math.max(0, buf.viewportY - lines);
      fire();
    },
  };
}

function setup(enabled: () => boolean | undefined = () => true) {
  const mock = fakeXtermScrollSemantics();
  let visibility = "visible";
  let lock!: ReturnType<typeof createScrollLock>;
  const dispose = createRoot((d) => {
    lock = createScrollLock(enabled, () => visibility);
    lock.attachToTerminal(mock.term);
    return d;
  });
  mock.emitOutputAtBottom(100);
  return {
    ...mock,
    lock,
    dispose,
    setVisibility(v: "visible" | "hidden") {
      visibility = v;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createScrollLock — user-intent latch (#1272)", () => {
  it("does not latch on an off-bottom scroll with no user intent, and snaps back to bottom", async () => {
    const t = setup();
    t.scrollUp(10);
    expect(t.lock.isLocked()).toBe(false);
    expect(t.lock.lastEvent()?.kind).toBe("suppressed");
    await Promise.resolve();
    expect(t.buf.viewportY).toBe(t.buf.baseY);
    t.dispose();
  });

  it("keeps output flowing after a suppressed scroll", () => {
    const t = setup();
    t.scrollUp(10);
    t.lock.writeData(t.term, "hello");
    expect(t.written).toContain("hello");
    expect(t.lock.pendingChunks()).toBe(0);
    t.dispose();
  });

  it("latches on a scroll within the intent window and buffers output", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    expect(t.lock.isLocked()).toBe(true);
    expect(t.lock.lastEvent()).toMatchObject({
      kind: "locked",
      source: "wheel",
    });

    t.lock.writeData(t.term, "a");
    t.lock.writeData(t.term, "b");
    expect(t.written).toEqual([]);
    expect(t.lock.pendingChunks()).toBe(2);
    expect(t.lock.hasNewOutput()).toBe(true);
    t.dispose();
  });

  it("flushes buffered output in order when the user returns to the bottom", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    t.lock.writeData(t.term, "a");
    t.lock.writeData(t.term, "b");

    t.buf.viewportY = t.buf.baseY;
    t.scrollUp(0);
    expect(t.lock.isLocked()).toBe(false);
    expect(t.written).toEqual(["ab"]);
    expect(t.lock.pendingChunks()).toBe(0);
    t.dispose();
  });

  it("fires a buffered chunk's onParsed callback on flush (backfill seed survives the lock)", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    let seeded = false;
    t.lock.writeData(t.term, "SNAPSHOT", () => {
      seeded = true;
    });
    expect(seeded).toBe(false);
    expect(t.written).toEqual([]);

    t.buf.viewportY = t.buf.baseY;
    t.scrollUp(0);
    expect(t.written).toEqual(["SNAPSHOT"]);
    expect(seeded).toBe(true);
    t.dispose();
  });

  it("expires intent after the window", async () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    vi.setSystemTime(10_000 + SCROLL_INTENT_WINDOW_MS + 1);
    t.scrollUp(10);
    expect(t.lock.isLocked()).toBe(false);
    expect(t.lock.lastEvent()?.kind).toBe("suppressed");
    await Promise.resolve();
    expect(t.buf.viewportY).toBe(t.buf.baseY);
    t.dispose();
  });

  it("keeps an engaged lock across further scrolls without re-arming", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    vi.setSystemTime(60_000);
    t.scrollUp(5);
    expect(t.lock.isLocked()).toBe(true);
    expect(t.lock.lastEvent()?.kind).toBe("locked");
    t.dispose();
  });

  it("treats touch, keyboard, search, and pointer intents like wheel", () => {
    for (const source of ["touch", "keyboard", "search", "pointer"] as const) {
      const t = setup();
      t.lock.armUserScrollIntent(source);
      t.scrollUp(10);
      expect(t.lock.isLocked()).toBe(true);
      expect(t.lock.lastEvent()?.source).toBe(source);
      t.dispose();
    }
  });
});

describe("createScrollLock — held pointer intent (#1272)", () => {
  it("stays armed past the time window while a pointer is held", () => {
    const t = setup();
    t.lock.holdUserScrollIntent("pointer");
    vi.setSystemTime(10_000 + SCROLL_INTENT_WINDOW_MS + 1000);
    t.scrollUp(5);
    expect(t.lock.isLocked()).toBe(true);
    expect(t.lock.lastEvent()?.source).toBe("pointer");
    t.dispose();
  });

  it("expires normally once the pointer is released", async () => {
    const t = setup();
    t.lock.holdUserScrollIntent("pointer");
    t.lock.releaseUserScrollIntent();
    vi.setSystemTime(10_000 + SCROLL_INTENT_WINDOW_MS + 1);
    t.scrollUp(10);
    expect(t.lock.isLocked()).toBe(false);
    expect(t.lock.lastEvent()?.kind).toBe("suppressed");
    await Promise.resolve();
    expect(t.buf.viewportY).toBe(t.buf.baseY);
    t.dispose();
  });

  it("leaves no intent tail once the pointer is released", async () => {
    const t = setup();
    t.lock.holdUserScrollIntent("pointer");
    t.lock.releaseUserScrollIntent();
    t.scrollUp(10);
    expect(t.lock.isLocked()).toBe(false);
    expect(t.lock.lastEvent()?.kind).toBe("suppressed");
    await Promise.resolve();
    expect(t.buf.viewportY).toBe(t.buf.baseY);
    t.dispose();
  });
});

describe("createScrollLock — tab-return unlatch (#1272)", () => {
  it("flushes and rejoins the bottom when a lock engaged while hidden returns", () => {
    const t = setup();
    t.setVisibility("hidden");
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    t.lock.writeData(t.term, "missed");

    t.setVisibility("visible");
    t.lock.handleTabVisible();
    expect(t.lock.isLocked()).toBe(false);
    expect(t.written).toEqual(["missed"]);
    expect(t.buf.viewportY).toBe(t.buf.baseY);
    expect(t.lock.lastEvent()?.kind).toBe("unlatched");
    t.dispose();
  });

  it("preserves a lock the user made with the tab in front", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    t.lock.writeData(t.term, "held");
    expect(t.lock.isLocked()).toBe(true);

    t.lock.handleTabVisible();
    expect(t.lock.isLocked()).toBe(true);
    expect(t.written).toEqual([]);
    expect(t.lock.pendingChunks()).toBe(1);
    expect(t.buf.viewportY).toBe(t.buf.baseY - 10);
    t.dispose();
  });

  it("does nothing on tab return when not locked", () => {
    const t = setup();
    t.lock.handleTabVisible();
    expect(t.lock.lastEvent()).toBeNull();
    expect(t.written).toEqual([]);
    t.dispose();
  });
});

describe("createScrollLock — instrumentation (#1272)", () => {
  it("records forensic fields on the lock transition", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    const ev = t.lock.lastEvent();
    expect(ev).toMatchObject({
      kind: "locked",
      source: "wheel",
      baseY: 100,
      viewportY: 90,
      bufferType: "normal",
    });
    expect(ev?.at).toBe(10_000);
    expect(typeof ev?.stack).toBe("string");
    t.dispose();
  });

  it("keeps a bounded ring of events", () => {
    const t = setup();
    for (let i = 0; i < 30; i++) {
      t.scrollUp(10);
    }
    expect(t.lock.events().length).toBeLessThanOrEqual(20);
    expect(t.lock.events().every((e) => e.kind === "suppressed")).toBe(true);
    t.dispose();
  });
});

describe("createScrollLock — existing semantics preserved", () => {
  it("passes writes straight through when disabled", () => {
    const t = setup(() => false);
    t.scrollUp(10);
    expect(t.lock.isLocked()).toBe(false);
    expect(t.buf.viewportY).toBe(t.buf.baseY - 10);
    t.lock.writeData(t.term, "x");
    expect(t.written).toContain("x");
    t.dispose();
  });

  it("reset() flushes and unlocks", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    t.lock.writeData(t.term, "pending");
    t.lock.reset();
    expect(t.lock.isLocked()).toBe(false);
    expect(t.written).toEqual(["pending"]);
    t.dispose();
  });

  it("scrollToBottom() flushes, unlocks, and pins the viewport", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    t.lock.writeData(t.term, "pending");
    t.lock.scrollToBottom(t.term);
    expect(t.lock.isLocked()).toBe(false);
    expect(t.written).toEqual(["pending"]);
    expect(t.buf.viewportY).toBe(t.buf.baseY);
    t.dispose();
  });
});

describe("createScrollLock — a resize keeps its place in the stream", () => {
  it("applies a resize immediately when the lock is not engaged", () => {
    const t = setup();
    t.lock.writeData(t.term, "a");
    t.lock.resizeInOrder(100, 40);
    t.lock.writeData(t.term, "b");
    expect(t.trace).toEqual(["w:a", "r:100x40", "w:b"]);
    expect(t.grid()).toEqual({ cols: 100, rows: 40 });
    t.dispose();
  });

  it("holds a resize behind the bytes it followed and replays both in order", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);
    expect(t.lock.isLocked()).toBe(true);

    t.lock.writeData(t.term, "before");
    t.lock.resizeInOrder(100, 40);
    t.lock.writeData(t.term, "after");
    expect(t.trace).toEqual([]);
    expect(t.grid()).toEqual({ cols: 80, rows: 24 });
    expect(t.lock.pendingChunks()).toBe(2);

    t.buf.viewportY = t.buf.baseY;
    t.lock.handleTabVisible();
    t.lock.reset();
    expect(t.trace).toEqual(["w:before", "r:100x40", "w:after"]);
    expect(t.grid()).toEqual({ cols: 100, rows: 40 });
    t.dispose();
  });

  it("replays several held resizes each at its own point in the byte stream", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);

    t.lock.writeData(t.term, "a");
    t.lock.resizeInOrder(90, 30);
    t.lock.writeData(t.term, "b");
    t.lock.resizeInOrder(70, 20);
    t.lock.writeData(t.term, "c");
    t.lock.reset();
    expect(t.trace).toEqual(["w:a", "r:90x30", "w:b", "r:70x20", "w:c"]);
    t.dispose();
  });

  it("fires a held chunk's onParsed before the resize that follows it", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);

    const order: string[] = [];
    t.lock.writeData(t.term, "snapshot", () => order.push("parsed"));
    t.lock.resizeInOrder(100, 40);
    t.lock.reset();
    expect(order).toEqual(["parsed"]);
    expect(t.trace).toEqual(["w:snapshot", "r:100x40"]);
    t.dispose();
  });

  it("drops held resizes with the bytes on a fresh-snapshot drop", () => {
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10);

    t.lock.writeData(t.term, "stale");
    t.lock.resizeInOrder(100, 40);
    t.lock.dropPending();
    t.lock.reset();
    expect(t.trace).toEqual([]);
    expect(t.grid()).toEqual({ cols: 80, rows: 24 });
    t.dispose();
  });
});
