import { describe, expect, it, vi } from "vitest";
import {
  createOutputCoalesce,
  type OutputSink,
  UNFOCUSED_COALESCE_MS,
} from "./outputCoalesce";

function recordingSink(opts: { fireParsed?: boolean } = {}): {
  sink: OutputSink;
  trace: string[];
  parsedArgs: Array<(() => void) | undefined>;
} {
  const trace: string[] = [];
  const parsedArgs: Array<(() => void) | undefined> = [];
  const sink: OutputSink = {
    write: (data, onParsed) => {
      trace.push(`w:${data}`);
      parsedArgs.push(onParsed);
      if (opts.fireParsed !== false) onParsed?.();
    },
    resize: (cols, rows) => {
      trace.push(`r:${cols}x${rows}`);
    },
  };
  return { sink, trace, parsedArgs };
}

function writesIn(trace: readonly string[]): string[] {
  return trace
    .filter((entry) => entry.startsWith("w:"))
    .map((entry) => entry.slice(2));
}

describe("createOutputCoalesce", () => {
  it("passes focused (full-rate) writes through immediately", () => {
    const { sink, trace } = recordingSink();
    const c = createOutputCoalesce(() => true, sink);
    let parsed = 0;
    c.write("a", () => {
      parsed++;
    });
    c.write("b", () => {
      parsed++;
    });
    expect(writesIn(trace)).toEqual(["a", "b"]);
    expect(parsed).toBe(2);
    expect(c.pendingBytes()).toBe(0);
  });

  it("batches unfocused writes until the coalesce window fires", () => {
    const { sink, trace } = recordingSink();
    const timers = new Map<number, () => void>();
    let nextId = 1;
    const c = createOutputCoalesce(() => false, sink, {
      schedule: (fn) => {
        const id = nextId++;
        timers.set(id, fn);
        return id;
      },
      cancel: (id) => {
        timers.delete(id);
      },
      intervalMs: UNFOCUSED_COALESCE_MS,
    });
    let parsed = 0;
    c.write("hello", () => {
      parsed++;
    });
    c.write(" world", () => {
      parsed++;
    });
    expect(writesIn(trace)).toEqual([]);
    expect(c.pendingBytes()).toBe("hello world".length);
    expect(timers.size).toBe(1);
    const first = timers.values().next();
    expect(first.done).toBe(false);
    if (first.done || first.value === undefined) {
      throw new Error("expected a scheduled flush");
    }
    first.value();
    expect(writesIn(trace)).toEqual(["hello world"]);
    expect(parsed).toBe(2);
    expect(c.pendingBytes()).toBe(0);
  });

  it("flushes pending when a full-rate write arrives", () => {
    const { sink, trace } = recordingSink();
    let fullRate = false;
    const timers = new Map<number, () => void>();
    let nextId = 1;
    const c = createOutputCoalesce(() => fullRate, sink, {
      schedule: (fn) => {
        const id = nextId++;
        timers.set(id, fn);
        return id;
      },
      cancel: (id) => {
        timers.delete(id);
      },
    });
    c.write("pending");
    expect(writesIn(trace)).toEqual([]);
    fullRate = true;
    c.write("live");
    expect(writesIn(trace)).toEqual(["pending", "live"]);
    expect(c.pendingBytes()).toBe(0);
    expect(timers.size).toBe(0);
  });

  it("walks buffered bytes out before a resize, and buffers again after it", () => {
    const { sink, trace } = recordingSink();
    const c = createOutputCoalesce(() => false, sink, {
      schedule: () => 1,
      cancel: vi.fn(),
    });
    c.write("before");
    expect(trace).toEqual([]);
    c.resize(100, 40);
    expect(trace).toEqual(["w:before", "r:100x40"]);
    c.write("after");
    expect(trace).toEqual(["w:before", "r:100x40"]);
    c.flush();
    expect(trace).toEqual(["w:before", "r:100x40", "w:after"]);
  });

  it("passes a resize through with nothing buffered", () => {
    const { sink, trace } = recordingSink();
    const c = createOutputCoalesce(() => false, sink, {
      schedule: () => 1,
      cancel: vi.fn(),
    });
    c.resize(80, 24);
    expect(trace).toEqual(["r:80x24"]);
  });

  it("ignores a resize after dispose", () => {
    const { sink, trace } = recordingSink();
    const c = createOutputCoalesce(() => false, sink, {
      schedule: () => 1,
      cancel: vi.fn(),
    });
    c.dispose();
    c.resize(80, 24);
    expect(trace).toEqual([]);
  });

  it("flush() lands the buffer without waiting for the timer", () => {
    const { sink, trace } = recordingSink();
    const c = createOutputCoalesce(() => false, sink, {
      schedule: () => 1,
      cancel: vi.fn(),
    });
    c.write("x");
    c.flush();
    expect(writesIn(trace)).toEqual(["x"]);
  });

  it("dispose drops pending bytes and ignores later writes", () => {
    const { sink, trace } = recordingSink();
    const c = createOutputCoalesce(() => false, sink, {
      schedule: () => 1,
      cancel: vi.fn(),
    });
    c.write("lost");
    c.dispose();
    c.write("ignored");
    c.flush();
    expect(writesIn(trace)).toEqual([]);
    expect(c.pendingBytes()).toBe(0);
  });

  it("clear drops pending without disposing the handle", () => {
    const { sink, trace } = recordingSink();
    const c = createOutputCoalesce(() => false, sink, {
      schedule: () => 1,
      cancel: vi.fn(),
    });
    c.write("stale");
    c.clear();
    expect(c.pendingBytes()).toBe(0);
    c.write("fresh");
    c.flush();
    expect(writesIn(trace)).toEqual(["fresh"]);
  });

  it("does not re-arm a timer while one is already pending", () => {
    let scheduled = 0;
    const { sink } = recordingSink();
    const c = createOutputCoalesce(() => false, sink, {
      schedule: () => {
        scheduled++;
        return scheduled;
      },
      cancel: vi.fn(),
    });
    c.write("a");
    c.write("b");
    c.write("c");
    expect(scheduled).toBe(1);
  });

  it("flush without onParsed callbacks omits the sink's callback arg", () => {
    const { sink, parsedArgs } = recordingSink();
    const c = createOutputCoalesce(() => false, sink, {
      schedule: () => 1,
      cancel: vi.fn(),
    });
    c.write("x");
    c.flush();
    expect(parsedArgs).toEqual([undefined]);
  });
});
