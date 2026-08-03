/**
 * The fan-out's semantics, one test per property the PTY host leans on. This is
 * the direct descendant of `channel.test.ts`: every case there survives, with
 * the two AbortSignal cases restated as SCOPE-CLOSE cases (unsubscribing is
 * closing the subscription's scope, which for a served member is the consuming
 * fiber being interrupted) and the `onOverflow` callback cases restated on the
 * stream's error channel, where the drop now lives.
 */

import { Effect, Exit, Fiber, Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { FanOut, type SubscriberOverflow } from "./fanOut.ts";

/** Pull the next frame (or the end) from a running subscription, with a short
 *  timeout so a wedged subscriber fails the test instead of hanging it. */
async function next<T>(
  it: AsyncIterator<T>,
): Promise<IteratorResult<T> | "timeout"> {
  return Promise.race([
    it.next(),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 1000),
    ),
  ]);
}

/** Open a subscription OUTSIDE any Effect body, the way a test wants it: a live
 *  iterator over the stream, the reading taken at subscribe time, and a `close`
 *  that releases the subscription's scope. */
async function open<T, R>(
  fan: FanOut<T>,
  read: () => R = () => undefined as R,
): Promise<{
  it: AsyncIterator<T>;
  reading: R;
  close: () => Promise<void>;
}> {
  const scope = Effect.runSync(Scope.make());
  const sub = await Effect.runPromise(
    Effect.provideService(fan.subscribeWith(read), Scope.Scope, scope),
  );
  return {
    it: Stream.toAsyncIterable(sub.stream)[Symbol.asyncIterator](),
    reading: sub.reading,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

describe("FanOut", () => {
  it("delivers values published after subscribe", async () => {
    const fan = new FanOut<number>();
    const { it } = await open(fan);
    fan.publishUnsafe(1);
    fan.publishUnsafe(2);
    expect(await next(it)).toEqual({ done: false, value: 1 });
    expect(await next(it)).toEqual({ done: false, value: 2 });
  });

  it("subscribes eagerly, fused with the reading — nothing falls between them", async () => {
    // The defining property, and the reason `subscribeWith` takes the reading
    // rather than letting the caller take it: registration and `read()` happen in
    // ONE synchronous step, so a publish can land strictly before the reading
    // (and be in it) or strictly after (and be on the stream) — never in a gap,
    // and never in both. This is what makes `PtyHost.attach()` race-free.
    const fan = new FanOut<string>();
    let state = "before";
    const { it, reading } = await open(fan, () => state);
    state = "after";
    fan.publishUnsafe("captured");
    expect(reading).toBe("before");
    expect(await next(it)).toEqual({ done: false, value: "captured" });
  });

  it("fans out to multiple independent subscribers", async () => {
    const fan = new FanOut<number>();
    const a = await open(fan);
    const b = await open(fan);
    fan.publishUnsafe(42);
    expect(await next(a.it)).toEqual({ done: false, value: 42 });
    expect(await next(b.it)).toEqual({ done: false, value: 42 });
  });

  it("resolves a pending pull when a value arrives", async () => {
    const fan = new FanOut<number>();
    const { it } = await open(fan);
    const pending = next(it);
    fan.publishUnsafe(7);
    expect(await pending).toEqual({ done: false, value: 7 });
  });

  it("ends the stream on close()", async () => {
    const fan = new FanOut<number>();
    const { it } = await open(fan);
    fan.closeUnsafe();
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("ends a pending pull on close()", async () => {
    const fan = new FanOut<number>();
    const { it } = await open(fan);
    const pending = next(it);
    fan.closeUnsafe();
    expect(await pending).toEqual({ done: true, value: undefined });
  });

  it("hands back an already-ended stream when subscribing after close", async () => {
    const fan = new FanOut<number>();
    fan.closeUnsafe();
    const { it } = await open(fan);
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("releases the subscriber when its scope closes", async () => {
    // The AbortSignal case, restated: unsubscribing is closing the scope, which
    // for a served member is the consuming fiber being interrupted.
    const fan = new FanOut<number>();
    const { it, close } = await open(fan);
    expect(fan.subscriberCount).toBe(1);
    await close();
    expect(fan.subscriberCount).toBe(0);
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("does not leak the subscriber when closed while a pull is pending", async () => {
    const fan = new FanOut<number>();
    const { it } = await open(fan);
    const pending = next(it);
    expect(fan.subscriberCount).toBe(1);
    fan.closeUnsafe();
    await pending;
    expect(fan.subscriberCount).toBe(0);
  });

  it("drops a slow subscriber that exceeds maxQueue, FAILING its stream", async () => {
    const fan = new FanOut<number>({ maxQueue: 3 });
    const { it } = await open(fan);
    // Never pull — let the queue overflow.
    for (let i = 0; i < 10; i++) fan.publishUnsafe(i);
    expect(fan.subscriberCount).toBe(0);
    // The drop arrives on the ERROR channel, immediately: the partially-buffered
    // items are discarded (a transparent re-subscribe delivers a fresh snapshot,
    // so replaying stale bytes is pointless), so the very next pull rejects
    // rather than draining three stale values first.
    await expect(it.next()).rejects.toMatchObject({
      _tag: "SubscriberOverflow",
      maxQueue: 3,
    });
  });

  it("fails only the subscriber that overflowed, not its siblings", async () => {
    // Overflow is per-subscriber — the property Effect's `PubSub` cannot express,
    // because its capacity and strategy are channel-wide. A slow consumer is
    // dropped while a sibling draining the same fan-out keeps receiving.
    const fan = new FanOut<number>({ maxQueue: 3 });
    const slow = await open(fan);
    const fast = await open(fan);
    // Publish one at a time and drain `fast` immediately after each, so its
    // queue never exceeds the cap; `slow` never pulls, so its queue climbs past
    // the cap and trips the drop.
    for (let i = 0; i < 10; i++) {
      fan.publishUnsafe(i);
      expect(await next(fast.it)).toEqual({ done: false, value: i });
    }
    expect(fan.subscriberCount).toBe(1);
    await expect(slow.it.next()).rejects.toMatchObject({
      _tag: "SubscriberOverflow",
    });
  });

  it("does not mis-signal a released subscription as an overflow", async () => {
    // Regression, carried over from the AbortSignal era: a released subscriber
    // that stayed in the live set could still be reached by a publish and — with
    // its queue already at the cap — be reported as an overflow. A release is a
    // clean end, never an overflow, so the release drops it from the set first.
    const fan = new FanOut<number>({ maxQueue: 1 });
    const { it, close } = await open(fan);
    await close();
    // A publish racing the release must not reach the now-dead subscriber.
    fan.publishUnsafe(1);
    expect(fan.subscriberCount).toBe(0);
    // A clean end, never an overflow failure.
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("does not deliver to subscribers added after a value was published", async () => {
    const fan = new FanOut<number>();
    fan.publishUnsafe(1); // no subscribers yet — dropped on the floor
    const { it } = await open(fan);
    fan.publishUnsafe(2);
    expect(await next(it)).toEqual({ done: false, value: 2 });
  });

  it("`stream` is a lazy subscription — running it IS subscribing", async () => {
    // The delta-only face (`FanOut.stream`) every metadata tap hands back: no
    // subscriber exists until the stream runs, and the subscription lives exactly
    // as long as the running fiber.
    const fan = new FanOut<number>();
    const stream: Stream.Stream<number, SubscriberOverflow> = fan.stream;
    expect(fan.subscriberCount).toBe(0);
    const fiber = Effect.runFork(Stream.runCollect(Stream.take(stream, 1)));
    // Give the fiber a beat to register, then publish to the now-live subscriber.
    await new Promise((r) => setTimeout(r, 10));
    expect(fan.subscriberCount).toBe(1);
    fan.publishUnsafe(5);
    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual([5]);
    // The fiber is done, so its scope closed and the subscription went with it.
    expect(fan.subscriberCount).toBe(0);
  });
});
