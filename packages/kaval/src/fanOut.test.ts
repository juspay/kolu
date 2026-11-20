import { Effect, Exit, Fiber, Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { FanOut, type SubscriberDropped } from "./fanOut.ts";

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
    for (let i = 0; i < 10; i++) fan.publishUnsafe(i);
    expect(fan.subscriberCount).toBe(0);
    await expect(it.next()).rejects.toMatchObject({
      _tag: "SubscriberOverflow",
      reason: "items",
      limit: 3,
    });
  });

  it("fails only the subscriber that overflowed, not its siblings", async () => {
    const fan = new FanOut<number>({ maxQueue: 3 });
    const slow = await open(fan);
    const fast = await open(fan);
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
    const fan = new FanOut<number>({ maxQueue: 1 });
    const { it, close } = await open(fan);
    await close();
    fan.publishUnsafe(1);
    expect(fan.subscriberCount).toBe(0);
    expect(await next(it)).toEqual({ done: true, value: undefined });
  });

  it("does not deliver to subscribers added after a value was published", async () => {
    const fan = new FanOut<number>();
    fan.publishUnsafe(1);
    const { it } = await open(fan);
    fan.publishUnsafe(2);
    expect(await next(it)).toEqual({ done: false, value: 2 });
  });

  it("`stream` is a lazy subscription — running it IS subscribing", async () => {
    const fan = new FanOut<number>();
    const stream: Stream.Stream<number, SubscriberDropped> = fan.stream;
    expect(fan.subscriberCount).toBe(0);
    const fiber = Effect.runFork(Stream.runCollect(Stream.take(stream, 1)));
    await new Promise((r) => setTimeout(r, 10));
    expect(fan.subscriberCount).toBe(1);
    fan.publishUnsafe(5);
    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual([5]);
    expect(fan.subscriberCount).toBe(0);
  });
});

describe("FanOut byte budget", () => {
  function budgeted(limitChars: number): FanOut<string> {
    return new FanOut<string>({
      maxQueue: 1000,
      byteBudget: { sizeOf: (s) => s.length, limit: () => limitChars },
    });
  }

  it("drops a subscriber whose QUEUED bytes pass the budget", async () => {
    const fan = budgeted(100);
    const { it } = await open(fan);
    fan.publishUnsafe("x".repeat(60));
    fan.publishUnsafe("y".repeat(60));
    expect(fan.subscriberCount).toBe(0);
    await expect(it.next()).rejects.toMatchObject({
      _tag: "SubscriberOverflow",
      reason: "bytes",
      limit: 100,
    });
  });

  it("loses nothing for a subscriber that stays under the budget", async () => {
    const fan = budgeted(100);
    const { it } = await open(fan);
    for (const chunk of ["aaa", "bbb", "ccc"]) {
      fan.publishUnsafe(chunk);
      expect(await next(it)).toEqual({ done: false, value: chunk });
    }
    expect(fan.subscriberCount).toBe(1);
  });

  it("drops ONE lagging subscriber and leaves its siblings streaming", async () => {
    const fan = budgeted(100);
    const slow = await open(fan);
    const fast = await open(fan);
    for (let i = 0; i < 3; i++) {
      const chunk = "z".repeat(60);
      fan.publishUnsafe(chunk);
      expect(await next(fast.it)).toEqual({ done: false, value: chunk });
    }
    expect(fan.subscriberCount).toBe(1);
    await expect(slow.it.next()).rejects.toMatchObject({
      _tag: "SubscriberOverflow",
      reason: "bytes",
    });
  });

  it("delivers a single value that is itself over the budget, then drops", async () => {
    const fan = budgeted(100);
    const { it } = await open(fan);
    fan.publishUnsafe("w".repeat(500));
    expect(fan.subscriberCount).toBe(0);
    await expect(it.next()).rejects.toMatchObject({
      _tag: "SubscriberOverflow",
      reason: "bytes",
    });
  });

  it("gives the budget back as values are consumed", async () => {
    const fan = budgeted(100);
    const { it } = await open(fan);
    for (let i = 0; i < 20; i++) {
      const chunk = "q".repeat(80);
      fan.publishUnsafe(chunk);
      expect(await next(it)).toEqual({ done: false, value: chunk });
    }
    expect(fan.subscriberCount).toBe(1);
  });

  it("dropAllUnsafe invalidates every subscriber and stays open", async () => {
    const fan = budgeted(100);
    const a = await open(fan);
    const b = await open(fan);
    fan.dropAllUnsafe();
    expect(fan.subscriberCount).toBe(0);
    for (const sub of [a, b]) {
      await expect(sub.it.next()).rejects.toMatchObject({
        _tag: "SubscriberInvalidated",
      });
    }
    const fresh = await open(fan);
    fan.publishUnsafe("after");
    expect(await next(fresh.it)).toEqual({ done: false, value: "after" });
  });
});
