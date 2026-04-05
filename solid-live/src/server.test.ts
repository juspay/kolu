import { describe, it, expect } from "vitest";
import { createSignal, createMemo, flush } from "@solidjs/signals";
import { live, events } from "./server.ts";

describe("live", () => {
  it("yields the current value as snapshot", async () => {
    const [count] = createSignal(42);
    const gen = live(() => count())(new AbortController().signal);

    const first = await gen.next();
    expect(first).toEqual({ done: false, value: 42 });
  });

  it("yields when signal changes", async () => {
    const [count, setCount] = createSignal(0);
    const controller = new AbortController();
    const gen = live(() => count())(controller.signal);

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
    const gen = live(() => doubled())(controller.signal);

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
    const gen = live(() => meta())(controller.signal);

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
    const gen = live(() => count())(controller.signal);

    expect(await gen.next()).toEqual({ done: false, value: 0 });

    controller.abort();
    expect((await gen.next()).done).toBe(true);
  });
});

describe("events", () => {
  it("delivers pushed values to iterators", async () => {
    const [push, iterate] = events<number>();
    const controller = new AbortController();
    const iter = iterate(controller.signal)[Symbol.asyncIterator]();

    push(1);
    push(2);

    expect(await iter.next()).toEqual({ done: false, value: 1 });
    expect(await iter.next()).toEqual({ done: false, value: 2 });

    controller.abort();
    expect((await iter.next()).done).toBe(true);
  });

  it("fans out to multiple iterators", async () => {
    const [push, iterate] = events<string>();
    const c1 = new AbortController();
    const c2 = new AbortController();
    const iter1 = iterate(c1.signal)[Symbol.asyncIterator]();
    const iter2 = iterate(c2.signal)[Symbol.asyncIterator]();

    push("hello");

    expect(await iter1.next()).toEqual({ done: false, value: "hello" });
    expect(await iter2.next()).toEqual({ done: false, value: "hello" });

    c1.abort();
    c2.abort();
  });

  it("buffers events from the moment iterate() is called", async () => {
    const [push, iterate] = events<number>();
    const controller = new AbortController();

    // Start iterating, then push immediately (before for-await starts)
    const iter = iterate(controller.signal)[Symbol.asyncIterator]();
    push(1);
    push(2);

    expect(await iter.next()).toEqual({ done: false, value: 1 });
    expect(await iter.next()).toEqual({ done: false, value: 2 });

    controller.abort();
  });
});
