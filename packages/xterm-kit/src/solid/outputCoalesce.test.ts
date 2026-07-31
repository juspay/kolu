import { describe, expect, it, vi } from "vitest";
import { createOutputCoalesce, UNFOCUSED_COALESCE_MS } from "./outputCoalesce";

describe("createOutputCoalesce", () => {
  it("passes focused (full-rate) writes through immediately", () => {
    const writes: string[] = [];
    const c = createOutputCoalesce(
      () => true,
      (data, onParsed) => {
        writes.push(data);
        onParsed?.();
      },
    );
    let parsed = 0;
    c.write("a", () => {
      parsed++;
    });
    c.write("b", () => {
      parsed++;
    });
    expect(writes).toEqual(["a", "b"]);
    expect(parsed).toBe(2);
    expect(c.pendingBytes()).toBe(0);
  });

  it("batches unfocused writes until the coalesce window fires", () => {
    const writes: string[] = [];
    const timers = new Map<number, () => void>();
    let nextId = 1;
    const c = createOutputCoalesce(
      () => false,
      (data, onParsed) => {
        writes.push(data);
        onParsed?.();
      },
      {
        schedule: (fn) => {
          const id = nextId++;
          timers.set(id, fn);
          return id;
        },
        cancel: (id) => {
          timers.delete(id);
        },
        intervalMs: UNFOCUSED_COALESCE_MS,
      },
    );
    let parsed = 0;
    c.write("hello", () => {
      parsed++;
    });
    c.write(" world", () => {
      parsed++;
    });
    expect(writes).toEqual([]);
    expect(c.pendingBytes()).toBe("hello world".length);
    expect(timers.size).toBe(1);
    // Fire the one scheduled flush.
    const first = timers.values().next();
    expect(first.done).toBe(false);
    if (first.done || first.value === undefined) {
      throw new Error("expected a scheduled flush");
    }
    first.value();
    expect(writes).toEqual(["hello world"]);
    expect(parsed).toBe(2);
    expect(c.pendingBytes()).toBe(0);
  });

  it("flushes pending when a full-rate write arrives", () => {
    const writes: string[] = [];
    let fullRate = false;
    const timers = new Map<number, () => void>();
    let nextId = 1;
    const c = createOutputCoalesce(
      () => fullRate,
      (data, onParsed) => {
        writes.push(data);
        onParsed?.();
      },
      {
        schedule: (fn) => {
          const id = nextId++;
          timers.set(id, fn);
          return id;
        },
        cancel: (id) => {
          timers.delete(id);
        },
      },
    );
    c.write("pending");
    expect(writes).toEqual([]);
    fullRate = true;
    c.write("live");
    // Pending flushed first, then the live chunk.
    expect(writes).toEqual(["pending", "live"]);
    expect(c.pendingBytes()).toBe(0);
    expect(timers.size).toBe(0);
  });

  it("flush() lands the buffer without waiting for the timer", () => {
    const writes: string[] = [];
    const c = createOutputCoalesce(
      () => false,
      (data, onParsed) => {
        writes.push(data);
        onParsed?.();
      },
      {
        schedule: () => 1,
        cancel: vi.fn(),
      },
    );
    c.write("x");
    c.flush();
    expect(writes).toEqual(["x"]);
  });

  it("dispose drops pending bytes and ignores later writes", () => {
    const writes: string[] = [];
    const c = createOutputCoalesce(
      () => false,
      (data) => {
        writes.push(data);
      },
      {
        schedule: () => 1,
        cancel: vi.fn(),
      },
    );
    c.write("lost");
    c.dispose();
    c.write("ignored");
    c.flush();
    expect(writes).toEqual([]);
    expect(c.pendingBytes()).toBe(0);
  });

  it("clear drops pending without disposing the handle", () => {
    const writes: string[] = [];
    const c = createOutputCoalesce(
      () => false,
      (data) => {
        writes.push(data);
      },
      {
        schedule: () => 1,
        cancel: vi.fn(),
      },
    );
    c.write("stale");
    c.clear();
    expect(c.pendingBytes()).toBe(0);
    c.write("fresh");
    c.flush();
    expect(writes).toEqual(["fresh"]);
  });

  it("does not re-arm a timer while one is already pending", () => {
    let scheduled = 0;
    const c = createOutputCoalesce(
      () => false,
      () => {},
      {
        schedule: () => {
          scheduled++;
          return scheduled;
        },
        cancel: vi.fn(),
      },
    );
    c.write("a");
    c.write("b");
    c.write("c");
    expect(scheduled).toBe(1);
  });

  it("flush without onParsed callbacks omits writeThrough's callback arg", () => {
    const args: Array<(() => void) | undefined> = [];
    const c = createOutputCoalesce(
      () => false,
      (_data, onParsed) => {
        args.push(onParsed);
      },
      {
        schedule: () => 1,
        cancel: vi.fn(),
      },
    );
    c.write("x"); // no onParsed
    c.flush();
    expect(args).toEqual([undefined]);
  });
});
