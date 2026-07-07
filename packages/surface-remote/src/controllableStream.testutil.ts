/**
 * A hand-driven async stream for unit tests: the test pushes frames, and can end
 * it cleanly (`end`) or kill it with an error (`fail`, i.e. a mid-chain link
 * death). `stream(signal)` observes the caller's abort signal — rejecting a
 * pending pull with `signal.reason`, exactly as a real oRPC publisher does on
 * teardown — so a downstream abort actually unblocks a relay rather than hanging
 * on an `await`.
 *
 * Shared by `relayStream.test` and `reServeSurface.test` so BOTH exercise the same
 * signal-aware abort semantics (the reServe test's local copy was previously
 * signal-blind, masking the real teardown path — #1661 candidate 20). Not a test
 * file (no `.test.ts`), so vitest doesn't collect it; it's imported by the tests.
 */

export interface Controllable<T> {
  /** An async iterable that observes `signal` (rejects a pending pull with
   *  `signal.reason` on abort), yields pushed frames, and ends on `end`/`fail`. */
  stream(signal?: AbortSignal): AsyncIterable<T>;
  push(v: T): void;
  end(): void;
  fail(err: unknown): void;
}

export function controllable<T>(): Controllable<T> {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let closed: "open" | "end" | { err: unknown } = "open";
  // Wake the parked iterator. Null `wake` BEFORE invoking it so a re-entrant
  // push/end during the resume installs a FRESH waiter instead of being clobbered.
  const nudge = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  return {
    stream(signal) {
      return {
        async *[Symbol.asyncIterator]() {
          const onAbort = (): void => nudge();
          signal?.addEventListener("abort", onAbort);
          try {
            while (true) {
              // Order is load-bearing: DRAIN queued frames first, so a frame
              // pushed just before end()/fail() still delivers; then check abort
              // BEFORE end/fail, so a teardown reason wins a race with a close.
              while (queue.length > 0) yield queue.shift() as T;
              if (signal?.aborted) throw signal.reason;
              if (closed === "end") return;
              if (typeof closed === "object") throw closed.err;
              await new Promise<void>((r) => {
                wake = r;
              });
            }
          } finally {
            signal?.removeEventListener("abort", onAbort);
          }
        },
      };
    },
    push(v) {
      queue.push(v);
      nudge();
    },
    end() {
      closed = "end";
      nudge();
    },
    fail(err) {
      closed = { err };
      nudge();
    },
  };
}
