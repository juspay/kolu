import { describe, it, expect } from "vitest";
import {
  createChannel,
  createKeyedChannel,
  liveQuery,
  liveQueryMany,
} from "./server.ts";

describe("createChannel", () => {
  it("delivers published values to subscribers", async () => {
    const ch = createChannel<number>();
    const controller = new AbortController();
    const iter = ch.subscribe(controller.signal)[Symbol.asyncIterator]();

    ch.publish(1);
    ch.publish(2);

    expect(await iter.next()).toEqual({ done: false, value: 1 });
    expect(await iter.next()).toEqual({ done: false, value: 2 });

    controller.abort();
    expect((await iter.next()).done).toBe(true);
  });

  it("fans out to multiple subscribers", async () => {
    const ch = createChannel<string>();
    const c1 = new AbortController();
    const c2 = new AbortController();
    const iter1 = ch.subscribe(c1.signal)[Symbol.asyncIterator]();
    const iter2 = ch.subscribe(c2.signal)[Symbol.asyncIterator]();

    ch.publish("hello");

    expect(await iter1.next()).toEqual({ done: false, value: "hello" });
    expect(await iter2.next()).toEqual({ done: false, value: "hello" });

    c1.abort();
    c2.abort();
  });

  it("handles subscribe without signal", async () => {
    const ch = createChannel<number>();
    const iter = ch.subscribe()[Symbol.asyncIterator]();

    ch.publish(42);
    expect(await iter.next()).toEqual({ done: false, value: 42 });

    // Manual return to stop
    await iter.return!(undefined);
    expect((await iter.next()).done).toBe(true);
  });

  it("does not deliver to unsubscribed listeners", async () => {
    const ch = createChannel<number>();
    const c1 = new AbortController();
    const iter = ch.subscribe(c1.signal)[Symbol.asyncIterator]();

    ch.publish(1);
    c1.abort();
    ch.publish(2); // should not be delivered

    expect(await iter.next()).toEqual({ done: false, value: 1 });
    expect((await iter.next()).done).toBe(true);
  });
});

describe("createKeyedChannel", () => {
  it("isolates keys", async () => {
    const ch = createKeyedChannel<string, number>();
    const c1 = new AbortController();
    const c2 = new AbortController();
    const iterA = ch.subscribe("a", c1.signal)[Symbol.asyncIterator]();
    const iterB = ch.subscribe("b", c2.signal)[Symbol.asyncIterator]();

    ch.publish("a", 1);
    ch.publish("b", 2);

    expect(await iterA.next()).toEqual({ done: false, value: 1 });
    expect(await iterB.next()).toEqual({ done: false, value: 2 });

    c1.abort();
    c2.abort();
  });

  it("does not create channel on publish-only", () => {
    const ch = createKeyedChannel<string, number>();
    // Publishing to a key with no subscribers should not throw
    ch.publish("nonexistent", 42);
  });
});

describe("liveQuery", () => {
  it("yields snapshot then live values", async () => {
    const ch = createChannel<string>();
    const controller = new AbortController();

    const gen = liveQuery(
      (signal) => ch.subscribe(signal),
      () => "snapshot",
    )(controller.signal);

    // First yield is the snapshot
    expect(await gen.next()).toEqual({ done: false, value: "snapshot" });

    // Then live values
    ch.publish("live-1");
    expect(await gen.next()).toEqual({ done: false, value: "live-1" });

    controller.abort();
  });

  it("queues events published between subscribe and snapshot", async () => {
    const ch = createChannel<number>();
    const controller = new AbortController();

    // Snapshot is async — simulate delay
    const gen = liveQuery(
      (signal) => ch.subscribe(signal),
      async () => {
        // Events published during snapshot computation
        ch.publish(2);
        ch.publish(3);
        return 1; // snapshot value
      },
    )(controller.signal);

    expect(await gen.next()).toEqual({ done: false, value: 1 }); // snapshot
    expect(await gen.next()).toEqual({ done: false, value: 2 }); // queued
    expect(await gen.next()).toEqual({ done: false, value: 3 }); // queued

    controller.abort();
  });
});

describe("liveQueryMany", () => {
  it("yields multiple snapshot items then live values", async () => {
    const ch = createChannel<number>();
    const controller = new AbortController();

    const gen = liveQueryMany(
      (signal) => ch.subscribe(signal),
      () => [10, 20, 30],
    )(controller.signal);

    expect(await gen.next()).toEqual({ done: false, value: 10 });
    expect(await gen.next()).toEqual({ done: false, value: 20 });
    expect(await gen.next()).toEqual({ done: false, value: 30 });

    ch.publish(40);
    expect(await gen.next()).toEqual({ done: false, value: 40 });

    controller.abort();
  });
});
