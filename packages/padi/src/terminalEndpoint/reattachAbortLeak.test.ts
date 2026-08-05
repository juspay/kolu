/**
 * K2 (kolu#2101): an abort while the re-open loop is between attachments must
 * leave NO kaval subscription behind.
 *
 * The leak is invisible to `reattachingDeltas.test.ts`'s scripted iterators —
 * they have no subscription to leak. So these tests drive the REAL fan-out
 * (`kaval`'s `FanOut`, the primitive every PTY tap is built on) and read
 * `subscriberCount`, which is the only honest observable of "this attachment is
 * still draining the host". A leaked subscriber holds a bounded queue and a
 * fan-out slot until the PTY exits or the 10k-item overflow drops it.
 *
 * The three leaks, all reachable from one client disconnect landing in the
 * 150/300/600ms re-open pause:
 *   1. the pause was a bare `setTimeout`, so an abort during it did nothing;
 *   2. the overflow re-open never re-checked the signal at all;
 *   3. the abort→`iter.return()` bridge was registered on a possibly
 *      ALREADY-aborted signal, and per WHATWG `addEventListener("abort")` on an
 *      aborted signal never fires — so the subscription it was meant to release
 *      was undetachable from the moment it opened.
 */

import { Stream } from "effect";
import { FanOut, type PtyHostDataMsg } from "kaval";
import { afterEach, describe, expect, it } from "vitest";
import {
  type OpenedAttach,
  reattachingDeltas,
  releaseOnAbort,
} from "./reattachingDeltas.ts";
import type { TerminalAttachFrame } from "../endpoint.ts";

const ctx = { id: "t-leak" };

const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Poll until `cond` holds or the budget runs out — the fan-out releases its
 *  subscriber when the consuming fiber finishes interrupting, which is a task or
 *  two after `iter.return()`. */
async function waitFor(cond: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await delay(5);
}

/** A leg that ends immediately with no `overflow` frame — the manufactured plain
 *  end whose answer is a re-open. */
const endedIter = (): AsyncIterator<PtyHostDataMsg> => ({
  next: () => Promise.resolve({ done: true, value: undefined }),
});

/** A leg whose single frame is kaval's typed `overflow` — the host telling us it
 *  dropped us, whose answer is also a re-open. */
function overflowIter(): AsyncIterator<PtyHostDataMsg> {
  let sent = false;
  return {
    next: () =>
      Promise.resolve(
        sent
          ? { done: true, value: undefined }
          : ((sent = true), { done: false, value: { kind: "overflow" } }),
      ),
  };
}

/** `local.ts`'s `open()`, reduced to the two moves that matter here: subscribe to
 *  the host's fan-out through `Stream.toAsyncIterable` (whose `return()` closes
 *  the subscription's scope — that IS the unsubscribe) and bridge the caller's
 *  abort onto that one teardown. */
function openOnFanOut(
  fan: FanOut<PtyHostDataMsg>,
  signal: AbortSignal | undefined,
): OpenedAttach {
  const iter = Stream.toAsyncIterable(fan.stream)[Symbol.asyncIterator]();
  releaseOnAbort(iter, signal);
  return { snapshot: "FRESH", topLine: 0, iter };
}

/** Every fan-out a test opened, closed after it so a still-running generator
 *  can't outlive the test (a closed fan-out ends its subscriptions, which ends
 *  the loop). */
const opened: FanOut<PtyHostDataMsg>[] = [];
function fanOut(): FanOut<PtyHostDataMsg> {
  const fan = new FanOut<PtyHostDataMsg>();
  opened.push(fan);
  return fan;
}
afterEach(async () => {
  for (const fan of opened.splice(0)) fan.closeUnsafe();
  await delay(20);
});

/** Drain `gen` in the background; the returned promise settles when the loop
 *  ends. Never awaited unconditionally — the pre-fix loop does not end. */
function drain(gen: AsyncGenerator<TerminalAttachFrame>): Promise<void> {
  return (async () => {
    for await (const _ of gen) {
      /* the frames are not what these tests assert on */
    }
  })();
}

describe("reattachingDeltas — an abort must not leak a kaval subscription", () => {
  it("abort DURING the re-open pause: the loop ends and re-opens nothing", async () => {
    const fan = fanOut();
    const controller = new AbortController();
    let opens = 0;
    const gen = reattachingDeltas(
      () => {
        opens++;
        return Promise.resolve(openOnFanOut(fan, controller.signal));
      },
      endedIter(),
      { ...ctx, signal: controller.signal },
    );
    const done = drain(gen);
    // The first leg's plain end starts the 150ms pause; the client disconnects
    // 50ms into it.
    await delay(50);
    controller.abort();
    await Promise.race([done, delay(600)]);
    // Pre-fix: the bare `setTimeout` ran to completion, `open()` re-subscribed,
    // and the abort bridge — registered on an already-aborted signal — never
    // fired. One live subscriber, undetachable.
    expect(fan.subscriberCount).toBe(0);
    expect(opens).toBe(0);
  });

  it("abort COINCIDENT with an overflow drop: the overflow re-open is not taken", async () => {
    const fan = fanOut();
    const controller = new AbortController();
    let opens = 0;
    const gen = reattachingDeltas(
      () => {
        opens++;
        return Promise.resolve(openOnFanOut(fan, controller.signal));
      },
      overflowIter(),
      { ...ctx, signal: controller.signal },
    );
    const done = drain(gen);
    // The host dropped us for lag and the client went away in the same moment —
    // the two share a root cause, so this is the field-plausible pairing.
    await delay(20);
    controller.abort();
    await Promise.race([done, delay(600)]);
    expect(fan.subscriberCount).toBe(0);
    expect(opens).toBe(0);
  });

  it("an ALREADY-aborted signal releases the subscription immediately (WHATWG)", async () => {
    // `addEventListener("abort")` on an aborted signal never fires, so a bridge
    // that only registers hands back a subscription nothing can ever detach.
    const fan = fanOut();
    const controller = new AbortController();
    controller.abort();
    const iter = Stream.toAsyncIterable(fan.stream)[Symbol.asyncIterator]();
    releaseOnAbort(iter, controller.signal);
    // The pull is what RUNS the stream (and would register the subscriber) —
    // exactly what `open()` does next when it reads the snapshot frame.
    await iter.next();
    await waitFor(() => fan.subscriberCount === 0);
    expect(fan.subscriberCount).toBe(0);
  });

  it("a LIVE signal still releases the subscription when it aborts later", async () => {
    // The other half of the same bridge: the ordinary case must keep working.
    const fan = fanOut();
    const controller = new AbortController();
    const iter = Stream.toAsyncIterable(fan.stream)[Symbol.asyncIterator]();
    releaseOnAbort(iter, controller.signal);
    void iter.next();
    await waitFor(() => fan.subscriberCount === 1);
    expect(fan.subscriberCount).toBe(1);
    controller.abort();
    await waitFor(() => fan.subscriberCount === 0);
    expect(fan.subscriberCount).toBe(0);
  });
});
