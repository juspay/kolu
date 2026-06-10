/**
 * `ResourcePusher` lifecycle — driven generically with a fake client that
 * emits frames on demand. Pins the spine's contract: a frame fires a
 * (debounced) `notify`; unsubscribe tears the attachment down; aborting a
 * stream produces no unhandled rejection; subscribe-before-live retries.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourcePusher } from "./pusher";

/** A fake streamable source the test drives: `push` emits a frame to a live
 *  consumer; `end` completes it; abort ends it too. */
function makeSource() {
  let pushFrame: ((v: unknown) => void) | null = null;
  let finish: (() => void) | null = null;
  let live = false;
  const iterable: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      const queue: unknown[] = [];
      const waiters: Array<(r: IteratorResult<unknown>) => void> = [];
      let done = false;
      live = true;
      pushFrame = (v) => {
        const w = waiters.shift();
        if (w) w({ value: v, done: false });
        else queue.push(v);
      };
      finish = () => {
        done = true;
        const w = waiters.shift();
        if (w) w({ value: undefined, done: true });
      };
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (done) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => waiters.push(resolve));
        },
        return(): Promise<IteratorResult<unknown>> {
          done = true;
          live = false;
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
  return {
    iterable,
    push: (v: unknown) => pushFrame?.(v),
    end: () => finish?.(),
    isLive: () => live,
  };
}

const URI = "surface://cells/count";

let unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => {
  unhandled.push(e);
};

beforeEach(() => {
  vi.useFakeTimers();
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  vi.useRealTimers();
});

describe("ResourcePusher", () => {
  it("a frame fires a debounced notify", async () => {
    const source = makeSource();
    const notified: string[] = [];
    const pusher = new ResourcePusher<{ id: number }>({
      notify: (uri) => notified.push(uri),
      client: () => ({ id: 1 }),
      stream: () => source.iterable,
      debounceMs: 50,
    });

    pusher.subscribe(URI);
    // Let the attach + stream-open microtasks settle.
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(true);

    source.push(42);
    await vi.advanceTimersByTimeAsync(0);
    // Debounced — not yet.
    expect(notified).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(notified).toEqual([URI]);

    pusher.stop();
  });

  it("unsubscribe tears the attachment down", async () => {
    const source = makeSource();
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      client: () => ({ id: 1 }),
      stream: () => source.iterable,
    });

    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(true);

    pusher.unsubscribe(URI);
    expect(pusher.attached).toBe(false);
  });

  it("disposes the client on detach (bridge case)", async () => {
    const source = makeSource();
    const disposed: Array<{ id: number }> = [];
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      client: () => ({ id: 7 }),
      stream: () => source.iterable,
      dispose: (c) => disposed.push(c),
    });

    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    pusher.unsubscribe(URI);
    expect(disposed).toEqual([{ id: 7 }]);
  });

  it("aborting a single-URI unsubscribe produces no unhandled rejection", async () => {
    const source = makeSource();
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      client: () => ({ id: 1 }),
      // The stream rejects when its signal aborts — the pusher must swallow it.
      stream: (_client, _uri, signal) =>
        new Promise<AsyncIterable<unknown>>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });

    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    pusher.unsubscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    // Let any swallowed rejection surface.
    await Promise.resolve();
    expect(unhandled).toEqual([]);
  });

  it("retries when the source isn't live yet, then attaches", async () => {
    const source = makeSource();
    let live = false;
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      // Returns null until `live` flips — subscribe-before-serve.
      client: () => (live ? { id: 1 } : null),
      stream: () => source.iterable,
      retryMs: 100,
    });

    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(false); // not live yet

    live = true;
    await vi.advanceTimersByTimeAsync(100); // the retry tick
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(true);

    pusher.stop();
  });

  it("stop() after detach leaves no pending retry timer", async () => {
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      client: () => null, // never live
      stream: () => undefined,
      retryMs: 100,
    });
    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    pusher.stop();
    // Advancing past the retry window must not re-attach (stopped).
    await vi.advanceTimersByTimeAsync(500);
    expect(pusher.attached).toBe(false);
  });
});
