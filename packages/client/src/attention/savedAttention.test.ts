import type { TerminalId } from "kolu-common/surface";
import { flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { type AttentionRecord, createAttentionRecord } from "./savedAttention";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;
const B = "22222222-2222-4222-8222-222222222222" as TerminalId;
const NAME = "kolu-attention:local";

/** A browser's storage, held across "page loads" the way localStorage is.
 *  With `announceFrom`, every write is also announced as a `storage` event
 *  from a page at that address — what the browser does for every OTHER page
 *  of the same origin. Two records in this one window both hear it, the
 *  writer included, as two pages would. With `held`, an announcement is
 *  queued there instead of dispatched, and the test delivers it later — the
 *  browser's event reaches the other page after the write, not during it. */
function memoryStorage(
  opts: { announceFrom?: string; held?: StorageEvent[] } = {},
): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => {
      const oldValue = items.get(key) ?? null;
      items.set(key, value);
      if (opts.announceFrom === undefined) return;
      const event = new StorageEvent("storage", {
        key,
        oldValue,
        newValue: value,
        url: opts.announceFrom,
      });
      if (opts.held === undefined) window.dispatchEvent(event);
      else opts.held.push(event);
    },
  };
}

describe("a host's saved attention record", () => {
  it("round-trips: a page loaded later reads back the marks and the engine's memory", () => {
    const storage = memoryStorage();
    const before = createAttentionRecord({ name: NAME, storage });
    before.markUnread(A);
    before.remember({
      frame: { asking: [], finished: [A, B] },
      latched: [A, B],
      unseenFinished: [B],
    });
    // The writes reach storage on the flush that follows them, which is what
    // a later page load reads.
    flush();

    const after = createAttentionRecord({ name: NAME, storage });
    // …and the fresh page's marks projection publishes on its own first flush.
    flush();
    expect(after.isUnread(A)).toBe(true);
    expect(after.isUnread(B)).toBe(false);
    expect(after.memory()).toEqual({
      frame: { asking: [], finished: [A, B] },
      latched: [A, B],
      unseenFinished: [B],
    });
  });

  it("a mark taken off is gone after a reload too", () => {
    const storage = memoryStorage();
    const before = createAttentionRecord({ name: NAME, storage });
    before.markUnread(A);
    before.markUnread(B);
    before.clearUnread(A);
    expect(createAttentionRecord({ name: NAME, storage }).isUnread(A)).toBe(
      false,
    );
    before.clearAllUnread();
    expect(createAttentionRecord({ name: NAME, storage }).isUnread(B)).toBe(
      false,
    );
  });

  it("a browser that saved nothing starts blank — the engine takes its first frame as a baseline", () => {
    const record = createAttentionRecord({
      name: NAME,
      storage: memoryStorage(),
    });
    expect(record.memory()).toBeNull();
    expect(record.isUnread(A)).toBe(false);
  });

  it("a record that does not validate is dropped with a warning, and the host starts blank", () => {
    const storage = memoryStorage();
    storage.setItem(NAME, JSON.stringify({ memory: { frame: 7 }, unread: [] }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const record = createAttentionRecord({ name: NAME, storage });
      expect(record.memory()).toBeNull();
      expect(record.isUnread(A)).toBe(false);
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain(NAME);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ["at the same address", () => location.href],
    [
      "at a different address — a page opened from a kolu link keeps it",
      () => new URL("#/h/local", location.href).href,
    ],
  ])("two pages of one browser %s: a mark read in one is not unread in the other, and the other's next write does not bring it back", (_, writerAddress) => {
    const storage = memoryStorage({ announceFrom: writerAddress() });
    const first = createAttentionRecord({ name: NAME, storage });
    first.markUnread(A);
    // The second page loads with terminal A unread.
    const second = createAttentionRecord({ name: NAME, storage });
    // Each page's marks are a projection: a write (here, and the storage event
    // the other page hears) publishes on the next flush.
    flush();
    expect(second.isUnread(A)).toBe(true);

    first.clearUnread(A);
    flush();
    expect(second.isUnread(A)).toBe(false);

    // The second page's next write keeps the first page's read.
    second.markUnread(B);
    const saved: unknown = JSON.parse(storage.getItem(NAME) ?? "null");
    expect(saved).toMatchObject({ unread: [B] });
  });

  it.each([
    [
      "marks another terminal unread",
      (page: AttentionRecord) => page.markUnread(B),
    ],
    [
      "saves the engine's memory",
      (page: AttentionRecord) =>
        page.remember({
          frame: { asking: [], finished: [A] },
          latched: [A],
          unseenFinished: [],
        }),
    ],
  ])("two pages: a mark read in one stays read when the other %s before the browser has told it of the read", (_, write) => {
    const held: StorageEvent[] = [];
    const storage = memoryStorage({ announceFrom: location.href, held });
    const first = createAttentionRecord({ name: NAME, storage });
    first.markUnread(A);
    const second = createAttentionRecord({ name: NAME, storage });
    held.length = 0;

    first.clearUnread(A);
    write(second);
    for (const event of held.splice(0)) window.dispatchEvent(event);
    // Both pages' marks publish on the flush after the events land.
    flush();

    const saved = JSON.parse(storage.getItem(NAME) ?? "null") as {
      unread: TerminalId[];
    };
    expect(saved.unread).not.toContain(A);
    expect(first.isUnread(A)).toBe(false);
    expect(second.isUnread(A)).toBe(false);
  });
});
