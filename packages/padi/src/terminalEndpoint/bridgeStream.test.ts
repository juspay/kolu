/**
 * `bridgeStream` error-contract pins — the seam the W12 STAYS-DEFINED-UNDER-BLINDNESS
 * invariant leans on. The invariant is: a foreground-tap FAILURE (an unclean kaval
 * death drops the socket) must NEVER manufacture a foreground sample — the agent
 * sensor's shell-idle discriminant would misread a fabricated `undefined` as a genuine
 * shell-idle and clobber the resume target.
 *
 * `local.ts`'s foreground bridge upholds this by giving `bridgeStream` an `onError`
 * that ONLY logs (it performs no `signals.foreground.publish`). Two pins, one per half
 * of the guarantee:
 *   1. the MECHANISM — on a non-abort source failure `bridgeStream` routes to `onError`
 *      and NEVER calls `onEvent`, so the failure path structurally cannot emit a value
 *      onto the channel;
 *   2. the PRODUCTION handler — `onForegroundTapError` (the actual `onError` the
 *      foreground bridge is wired with) never publishes onto the foreground channel it
 *      is handed, so the only writer stays the real-sample `onEvent`. This pin is what
 *      constrains a future "clear stale foreground on disconnect" regression that #1 (a
 *      generic `onEvent`-never-called proof) would not catch.
 */

import type { ForegroundSample } from "kaval";
import { describe, expect, it } from "vitest";
import {
  bridgeStream,
  onForegroundTapError,
  resubscribeStream,
} from "./local.ts";

/** An async iterable that REJECTS on first pull — the shape a dropped tap socket
 *  surfaces (the `for await` throws rather than ending cleanly). */
const failingStream = (): AsyncIterable<number> => ({
  [Symbol.asyncIterator]: () => ({
    next: () =>
      Promise.reject(new Error("stream failed (kaval socket dropped)")),
  }),
});

/** An async iterable that yields nothing and ends — a clean close. */
const emptyStream = (): AsyncIterable<number> => ({
  [Symbol.asyncIterator]: () => ({
    next: () => Promise.resolve({ done: true, value: undefined }),
  }),
});

describe("bridgeStream — the failure path never fabricates an event", () => {
  it("a NON-abort source failure routes to onError and NEVER calls onEvent", async () => {
    const events: number[] = [];
    let errored: unknown;
    const ac = new AbortController();

    await bridgeStream(
      failingStream(),
      ac.signal,
      (v) => events.push(v),
      (err) => {
        errored = err;
      },
    );

    // The blindness guarantee: a failed tap emitted NOTHING onto the sink. If the
    // foreground bridge's onError ever published a sample, it would ride THROUGH here;
    // pinning onEvent-never-called proves the failure path has no way to fabricate one.
    expect(events).toEqual([]);
    expect(errored).toBeInstanceOf(Error);
  });

  it("an ABORTED source failure is swallowed — onError is NOT called (expected teardown)", async () => {
    const events: number[] = [];
    let errored = false;
    const ac = new AbortController();
    ac.abort(); // teardown already requested before the stream throws

    await bridgeStream(
      failingStream(),
      ac.signal,
      (v) => events.push(v),
      () => {
        errored = true;
      },
    );

    expect(events).toEqual([]);
    expect(errored).toBe(false); // an abort is expected teardown, never an error
  });

  it("a clean end resolves without touching onError", async () => {
    let errored = false;
    const ac = new AbortController();
    await bridgeStream(
      emptyStream(),
      ac.signal,
      () => {},
      () => {
        errored = true;
      },
    );
    expect(errored).toBe(false);
  });
});

describe("onForegroundTapError — the production handler never publishes (STAYS-DEFINED)", () => {
  it("a tap failure logs but leaves the foreground channel UNWRITTEN — blindness keeps the last sample", () => {
    // The production `onError` the foreground bridge is wired with. It RECEIVES the
    // foreground channel (it CAN publish), so this pins the load-bearing invariant that
    // it does NOT: a regression that reset/cleared the foreground on a dropped tap would
    // push a sample here and fail the assert. `bridgeStream` guarantees the failure path
    // can't fabricate an `onEvent`; THIS guarantees the handler itself doesn't publish.
    const published: ForegroundSample[] = [];
    const foreground = {
      publish: (s: ForegroundSample) => {
        published.push(s);
      },
    };

    onForegroundTapError(
      "t1",
      foreground,
      new Error("kaval socket dropped mid-foreground-tap"),
    );

    expect(published).toEqual([]);
  });
});

describe("resubscribeStream — the eager synchronous-throw guard", () => {
  it("catches getStream()'s SYNCHRONOUS throw (daemon down) as a drop and re-subscribes, never rejecting", async () => {
    // The forwarding facade calls `liveClient()` eagerly, so `getStream()` throws
    // SYNCHRONOUSLY when the daemon is disconnected — before bridgeStream runs, so
    // its fence can't catch it. Without the guard this rejects and (as a void'd
    // detached task) crashes the server on `unhandledRejection`.
    const drops: unknown[] = [];
    let calls = 0;
    const ac = new AbortController();
    await resubscribeStream<number>({
      signal: ac.signal,
      delayMs: 0,
      getStream: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("pty-host endpoint is not connected"); // daemon down
        }
        // Second attempt: the daemon is back — a clean, empty stream that ends.
        ac.abort(); // stop the loop after one successful re-subscribe
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true, value: undefined }),
          }),
        };
      },
      onEvent: () => {},
      onDrop: (err) => drops.push(err),
    });

    // The synchronous throw was caught as a drop (not propagated), and the loop
    // re-subscribed rather than dying.
    expect(drops).toHaveLength(1);
    expect(drops[0]).toBeInstanceOf(Error);
    expect(calls).toBe(2);
  });

  it("stops promptly without re-subscribing once the signal is aborted", async () => {
    let calls = 0;
    const ac = new AbortController();
    ac.abort();
    await resubscribeStream<number>({
      signal: ac.signal,
      delayMs: 0,
      getStream: () => {
        calls += 1;
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true, value: undefined }),
          }),
        };
      },
      onEvent: () => {},
      onDrop: () => {},
    });
    expect(calls).toBe(0); // aborted before the first subscribe
  });
});
