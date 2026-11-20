import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { createAttentionRecord } from "./savedAttention";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;
const B = "22222222-2222-4222-8222-222222222222" as TerminalId;
const NAME = "kolu-attention:local";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
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
});
