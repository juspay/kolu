/**
 * Unit tests for the internal multi-subscriber `Channel<T>`. This is the
 * fan-out backbone every PtyHost stream rides on, so its back-pressure,
 * teardown, and multi-subscriber semantics are pinned here directly
 * (the higher-level PTY tests exercise it indirectly).
 */
import { describe, expect, it } from "vitest";
import { Channel } from "./channel.ts";

/** Drain up to `n` values from an async iterable, bailing after `ms`. */
async function take<T>(
  iter: AsyncIterable<T>,
  n: number,
  ms = 1000,
): Promise<T[]> {
  const out: T[] = [];
  const it = iter[Symbol.asyncIterator]();
  const deadline = Date.now() + ms;
  while (out.length < n) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const next = await Promise.race([
      it.next(),
      new Promise<IteratorResult<T>>((r) =>
        setTimeout(
          () => r({ value: undefined as never, done: true }),
          remaining,
        ),
      ),
    ]);
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

describe("Channel", () => {
  it("delivers published values to a subscriber", async () => {
    const ch = new Channel<number>();
    const iter = ch.subscribe();
    // Let the generator start (register the subscriber) before publishing.
    const collected = take(iter, 3);
    await new Promise((r) => setTimeout(r, 0));
    ch.publish(1);
    ch.publish(2);
    ch.publish(3);
    expect(await collected).toEqual([1, 2, 3]);
  });

  it("fans out to multiple independent subscribers", async () => {
    const ch = new Channel<string>();
    const a = ch.subscribe();
    const b = ch.subscribe();
    const ca = take(a, 2);
    const cb = take(b, 2);
    await new Promise((r) => setTimeout(r, 0));
    ch.publish("x");
    ch.publish("y");
    expect(await ca).toEqual(["x", "y"]);
    expect(await cb).toEqual(["x", "y"]);
  });

  it("buffers values published before the consumer pulls them", async () => {
    const ch = new Channel<number>();
    const it = ch.subscribe()[Symbol.asyncIterator]();
    // Force subscription registration, then publish before pulling.
    const first = it.next();
    await new Promise((r) => setTimeout(r, 0));
    ch.publish(10);
    ch.publish(20);
    expect((await first).value).toBe(10);
    expect((await it.next()).value).toBe(20);
  });

  it("ends the iterator when the channel closes", async () => {
    const ch = new Channel<number>();
    const it = ch.subscribe()[Symbol.asyncIterator]();
    const pending = it.next();
    await new Promise((r) => setTimeout(r, 0));
    ch.close();
    expect((await pending).done).toBe(true);
  });

  it("a subscription that starts after close ends immediately", async () => {
    const ch = new Channel<number>();
    ch.close();
    const out = await take(ch.subscribe(), 1, 200);
    expect(out).toEqual([]);
  });

  it("publish after close is a no-op (no throw)", () => {
    const ch = new Channel<number>();
    ch.close();
    expect(() => ch.publish(1)).not.toThrow();
  });

  it("aborting the signal ends that subscriber without affecting others", async () => {
    const ch = new Channel<number>();
    const ac = new AbortController();
    const aborted = ch.subscribe(ac.signal)[Symbol.asyncIterator]();
    const live = ch.subscribe();
    const abortedPending = aborted.next();
    const liveCollected = take(live, 1);
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    expect((await abortedPending).done).toBe(true);
    // The non-aborted subscriber still receives values.
    ch.publish(42);
    expect(await liveCollected).toEqual([42]);
  });

  it("an already-aborted signal yields an empty stream", async () => {
    const ch = new Channel<number>();
    const ac = new AbortController();
    ac.abort();
    const out = await take(ch.subscribe(ac.signal), 1, 200);
    expect(out).toEqual([]);
  });
});
