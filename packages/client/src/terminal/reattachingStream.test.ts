import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReattachingStream } from "./reattachingStream";

/** Yield each of `items`, then either return cleanly or throw `endWith`. */
async function* iterableThat<T>(
  items: T[],
  endWith?: unknown,
): AsyncGenerator<T> {
  for (const item of items) yield item;
  if (endWith !== undefined) throw endWith;
}

/** Resolve pending microtasks so the fire-and-forget loop advances. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("consumeReattachingStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("abnormal end → re-attaches and re-subscribes with fresh items", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = new AbortController();
    const items: string[] = [];
    const onReattach = vi.fn();
    // 1st iterable throws a PLAIN Error (not a cleanup error) → abnormal mid-chain
    // end; 2nd iterable yields then ends cleanly, stopping the loop.
    const streamFn = vi
      .fn<() => Promise<AsyncIterable<string>>>()
      .mockResolvedValueOnce(iterableThat(["stale"], new Error("padi died")))
      .mockResolvedValueOnce(iterableThat(["fresh-snapshot", "live"]));

    consumeReattachingStream(
      streamFn,
      (item) => items.push(item),
      onReattach,
      controller.signal,
      "test",
    );

    // Drain the loop, waiting past the real-timer 300ms backoff that sits
    // between the failed first attempt and the re-subscribe.
    await new Promise((r) => setTimeout(r, 350));
    for (let i = 0; i < 10; i++) await flush();

    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(streamFn).toHaveBeenCalledTimes(2);
    // The stale first-iterable item flowed to onItem; then the fresh re-subscribe's
    // items flowed too — the reattach never spliced, it re-served.
    expect(items).toEqual(["stale", "fresh-snapshot", "live"]);
  });

  it("graceful end (PTY exit) → does NOT loop or re-attach", async () => {
    const controller = new AbortController();
    const items: string[] = [];
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Promise<AsyncIterable<string>>>()
      .mockResolvedValue(iterableThat(["a", "b"]));

    consumeReattachingStream(
      streamFn,
      (item) => items.push(item),
      onReattach,
      controller.signal,
      "test",
    );

    for (let i = 0; i < 10; i++) await flush();

    expect(streamFn).toHaveBeenCalledTimes(1); // clean return → no re-subscribe
    expect(onReattach).not.toHaveBeenCalled();
    expect(items).toEqual(["a", "b"]);
  });

  it("unmount abort (expected cleanup error) → does NOT loop or re-attach", async () => {
    const controller = new AbortController();
    const onReattach = vi.fn();
    // `isExpectedCleanupError` matches a DOMException named "AbortError" — the
    // shape `AbortController.abort()` produces on unmount (see rpc/streamCleanup).
    const abortError = new DOMException("aborted", "AbortError");
    const streamFn = vi
      .fn<() => Promise<AsyncIterable<string>>>()
      .mockResolvedValue(iterableThat<string>([], abortError));

    consumeReattachingStream(
      streamFn,
      () => {},
      onReattach,
      controller.signal,
      "test",
    );

    for (let i = 0; i < 10; i++) await flush();

    expect(streamFn).toHaveBeenCalledTimes(1); // stopped on the cleanup error
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("signal already aborted → streamFn is never invoked", async () => {
    const controller = new AbortController();
    controller.abort();
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Promise<AsyncIterable<string>>>()
      .mockResolvedValue(iterableThat(["never"]));

    consumeReattachingStream(
      streamFn,
      () => {},
      onReattach,
      controller.signal,
      "test",
    );

    for (let i = 0; i < 10; i++) await flush();

    expect(streamFn).not.toHaveBeenCalled();
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("waits ~300ms between a failed attempt and the re-subscribe (backoff)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    const controller = new AbortController();
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Promise<AsyncIterable<string>>>()
      .mockResolvedValueOnce(iterableThat<string>([], new Error("padi died")))
      .mockResolvedValueOnce(iterableThat(["fresh"]));

    consumeReattachingStream(
      streamFn,
      () => {},
      onReattach,
      controller.signal,
      "test",
    );

    // Let the first attempt fail + onReattach fire, but DON'T yet cross the backoff.
    await vi.advanceTimersByTimeAsync(0);
    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(streamFn).toHaveBeenCalledTimes(1); // still inside the backoff

    // Just shy of 300ms: still no re-subscribe.
    await vi.advanceTimersByTimeAsync(299);
    expect(streamFn).toHaveBeenCalledTimes(1);

    // Crossing 300ms triggers the re-subscribe.
    await vi.advanceTimersByTimeAsync(1);
    expect(streamFn).toHaveBeenCalledTimes(2);
  });
});
