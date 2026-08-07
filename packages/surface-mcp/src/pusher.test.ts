/// <reference types="node" />

/**
 * `ResourcePusher` lifecycle — driven generically with a fake client that
 * emits frames on demand. Pins the spine's contract: a frame fires a
 * (debounced) `notify`; unsubscribe tears the attachment down; an interrupted
 * subscription reports nothing; subscribe-before-live retries; and — new under
 * Effect — a detach really INTERRUPTS the per-URI subscription fibers rather
 * than leaving them running behind a disposed client.
 */

import { Effect, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourcePusher } from "./pusher";

/** A fake streamable source the test drives: `push` emits a frame to a live
 *  consumer; `end` completes it; ending the subscription ends it too. */
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
    stream: Stream.fromAsyncIterable(iterable, (e) => e),
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
      stream: () => source.stream,
      debounceMs: 50,
    });

    pusher.subscribe(URI);
    // Let the attach + stream-open work settle.
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
      stream: () => source.stream,
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
      stream: () => source.stream,
      dispose: (c) => disposed.push(c),
    });

    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    pusher.unsubscribe(URI);
    expect(disposed).toEqual([{ id: 7 }]);
  });

  it("an interrupted subscription reports nothing and reschedules nothing", async () => {
    // The Effect successor of "aborting a single-URI unsubscribe produces no
    // unhandled rejection": teardown is a fiber interrupt, and an interrupt is
    // never a failure — so nothing reaches `onError`, nothing re-attaches, and no
    // rejection escapes.
    const errors: unknown[] = [];
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      client: () => ({ id: 1 }),
      // A subscription that would run forever if nobody interrupted it.
      stream: () => Stream.never,
      onError: (e) => errors.push(e),
      retryMs: 10,
    });

    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(true);

    pusher.unsubscribe(URI);
    await vi.advanceTimersByTimeAsync(50);
    expect(errors).toEqual([]);
    expect(pusher.attached).toBe(false);
    await Promise.resolve();
    expect(unhandled).toEqual([]);
  });

  it("a detach INTERRUPTS every live subscription fiber (no orphaned subscription)", async () => {
    // The behaviour this port deliberately changes. The oRPC-era detach left the
    // per-stream controllers alone and relied on disposing the CLIENT to tear
    // every stream with it — which the in-process `directDispatch` case cannot do
    // (there is no socket to close), so a `stop()` would have leaked one live
    // handler subscription per URI for the life of the process. Under Effect the
    // subscription's lifetime IS its fiber's, so the detach interrupts them and
    // each stream's own finalizers run.
    let released = 0;
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      client: () => ({ id: 1 }),
      stream: () =>
        Stream.ensuring(
          Stream.never,
          Effect.sync(() => {
            released += 1;
          }),
        ),
    });

    pusher.subscribe(URI);
    pusher.subscribe("surface://cells/other");
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(true);
    expect(released).toBe(0);

    pusher.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toBe(2);
  });

  it("retries when the source isn't live yet, then attaches", async () => {
    const source = makeSource();
    let live = false;
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      // Returns null until `live` flips — subscribe-before-serve.
      client: () => (live ? { id: 1 } : null),
      stream: () => source.stream,
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

  it("a rejecting client factory retries, no unhandled rejection (F5)", async () => {
    const source = makeSource();
    let dials = 0;
    const errors: unknown[] = [];
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      // First dial rejects (bridge dial failed); the second succeeds.
      client: () => {
        dials += 1;
        if (dials === 1) return Promise.reject(new Error("ECONNREFUSED"));
        return { id: 1 };
      },
      stream: () => source.stream,
      onError: (e) => errors.push(e),
      retryMs: 100,
    });

    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    // The rejection was caught (routed to onError), not thrown.
    expect(pusher.attached).toBe(false);
    expect(errors).toHaveLength(1);

    // The bounded retry re-dials and attaches.
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(true);
    expect(unhandled).toEqual([]);

    pusher.stop();
  });

  it("a stream that fails before its first frame retries (F5)", async () => {
    const source = makeSource();
    let opens = 0;
    const errors: unknown[] = [];
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      client: () => ({ id: 1 }),
      // The client is live (attach succeeds), but the subscription fails the
      // first time — a pre-first-frame error the attach retry does NOT cover.
      stream: () => {
        opens += 1;
        if (opens === 1) return Stream.fail(new Error("stream open failed"));
        return source.stream;
      },
      onError: (e) => errors.push(e),
      retryMs: 100,
    });

    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    // The attach succeeded but the stream failed → detached, retry armed.
    expect(errors).toHaveLength(1);
    expect(pusher.attached).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(true);
    expect(unhandled).toEqual([]);

    pusher.stop();
  });

  it("unsubscribing mid-dial disposes the freshly-opened client (F6)", async () => {
    const source = makeSource();
    const disposed: Array<{ id: number }> = [];
    let resolveDial: ((c: { id: number }) => void) | null = null;
    const pusher = new ResourcePusher<{ id: number }>({
      notify: () => {},
      // A slow dial we resolve manually — lets us unsubscribe WHILE dialing.
      client: () =>
        new Promise<{ id: number }>((resolve) => {
          resolveDial = resolve;
        }),
      stream: () => source.stream,
      dispose: (c) => disposed.push(c),
    });

    pusher.subscribe(URI);
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(false); // still dialing

    // The last subscriber leaves while the dial is in flight.
    pusher.unsubscribe(URI);

    // The dial now resolves — but there's no subscriber, so the pusher must
    // dispose the freshly-opened client rather than store an idle attachment.
    const resolve = resolveDial as ((c: { id: number }) => void) | null;
    resolve?.({ id: 99 });
    await vi.advanceTimersByTimeAsync(0);
    expect(pusher.attached).toBe(false);
    expect(disposed).toEqual([{ id: 99 }]);
  });
});
