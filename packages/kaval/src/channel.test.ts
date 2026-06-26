import { describe, expect, it } from "vitest";
import { Channel } from "./channel.ts";

/** Pull the next value (or end) from an iterator with a short timeout so a
 *  hung subscriber fails the test instead of hanging it. */
async function next<T>(it: AsyncIterator<T>): Promise<IteratorResult<T>> {
  return Promise.race([
    it.next(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout waiting for next()")), 1000),
    ),
  ]);
}

describe("Channel", () => {
  it("delivers values published after subscribe", async () => {
    const ch = new Channel<number>();
    const it = ch.subscribe()[Symbol.asyncIterator]();
    ch.publish(1);
    ch.publish(2);
    expect(await next(it)).toEqual({ done: false, value: 1 });
    expect(await next(it)).toEqual({ done: false, value: 2 });
  });

  it("subscribes eagerly — a publish that races subscribe is captured", async () => {
    const ch = new Channel<string>();
    // The defining property: the subscriber is registered synchronously by
    // subscribe(), so a publish() on the very next line is buffered for it
    // even though next() hasn't been pulled yet.
    const iterable = ch.subscribe();
    ch.publish("captured");
    const it = iterable[Symbol.asyncIterator]();
    expect(await next(it)).toEqual({ done: false, value: "captured" });
  });

  it("fans out to multiple independent subscribers", async () => {
    const ch = new Channel<number>();
    const a = ch.subscribe()[Symbol.asyncIterator]();
    const b = ch.subscribe()[Symbol.asyncIterator]();
    ch.publish(42);
    expect(await next(a)).toEqual({ done: false, value: 42 });
    expect(await next(b)).toEqual({ done: false, value: 42 });
  });

  it("resolves a pending next() when a value arrives", async () => {
    const ch = new Channel<number>();
    const it = ch.subscribe()[Symbol.asyncIterator]();
    const pending = next(it);
    ch.publish(7);
    expect(await pending).toEqual({ done: false, value: 7 });
  });

  it("ends the iterator on close()", async () => {
    const ch = new Channel<number>();
    const it = ch.subscribe()[Symbol.asyncIterator]();
    ch.close();
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("ends a pending next() on close()", async () => {
    const ch = new Channel<number>();
    const it = ch.subscribe()[Symbol.asyncIterator]();
    const pending = next(it);
    ch.close();
    expect(await pending).toEqual({ done: true, value: undefined });
  });

  it("returns an already-finished iterable when subscribing after close", async () => {
    const ch = new Channel<number>();
    ch.close();
    const it = ch.subscribe()[Symbol.asyncIterator]();
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("ends the iterator when the abort signal fires", async () => {
    const ch = new Channel<number>();
    const ac = new AbortController();
    const it = ch.subscribe(ac.signal)[Symbol.asyncIterator]();
    const pending = next(it);
    ac.abort();
    expect(await pending).toEqual({ done: true, value: undefined });
  });

  it("does not leak the subscriber when aborted while a next() is pending", async () => {
    const ch = new Channel<number>();
    const ac = new AbortController();
    const it = ch.subscribe(ac.signal)[Symbol.asyncIterator]();
    const pending = next(it);
    expect(ch.subscriberCount).toBe(1);
    ac.abort();
    await pending;
    // Resolving {done:true} ends the for-await WITHOUT calling return(), so
    // the push path itself must tear the subscriber down.
    expect(ch.subscriberCount).toBe(0);
  });

  it("does not leak the subscriber when closed while a next() is pending", async () => {
    const ch = new Channel<number>();
    const it = ch.subscribe()[Symbol.asyncIterator]();
    const pending = next(it);
    expect(ch.subscriberCount).toBe(1);
    ch.close();
    await pending;
    expect(ch.subscriberCount).toBe(0);
  });

  it("returns empty when the signal is already aborted", async () => {
    const ch = new Channel<number>();
    const ac = new AbortController();
    ac.abort();
    const it = ch.subscribe(ac.signal)[Symbol.asyncIterator]();
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("stops delivering after the consumer calls return()", async () => {
    const ch = new Channel<number>();
    const it = ch.subscribe()[Symbol.asyncIterator]();
    expect(ch.subscriberCount).toBe(1);
    await it.return?.(undefined as never);
    expect(ch.subscriberCount).toBe(0);
  });

  it("drops a slow subscriber that exceeds maxQueue, firing its onOverflow", async () => {
    let overflowed = false;
    const ch = new Channel<number>({ maxQueue: 3 });
    // The drop callback is PER-SUBSCRIBER (passed to subscribe), not channel-
    // wide — each subscriber buffers independently, so only the one that
    // overflowed fires.
    const it = ch
      .subscribe(undefined, () => {
        overflowed = true;
      })
      [Symbol.asyncIterator]();
    // Never pull — let the queue overflow.
    for (let i = 0; i < 10; i++) ch.publish(i);
    expect(overflowed).toBe(true);
    expect(ch.subscriberCount).toBe(0);
    // On overflow the dropped subscriber's iterator ends immediately — the
    // partially-buffered items are discarded (a transparent re-subscribe
    // delivers a fresh snapshot, so replaying stale bytes is pointless).
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("fires onOverflow only for the subscriber that overflowed, not its siblings", async () => {
    // overflow is per-subscriber: a slow consumer is dropped while a sibling
    // draining the same channel keeps receiving, and only the slow one's
    // callback fires.
    const ch = new Channel<number>({ maxQueue: 3 });
    let slowDropped = false;
    let fastDropped = false;
    const slow = ch
      .subscribe(undefined, () => {
        slowDropped = true;
      })
      [Symbol.asyncIterator]();
    const fast = ch
      .subscribe(undefined, () => {
        fastDropped = true;
      })
      [Symbol.asyncIterator]();
    // Publish one at a time and drain `fast` immediately after each, so its
    // queue never exceeds the cap; `slow` never pulls, so its queue climbs past
    // the cap and trips the drop.
    for (let i = 0; i < 10; i++) {
      ch.publish(i);
      expect((await next(fast)).value).toBe(i);
    }
    expect(slowDropped).toBe(true);
    expect(fastDropped).toBe(false);
    expect(await next(slow)).toEqual({ done: true, value: undefined });
  });

  it("does not mis-signal an abort as an overflow when a publish races it", async () => {
    // Regression: onAbort queued CLOSE while leaving the sub in the live set, so
    // a publish racing the abort could reach it and — with its queue already at
    // the cap — trip the drop branch, firing onOverflow. An abort is a clean
    // end, not an overflow; firing onOverflow there mis-reads it as one.
    const ch = new Channel<number>({ maxQueue: 1 });
    const ac = new AbortController();
    let overflowed = false;
    const it = ch
      .subscribe(ac.signal, () => {
        overflowed = true;
      })
      [Symbol.asyncIterator]();
    // No pending next(): abort queues CLOSE, filling the 1-deep queue to the cap.
    ac.abort();
    // A publish racing the abort must NOT reach the now-dead subscriber.
    ch.publish(1);
    expect(overflowed).toBe(false);
    expect(ch.subscriberCount).toBe(0);
    // The consumer drains the queued CLOSE → a clean end, never an overflow.
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("does not deliver to subscribers added after a value was published", async () => {
    const ch = new Channel<number>();
    ch.publish(1); // no subscribers yet — dropped on the floor
    const it = ch.subscribe()[Symbol.asyncIterator]();
    ch.publish(2);
    expect(await next(it)).toEqual({ done: false, value: 2 });
  });
});
