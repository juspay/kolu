/**
 * Shared test helper: consume a surface stream member frame by frame, with a
 * timeout, failing on a stream that stalls or ends before yielding. Every kaval
 * test that waits on a stream frame (the contract corpus, the in-process and
 * socket suites, the inventory-feed assertions) plugs into this ONE primitive,
 * so a change to how the suite races a frame (e.g. surfacing the pending value
 * on timeout) lands in one place instead of three near-identical copies — and
 * so does the ONE bridge from `Stream` back to a pull-shaped iterator.
 *
 * Contract-free ON PURPOSE: it lives BELOW the contract layer so the most
 * primitive tests can use it without taking a dependency on
 * `contractCorpus.testlib.ts` (which would invert the layering).
 *
 * This is a `.testlib.ts`, NOT a `.test.ts`: vitest's `include` is `*.test.ts`,
 * so this file is never run as a standalone suite, and default.nix's staleKey
 * fileFilter excludes `.testlib.ts` so a shared test helper does not land in the
 * daemon's hashed closure.
 */

import { Effect, type Scope, Stream } from "effect";

/** Run a SCOPED effect to completion and close its scope immediately — for a
 *  test that wants the value a scoped acquire produced (an attach's snapshot and
 *  cursor) and not the subscription that came with it, which the scope close
 *  releases.
 *
 *  Synchronous on purpose: `attach`'s publish-epoch coalescing is only
 *  observable when a burst of attaches shares one tick, so a test that counts
 *  serializes cannot afford a Promise hop between them. */
export function runScopedSync<A>(
  effect: Effect.Effect<A, never, Scope.Scope>,
): A {
  return Effect.runSync(Effect.scoped(effect));
}

/** Subscribe to a surface stream member and expose it as an async ITERATOR — the
 *  one place this package bridges `Stream` back to the pull-a-frame-at-a-time
 *  shape every assertion below is written in.
 *
 *  The Effect port turned every streaming member from
 *  `Promise<AsyncIterable<T>>` + an `AbortSignal` call option into a lazy
 *  `Stream<T>` (D10/#18): subscribing is running it, and UNSUBSCRIBING is
 *  interrupting the fiber that runs it — which `iterator.return()` does. So a
 *  test that used to `ac.abort()` now closes the iterator, and the teardown it
 *  asserts is the same teardown production gets. */
export function openStream<T>(
  stream: Stream.Stream<T, unknown>,
): AsyncIterator<T> {
  return Stream.toAsyncIterable(stream)[Symbol.asyncIterator]();
}

/** Close a subscription, fire-and-forget. Over a socket a left-open pull rejects
 *  when the connection later disposes (an unhandled rejection that fails the
 *  whole file); `return()` ends it. NOT awaited: a producer parked in an upstream
 *  `for await` settles its `return()` late, and awaiting here would stall the
 *  next subscription. Swallow — `return()` on an already-errored stream can
 *  reject. */
export function closeStream(it: AsyncIterator<unknown>): void {
  void Promise.resolve(it.return?.()).catch(() => {});
}

/** Race one already-issued pull against a deadline, failing loudly on a stream
 *  that stalls or ends without yielding — so a wedged subscription is a clear
 *  failure, not a hung test. */
async function awaitFrame<T>(
  pull: Promise<IteratorResult<T>>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("stream timed out")), ms);
  });
  try {
    const r = await Promise.race([pull, timeout]);
    if (r.done) throw new Error("stream ended without yielding");
    return r.value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Next frame from an ALREADY-OPEN iterator, with a timeout — does not close it,
 *  so the caller keeps reading (snapshot, then deltas) and closes once. */
export function nextFrame<T>(it: AsyncIterator<T>, ms = 8000): Promise<T> {
  return awaitFrame(it.next(), ms);
}

/** A subscription that is ALREADY ESTABLISHED when this returns.
 *
 *  Under Effect a stream is LAZY: subscribing is *running* it, and a pull-shaped
 *  consumer starts it by pulling. So a test that means "subscribe, THEN cause the
 *  event I am about to assert on" cannot merely hold the stream value — it must
 *  issue the first pull, or the producer never registers and the event it was
 *  waiting for happens to nobody. (Under the oRPC identity link the equivalent
 *  hop happened inside the `await client.<member>.get(...)` call, which is why
 *  the laziness was invisible before.)
 *
 *  {@link subscribeFrames} issues that first pull up front and hands back the
 *  frames in order, first pull included — so "subscribed FIRST" is a fact of the
 *  code and not a comment above it. */
export interface FrameStream<T> {
  /** Next frame, timeout-guarded. The first call resolves the pull issued at
   *  subscribe time. */
  next(ms?: number): Promise<T>;
  /** Pull frames until `match` is satisfied, discarding the rest — a shared host
   *  interleaves other tests' frames onto its host-global feeds. */
  until(match: (v: T) => boolean, ms?: number): Promise<T>;
  /** End the subscription (interrupts the fiber running it). Idempotent. */
  close(): void;
}

export function subscribeFrames<T>(
  stream: Stream.Stream<T, unknown>,
): FrameStream<T> {
  const it = openStream(stream);
  // Issued NOW — this is the subscribe.
  let pending: Promise<IteratorResult<T>> | undefined = it.next();
  const next = (ms = 8000): Promise<T> => {
    const pull = pending ?? it.next();
    pending = undefined;
    return awaitFrame(pull, ms);
  };
  return {
    next,
    async until(match, ms = 8000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const v = await next(Math.max(0, deadline - Date.now()));
        if (match(v)) return v;
      }
    },
    close: () => closeStream(it),
  };
}
