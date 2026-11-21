import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { createAttentionRecord } from "./savedAttention";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;
const B = "22222222-2222-4222-8222-222222222222" as TerminalId;
const NAME = "kolu-attention:local";

/** A browser's storage, held across "page loads" the way localStorage is.
 *  With `announceFrom`, every write is also announced as a `storage` event
 *  from a page at that address — what the browser does for every OTHER page
 *  of the same origin. Two records in this one window both hear it, the
 *  writer included, as two pages would. */
function memoryStorage(opts: { announceFrom?: string } = {}): Storage {
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
      if (opts.announceFrom !== undefined)
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            oldValue,
            newValue: value,
            url: opts.announceFrom,
          }),
        );
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

    const after = createAttentionRecord({ name: NAME, storage });
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
    expect(second.isUnread(A)).toBe(true);

    first.clearUnread(A);
    expect(second.isUnread(A)).toBe(false);

    // The second page's next write keeps the first page's read.
    second.markUnread(B);
    const saved: unknown = JSON.parse(storage.getItem(NAME) ?? "null");
    expect(saved).toMatchObject({ unread: [B] });
  });
});
