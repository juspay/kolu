import { describe, it, expect } from "vitest";
import { createSignal, createMemo, flush } from "@solidjs/signals";
import { toAsyncIterable } from "./server.ts";

describe("toAsyncIterable", () => {
  it("yields the current value as snapshot", async () => {
    const [count] = createSignal(42);
    const gen = toAsyncIterable(() => count())(new AbortController().signal);

    const first = await gen.next();
    expect(first).toEqual({ done: false, value: 42 });
  });

  it("yields when signal changes", async () => {
    const [count, setCount] = createSignal(0);
    const controller = new AbortController();
    const gen = toAsyncIterable(() => count())(controller.signal);

    expect(await gen.next()).toEqual({ done: false, value: 0 });

    setCount(1);
    flush();
    expect(await gen.next()).toEqual({ done: false, value: 1 });

    setCount(2);
    flush();
    expect(await gen.next()).toEqual({ done: false, value: 2 });

    controller.abort();
  });

  it("tracks derived signals (createMemo)", async () => {
    const [count, setCount] = createSignal(1);
    const doubled = createMemo(() => count() * 2);
    const controller = new AbortController();
    const gen = toAsyncIterable(() => doubled())(controller.signal);

    expect(await gen.next()).toEqual({ done: false, value: 2 });

    setCount(5);
    flush();
    expect(await gen.next()).toEqual({ done: false, value: 10 });

    controller.abort();
  });

  it("yields objects (for metadata-style state)", async () => {
    const [name] = createSignal("alpha");
    const [ticks, setTicks] = createSignal(0);
    const meta = createMemo(() => ({ name: name(), ticks: ticks() }));
    const controller = new AbortController();
    const gen = toAsyncIterable(() => meta())(controller.signal);

    expect(await gen.next()).toEqual({
      done: false,
      value: { name: "alpha", ticks: 0 },
    });

    setTicks(1);
    flush();
    expect(await gen.next()).toEqual({
      done: false,
      value: { name: "alpha", ticks: 1 },
    });

    controller.abort();
  });

  it("stops when aborted", async () => {
    const [count] = createSignal(0);
    const controller = new AbortController();
    const gen = toAsyncIterable(() => count())(controller.signal);

    expect(await gen.next()).toEqual({ done: false, value: 0 });

    controller.abort();
    expect((await gen.next()).done).toBe(true);
  });
});
