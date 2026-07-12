/** Shared abort-aware async-iterator mock for `unenrolledStreamCall`, for the pulse-driven
 *  Code-tab query tests. It yields once per pushed `{ frame: true }`, throws a pushed
 *  `{ err }`, and ends cleanly on `signal` abort — the identical iterator mechanics that
 *  `createPolledQuery.test.ts` and `hostCodeTab.test.ts` each used to hand-roll. Each test
 *  wires its OWN emit tracking (a single `latest`, or a multi-subscriber Set) on top of the
 *  returned `push`, since that part genuinely differs per fixture. */

export type StreamEvent = { frame: true } | { err: Error };

export function makeAbortAwareStream(signal?: AbortSignal): {
  iterable: AsyncIterable<undefined>;
  push: (event: StreamEvent) => void;
} {
  const queue: StreamEvent[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  signal?.addEventListener("abort", () => {
    ended = true;
    wake?.();
    wake = null;
  });
  const push = (event: StreamEvent) => {
    queue.push(event);
    wake?.();
    wake = null;
  };
  const iterable: AsyncIterable<undefined> = {
    async *[Symbol.asyncIterator]() {
      while (!ended) {
        while (queue.length) {
          const event = queue.shift();
          if (event && "err" in event) throw event.err;
          yield undefined;
        }
        if (ended) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
  return { iterable, push };
}
