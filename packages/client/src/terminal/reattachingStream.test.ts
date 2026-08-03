import { Effect, type Fiber, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReattachingStream } from "./reattachingStream";

/** Emit each of `items`, then either END cleanly or FAIL with `failWith`. */
function streamThat<T>(
  items: T[],
  failWith?: unknown,
): Stream.Stream<T, unknown> {
  const emitted: Stream.Stream<T, unknown> = Stream.fromIterable(items);
  return failWith === undefined
    ? emitted
    : Stream.concat(emitted, Stream.fail(failWith));
}

/** Resolve pending microtasks so the fire-and-forget fiber advances. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Run the loop the way its one production caller does: one fiber, interrupted
 *  to stop it. The `AbortSignal` this helper used to take is gone — teardown is
 *  fiber interruption (D10/#18), and there is nothing left to thread. */
function start(
  ...args: Parameters<typeof consumeReattachingStream<string>>
): Fiber.Fiber<void, never> {
  return Effect.runFork(consumeReattachingStream(...args).pipe(Effect.orDie));
}

describe("consumeReattachingStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("abnormal end → re-attaches and re-subscribes with fresh items", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const items: string[] = [];
    const onReattach = vi.fn();
    // 1st stream FAILS after its frame → abnormal mid-chain end; 2nd emits then
    // ends cleanly, stopping the loop.
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat(["stale"], new Error("padi died")))
      .mockReturnValueOnce(streamThat(["fresh-snapshot", "live"]));

    start(streamFn, (item) => items.push(item), onReattach, "test");

    // Drain the loop, waiting past the real-timer 300ms backoff that sits
    // between the failed first attempt and the re-subscribe.
    await new Promise((r) => setTimeout(r, 350));
    for (let i = 0; i < 10; i++) await flush();

    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(streamFn).toHaveBeenCalledTimes(2);
    // The stale first stream's frame flowed to onItem; then the fresh
    // re-subscribe's frames flowed too — the reattach never spliced, it re-served.
    expect(items).toEqual(["stale", "fresh-snapshot", "live"]);
  });

  it("graceful end (PTY exit) → does NOT loop or re-attach", async () => {
    const items: string[] = [];
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat(["a", "b"]));

    start(streamFn, (item) => items.push(item), onReattach, "test");

    for (let i = 0; i < 10; i++) await flush();

    expect(streamFn).toHaveBeenCalledTimes(1); // clean end → no re-subscribe
    expect(onReattach).not.toHaveBeenCalled();
    expect(items).toEqual(["a", "b"]);
  });

  // The successor of the old "expected cleanup error" case. There is no such
  // error to classify any more: teardown is a fiber INTERRUPT, and an
  // interruption is not a failure — so an unmount can no longer be mistaken for
  // a mid-chain death by any predicate, because it never reaches the failure
  // handler at all (D10/#18).
  it("interrupt mid-stream → the loop stops silently, no re-attach", async () => {
    const items: string[] = [];
    const onReattach = vi.fn();
    // Never ends on its own: only the interrupt can stop it.
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(Stream.concat(streamThat(["a"]), Stream.never));

    const fiber = start(
      streamFn,
      (item) => items.push(item),
      onReattach,
      "test",
    );

    for (let i = 0; i < 5; i++) await flush();
    expect(items).toEqual(["a"]);

    fiber.interruptUnsafe();
    for (let i = 0; i < 10; i++) await flush();

    expect(streamFn).toHaveBeenCalledTimes(1); // stopped, never re-subscribed
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("interrupting during the BACKOFF stops the loop — the sleep is interruptible", async () => {
    // The successor of "signal already aborted → streamFn is never invoked".
    // That case tested a pre-armed abort against a hand-rolled `open()` guard;
    // the guard is gone, and what replaces it is stronger: the backoff is an
    // `Effect.sleep` inside the retry schedule, so an interrupt lands DURING it
    // and no re-subscribe ever happens. The old `clearTimeout` bookkeeping the
    // abort listener did is what this deletes.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat<string>([], new Error("padi died")));

    const fiber = start(streamFn, () => {}, onReattach, "test");

    await new Promise((r) => setTimeout(r, 50)); // failed once, now sleeping
    expect(streamFn).toHaveBeenCalledTimes(1);
    fiber.interruptUnsafe();

    await new Promise((r) => setTimeout(r, 350)); // well past the backoff
    expect(streamFn).toHaveBeenCalledTimes(1); // never re-subscribed
  });

  it("waits ~300ms between a failed attempt and the re-subscribe (backoff)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat<string>([], new Error("padi died")))
      .mockReturnValueOnce(streamThat(["fresh"]));

    start(streamFn, () => {}, onReattach, "test");

    // Let the first attempt fail + onReattach fire, but DON'T yet cross the
    // backoff. Real timers, not fake ones: the attempt runs on an Effect fiber
    // whose scheduler is not the one `vi.useFakeTimers()` controls, so faking
    // time here would stall the failure that arms the backoff in the first place.
    await new Promise((r) => setTimeout(r, 50));
    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(streamFn).toHaveBeenCalledTimes(1); // still inside the backoff

    // Crossing 300ms triggers the re-subscribe.
    await new Promise((r) => setTimeout(r, 350));
    expect(streamFn).toHaveBeenCalledTimes(2);
  });
});
