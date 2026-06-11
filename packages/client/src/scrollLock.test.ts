import type { Terminal } from "@xterm/xterm";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScrollLock, SCROLL_INTENT_WINDOW_MS } from "./scrollLock";

/** Minimal xterm stand-in with faithful scroll semantics: `onScroll` fires
 *  only when the viewport actually moves (xterm's BufferService early-returns
 *  otherwise), and `scrollToBottom()` is a no-op event-wise when already at
 *  the bottom (CoreBrowserTerminal gates on `ybase !== ydisp`). */
function makeMockTerm() {
  const handlers: ((y: number) => void)[] = [];
  const buf = { baseY: 0, viewportY: 0, type: "normal" as const };
  const written: string[] = [];

  function fire() {
    for (const h of [...handlers]) h(buf.viewportY);
  }

  const term = {
    buffer: { active: buf },
    onScroll(h: (y: number) => void) {
      handlers.push(h);
      return {
        dispose() {
          const i = handlers.indexOf(h);
          if (i >= 0) handlers.splice(i, 1);
        },
      };
    },
    write(d: string) {
      written.push(d);
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
    /** New PTY lines land while the viewport is pinned to the bottom —
     *  baseY and viewportY advance together, firing onScroll. */
    emitOutputAtBottom(lines: number) {
      buf.baseY += lines;
      buf.viewportY = buf.baseY;
      fire();
    },
    /** The viewport moves up `lines` rows (wheel, touch bridge, alt-buffer
     *  exit, smooth-scroll tick — the emitter is whatever the test says). */
    scrollUp(lines: number) {
      buf.viewportY = Math.max(0, buf.viewportY - lines);
      fire();
    },
  };
}

/** Build a lock attached to a fresh mock terminal inside a Solid root. The
 *  Node test environment has no `document`, so visibility is injected and
 *  mutable via the returned `setVisibility`. */
function setup(enabled: () => boolean | undefined = () => true) {
  const mock = makeMockTerm();
  let visibility = "visible";
  let lock!: ReturnType<typeof createScrollLock>;
  const dispose = createRoot((d) => {
    lock = createScrollLock(enabled, () => visibility);
    lock.attachToTerminal(mock.term);
    return d;
  });
  // Give the buffer some scrollback to scroll into.
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
    // The snap-back is deferred out of xterm's scroll dispatch (the
    // Viewport drops re-entrant scrolls) — one microtask later it lands.
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

    t.buf.viewportY = t.buf.baseY; // user scrolled back down
    t.scrollUp(0); // fire at-bottom onScroll
    expect(t.lock.isLocked()).toBe(false);
    expect(t.written).toEqual(["ab"]);
    expect(t.lock.pendingChunks()).toBe(0);
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
    vi.setSystemTime(60_000); // intent long expired
    t.scrollUp(5); // user paging further up through scrollback
    expect(t.lock.isLocked()).toBe(true);
    expect(t.lock.lastEvent()?.kind).toBe("locked"); // no new event recorded
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
    // Scrollbar drag / selection auto-scroll emit onScroll ticks for as long
    // as the button is down — long past SCROLL_INTENT_WINDOW_MS after press.
    const t = setup();
    t.lock.holdUserScrollIntent("pointer");
    // First tick well after the window would have expired.
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

  it("still honors the time window after release for the trailing press", () => {
    // A pointerup arrives, but the gesture's final onScroll lands a beat
    // later — within the window, it should still count as user intent.
    const t = setup();
    t.lock.holdUserScrollIntent("pointer");
    t.lock.releaseUserScrollIntent();
    t.scrollUp(10); // same instant — inside the window
    expect(t.lock.isLocked()).toBe(true);
    t.dispose();
  });
});

describe("createScrollLock — tab-return unlatch (#1272)", () => {
  it("flushes and rejoins the bottom when a lock engaged while hidden returns", () => {
    const t = setup();
    // Latch while the tab is in the background — the accidental/background
    // class that must not present as a frozen terminal on return.
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
    // Scroll up to read output (visible), glance at another browser tab, come
    // back — the position and buffered output must survive (#1272).
    const t = setup();
    t.lock.armUserScrollIntent("wheel");
    t.scrollUp(10); // visibility defaults to "visible"
    t.lock.writeData(t.term, "held");
    expect(t.lock.isLocked()).toBe(true);

    t.lock.handleTabVisible();
    expect(t.lock.isLocked()).toBe(true);
    expect(t.written).toEqual([]); // not flushed
    expect(t.lock.pendingChunks()).toBe(1);
    expect(t.buf.viewportY).toBe(t.buf.baseY - 10); // position kept
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
      t.scrollUp(10); // suppressed (no intent) → snaps back, records one event
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
    // Disabled means hands-off: no snap-back either — xterm's native
    // behavior owns the viewport.
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
