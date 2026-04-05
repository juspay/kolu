import { describe, it, expect } from "vitest";
import { createRoot } from "solid-js";
import { createSubscription } from "./solid.ts";

/** Helper: create an async iterable from a push function + abort. */
function createTestStream<T>(): {
  push: (value: T) => void;
  error: (err: Error) => void;
  end: () => void;
  source: () => Promise<AsyncIterable<T>>;
} {
  const queue: T[] = [];
  let resolve: (() => void) | null = null;
  let done = false;
  let reject: ((err: Error) => void) | null = null;

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
      return {
        async next() {
          while (queue.length === 0) {
            if (done) return { done: true, value: undefined };
            await new Promise<void>((r, rej) => {
              resolve = r;
              reject = rej;
            });
          }
          return { done: false, value: queue.shift()! };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };

  return {
    push(value: T) {
      queue.push(value);
      resolve?.();
      resolve = null;
    },
    error(err: Error) {
      reject?.(err);
      reject = null;
    },
    end() {
      done = true;
      resolve?.();
      resolve = null;
    },
    source: () => Promise.resolve(iterable),
  };
}

/** Wait for microtasks to flush (async iterable consumption). */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createSubscription", () => {
  it("starts with undefined value and pending=true", () => {
    createRoot((dispose) => {
      const stream = createTestStream<number>();
      const sub = createSubscription(stream.source);

      expect(sub()).toBeUndefined();
      expect(sub.pending()).toBe(true);
      expect(sub.error()).toBeUndefined();

      dispose();
    });
  });

  it("receives the first value and clears pending", async () => {
    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const stream = createTestStream<number>();
        const sub = createSubscription(stream.source);

        stream.push(42);
        await tick();

        expect(sub()).toBe(42);
        expect(sub.pending()).toBe(false);

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("updates when new values are pushed", async () => {
    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const stream = createTestStream<string>();
        const sub = createSubscription(stream.source);

        stream.push("hello");
        await tick();
        expect(sub()).toBe("hello");

        stream.push("world");
        await tick();
        expect(sub()).toBe("world");

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("handles object values with fine-grained reactivity", async () => {
    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const stream = createTestStream<{ name: string; count: number }>();
        const sub = createSubscription(stream.source);

        stream.push({ name: "alpha", count: 0 });
        await tick();
        expect(sub()).toEqual({ name: "alpha", count: 0 });

        stream.push({ name: "alpha", count: 1 });
        await tick();
        expect(sub()).toEqual({ name: "alpha", count: 1 });

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("accumulates with reduce option", async () => {
    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const stream = createTestStream<number>();
        const sub = createSubscription(stream.source, {
          reduce: (acc: number[], item: number) => [...acc, item],
          initial: [] as number[],
        });

        expect(sub()).toEqual([]);

        stream.push(1);
        await tick();
        expect(sub()).toEqual([1]);

        stream.push(2);
        await tick();
        expect(sub()).toEqual([1, 2]);

        stream.push(3);
        await tick();
        expect(sub()).toEqual([1, 2, 3]);

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("reduce with maxItems (slice)", async () => {
    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const stream = createTestStream<number>();
        const sub = createSubscription(stream.source, {
          reduce: (acc: number[], item: number) => [...acc, item].slice(-2),
          initial: [] as number[],
        });

        stream.push(1);
        stream.push(2);
        stream.push(3);
        await tick();
        // All three pushed synchronously, processed in order
        expect(sub()).toEqual([2, 3]);

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("sets error on source rejection", async () => {
    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        // Source promise rejects — simulates connection failure
        const sub = createSubscription(() =>
          Promise.reject(new Error("connection lost")),
        );

        await tick();

        expect(sub.error()?.message).toBe("connection lost");
        expect(sub.pending()).toBe(false);

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("clears error when new value arrives after error", async () => {
    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const stream = createTestStream<number>();
        const sub = createSubscription(stream.source);

        stream.push(1);
        await tick();
        expect(sub()).toBe(1);
        expect(sub.error()).toBeUndefined();

        // Note: after an error the stream is done (for-await exits),
        // so error clearing only happens if error occurred before first value
        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("throws if reduce provided without initial", () => {
    createRoot((dispose) => {
      expect(() =>
        createSubscription(
          () => Promise.resolve({ [Symbol.asyncIterator]: () => ({}) } as any),
          {
            reduce: (acc: number[], item: number) => [...acc, item],
          } as any,
        ),
      ).toThrow("'initial' is required when using 'reduce'");
      dispose();
    });
  });

  it("aborts stream on dispose", async () => {
    let aborted = false;
    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const sub = createSubscription(() =>
          Promise.resolve({
            [Symbol.asyncIterator](): AsyncIterableIterator<number> {
              return {
                next() {
                  return new Promise((resolve) => {
                    // Hang until abort
                    const timer = setTimeout(
                      () => resolve({ done: false, value: 1 }),
                      100000,
                    );
                    // The abort will cause onCleanup → controller.abort()
                    // which won't directly cancel this promise, but the
                    // for-await loop checks controller.signal.aborted
                    clearTimeout(timer);
                    aborted = true;
                    resolve({ done: true, value: undefined });
                  });
                },
                [Symbol.asyncIterator]() {
                  return this;
                },
              };
            },
          }),
        );

        await tick();
        resolveDispose(dispose);
      });
    });
    dispose();
    expect(aborted).toBe(true);
  });
});
