/**
 * `inMemoryChannel` — single-process broadcast pub/sub.
 *
 * Coverage focus: shape parity with `publisherChannel` (publish fans out
 * to every live subscriber; signal-abort cleanly ends an in-flight
 * subscription; consume cleans up via the returned function). These are
 * the invariants `implementSurface` depends on.
 */

import { describe, expect, it } from "vitest";
import { inMemoryChannel, inMemoryPublisher } from "./server";

describe("inMemoryChannel", () => {
  it("delivers publishes to every live subscriber in order", async () => {
    const chan = inMemoryChannel<number>();
    const seenA: number[] = [];
    const seenB: number[] = [];
    const ctlA = new AbortController();
    const ctlB = new AbortController();

    const runA = (async () => {
      for await (const v of chan.subscribe(ctlA.signal)) seenA.push(v);
    })();
    const runB = (async () => {
      for await (const v of chan.subscribe(ctlB.signal)) seenB.push(v);
    })();

    // Wait one microtask so subscribers register before publishes fan out.
    await Promise.resolve();
    chan.publish(1);
    chan.publish(2);
    chan.publish(3);

    // Drain — give the async iterator loops time to process the queue.
    await new Promise((r) => setTimeout(r, 5));
    expect(seenA).toEqual([1, 2, 3]);
    expect(seenB).toEqual([1, 2, 3]);

    ctlA.abort();
    ctlB.abort();
    await Promise.allSettled([runA, runB]);
  });

  it("late subscribers do not replay earlier publishes (no snapshot semantics)", async () => {
    const chan = inMemoryChannel<number>();
    chan.publish(99); // before any subscriber

    const ctl = new AbortController();
    const seen: number[] = [];
    const run = (async () => {
      for await (const v of chan.subscribe(ctl.signal)) seen.push(v);
    })();

    await Promise.resolve();
    chan.publish(100);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([100]);

    ctl.abort();
    await run.catch(() => {});
  });

  it("signal-abort cleanly ends the iterator", async () => {
    const chan = inMemoryChannel<string>();
    const ctl = new AbortController();
    const seen: string[] = [];

    const run = (async () => {
      try {
        for await (const v of chan.subscribe(ctl.signal)) seen.push(v);
      } catch {
        /* abort surfaces as a rejection — acceptable */
      }
    })();

    await Promise.resolve();
    chan.publish("a");
    await new Promise((r) => setTimeout(r, 1));
    ctl.abort();
    await run;
    expect(seen).toEqual(["a"]);
  });

  it("abort removes the subscriber from the set (no leak on abandoned iterators)", async () => {
    // Regression: aborted subscribers used to stay in the subscribers
    // Set until `iterator.return()` ran — consumers that just rejected
    // out of next() without calling return() left dead entries.
    const chan = inMemoryChannel<number>();
    expect(chan.subscriberCount()).toBe(0);
    const ctl = new AbortController();
    const run = (async () => {
      try {
        for await (const _v of chan.subscribe(ctl.signal)) {
          /* no-op */
        }
      } catch {
        /* abort surfaces as rejection */
      }
    })();
    await Promise.resolve();
    expect(chan.subscriberCount()).toBe(1);
    ctl.abort();
    await run;
    expect(chan.subscriberCount()).toBe(0);
  });

  it("inMemoryPublisher drops publishes with no current subscribers", async () => {
    // Regression: publish used to lazily create a channel for every
    // name on every publish, retaining it forever even when no one
    // subscribed (e.g. per-PID `processes:<pid>:value` in the process
    // monitor — thousands of stranded channels per long session).
    const pub = inMemoryPublisher();
    // Publish with no subscribers → no-op, no channel created.
    pub.publish("nobody-listening", 42);
    // Subscribe, then publish, then unsubscribe.
    const ctl = new AbortController();
    const seen: number[] = [];
    const run = (async () => {
      try {
        for await (const v of pub.subscribe<number>("alive", {
          signal: ctl.signal,
        })) {
          seen.push(v);
        }
      } catch {
        /* abort rejection */
      }
    })();
    await Promise.resolve();
    pub.publish("alive", 1);
    pub.publish("alive", 2);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([1, 2]);
    ctl.abort();
    await run;
    // After unsubscribe, publishing to "alive" is again a no-op — and
    // because the channel was evicted, re-subscribing yields a fresh
    // one (no replay of post-abort publishes).
    pub.publish("alive", 999);
    const ctl2 = new AbortController();
    const seen2: number[] = [];
    const run2 = (async () => {
      try {
        for await (const v of pub.subscribe<number>("alive", {
          signal: ctl2.signal,
        })) {
          seen2.push(v);
        }
      } catch {
        /* abort */
      }
    })();
    await Promise.resolve();
    pub.publish("alive", 3);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen2).toEqual([3]); // no 999, channel was fresh
    ctl2.abort();
    await run2;
  });

  it("consume() invokes onEvent per publish and cleans up via the returned fn", async () => {
    const chan = inMemoryChannel<{ n: number }>();
    const received: number[] = [];
    const cleanup = chan.consume({
      onEvent: (v) => received.push(v.n),
      onError: () => {
        /* tests guarantee no error path */
      },
    });

    await Promise.resolve();
    chan.publish({ n: 1 });
    chan.publish({ n: 2 });
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toEqual([1, 2]);

    cleanup();
    chan.publish({ n: 3 });
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toEqual([1, 2]); // no new event after cleanup
  });
});
