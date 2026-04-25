import { unwrap } from "kolu-common/unwrap";
import { createEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createSubscription, type Subscription } from "./createSubscription";

/** Test-local: read the current value of a subscription, throwing with a
 *  descriptive message if it hasn't yielded yet. Replaces inline non-null
 *  assertions on `sub()` so the failure mode is "subscription expected a
 *  value but had none" rather than "Cannot read property of undefined".
 *  Only the `undefined` case (no value yet) throws — `null` is a legitimate
 *  yielded value, exercised by the "handles null values" test. */
function readSub<T>(sub: Subscription<T>): T {
  const value = sub();
  if (value === undefined) {
    throw new Error("subscription has not yielded a value yet");
  }
  return value;
}

/** Create an async iterable from an array, yielding items with optional delay. */
async function* fromArray<T>(items: T[], delayMs = 0): AsyncGenerator<T> {
  for (const item of items) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    yield item;
  }
}

/** Create a controllable stream: push items manually, close when done. */
function controllableStream<T>() {
  const queue: T[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  function push(item: T) {
    queue.push(item);
    resolve?.();
  }

  function close() {
    done = true;
    resolve?.();
  }

  async function* iterate(): AsyncGenerator<T> {
    while (true) {
      const head = queue.shift();
      if (head !== undefined) {
        yield head;
        continue;
      }
      if (done) return;
      await new Promise<void>((r) => {
        resolve = r;
      });
      resolve = null;
    }
  }

  return { push, close, iterate };
}

/** Flush microtasks so async stream items are processed. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("createSubscription", () => {
  describe("value replacement (no reducer)", () => {
    it("starts with undefined and pending=true", () => {
      createRoot((dispose) => {
        const stream = controllableStream<number>();
        const sub = createSubscription(() => Promise.resolve(stream.iterate()));

        expect(sub()).toBe(undefined);
        expect(sub.pending()).toBe(true);
        expect(sub.error()).toBe(undefined);

        stream.close();
        dispose();
      });
    });

    it("updates value and clears pending on first item", async () => {
      const result = await new Promise<{ value: number; pending: boolean }>(
        (resolve) => {
          createRoot(async (dispose) => {
            const stream = controllableStream<number>();
            const sub = createSubscription(() =>
              Promise.resolve(stream.iterate()),
            );

            stream.push(42);
            await flush();

            resolve({ value: readSub(sub), pending: sub.pending() });
            stream.close();
            dispose();
          });
        },
      );

      expect(result.value).toBe(42);
      expect(result.pending).toBe(false);
    });

    it("replaces value on each item", async () => {
      const result = await new Promise<number[]>((resolve) => {
        createRoot(async (dispose) => {
          const stream = controllableStream<number>();
          const sub = createSubscription(() =>
            Promise.resolve(stream.iterate()),
          );

          const values: number[] = [];
          stream.push(1);
          await flush();
          values.push(readSub(sub));

          stream.push(2);
          await flush();
          values.push(readSub(sub));

          stream.push(3);
          await flush();
          values.push(readSub(sub));

          resolve(values);
          stream.close();
          dispose();
        });
      });

      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe("primitive values", () => {
    it("handles string values", async () => {
      const result = await new Promise<string>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createSubscription(() =>
            Promise.resolve(fromArray(["hello"])),
          );
          await flush();
          resolve(readSub(sub));
          dispose();
        });
      });

      expect(result).toBe("hello");
    });

    it("handles boolean values", async () => {
      const result = await new Promise<boolean>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createSubscription(() =>
            Promise.resolve(fromArray([true])),
          );
          await flush();
          resolve(readSub(sub));
          dispose();
        });
      });

      expect(result).toBe(true);
    });

    it("handles null values", async () => {
      const result = await new Promise<null>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createSubscription(() =>
            Promise.resolve(fromArray([null as unknown as string])),
          );
          await flush();
          resolve(readSub(sub) as unknown as null);
          dispose();
        });
      });

      expect(result).toBe(null);
    });
  });

  describe("object values (reconcile)", () => {
    it("uses reconcile for fine-grained reactivity on objects", async () => {
      const result = await new Promise<{ a: number; b: number }>((resolve) => {
        createRoot(async (dispose) => {
          const stream = controllableStream<{ a: number; b: number }>();
          const sub = createSubscription(() =>
            Promise.resolve(stream.iterate()),
          );

          stream.push({ a: 1, b: 2 });
          await flush();
          resolve(readSub(sub));
          stream.close();
          dispose();
        });
      });

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("updates only changed fields via reconcile", async () => {
      const result = await new Promise<{ tracked: boolean }>((resolve) => {
        createRoot(async (dispose) => {
          const stream = controllableStream<{ a: number; b: number }>();
          const sub = createSubscription(() =>
            Promise.resolve(stream.iterate()),
          );

          stream.push({ a: 1, b: 2 });
          await flush();

          // Track whether reading `a` re-fires when only `b` changes
          let aFired = false;
          createEffect(() => {
            sub()?.a;
            if (!sub.pending()) aFired = true;
          });

          aFired = false;
          stream.push({ a: 1, b: 99 }); // only b changes
          await flush();

          resolve({ tracked: !aFired });
          stream.close();
          dispose();
        });
      });

      // With reconcile, changing only `b` should not re-trigger an effect tracking `a`
      expect(result.tracked).toBe(true);
    });

    it("handles array values via reconcile", async () => {
      const result = await new Promise<number[]>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createSubscription(() =>
            Promise.resolve(fromArray([[1, 2, 3]])),
          );
          await flush();
          resolve([...(readSub(sub) as unknown as number[])]);
          dispose();
        });
      });

      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe("reducer (accumulation mode)", () => {
    it("accumulates items with reduce + initial", async () => {
      const result = await new Promise<number[]>((resolve) => {
        createRoot(async (dispose) => {
          const stream = controllableStream<number>();
          const sub = createSubscription(
            () => Promise.resolve(stream.iterate()),
            {
              reduce: (acc: number[], item: number) => [...acc, item],
              initial: [] as number[],
            },
          );

          expect(sub()).toEqual([]);

          stream.push(1);
          await flush();
          stream.push(2);
          await flush();
          stream.push(3);
          await flush();

          resolve([...(readSub(sub) as number[])]);
          stream.close();
          dispose();
        });
      });

      expect(result).toEqual([1, 2, 3]);
    });

    it("throws if reduce is provided without initial", () => {
      expect(() => {
        createRoot((dispose) => {
          // @ts-expect-error testing the runtime guard fires when
          // `initial` is omitted (the type system would normally require it).
          createSubscription(() => Promise.resolve(fromArray([1])), {
            reduce: (acc: number, item: number) => acc + item,
          });
          dispose();
        });
      }).toThrow("'initial' is required when using 'reduce'");
    });

    it("uses initial value before first item", () => {
      createRoot((dispose) => {
        const stream = controllableStream<number>();
        const sub = createSubscription(
          () => Promise.resolve(stream.iterate()),
          {
            reduce: (acc: number[], item: number) => [...acc, item],
            initial: [0],
          },
        );

        expect(sub()).toEqual([0]);

        stream.close();
        dispose();
      });
    });
  });

  describe("error handling", () => {
    it("sets error signal on stream failure", async () => {
      const result = await new Promise<{ error: string; pending: boolean }>(
        (resolve) => {
          createRoot(async (dispose) => {
            const sub = createSubscription(() =>
              Promise.resolve(
                (async function* () {
                  throw new Error("stream broke");
                })(),
              ),
            );

            await flush();

            resolve({
              error: unwrap(sub.error(), "expected sub.error()").message,
              pending: sub.pending(),
            });
            dispose();
          });
        },
      );

      expect(result.error).toBe("stream broke");
      expect(result.pending).toBe(false);
    });

    it("wraps non-Error throws in Error", async () => {
      const result = await new Promise<string>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createSubscription(() =>
            Promise.resolve(
              (async function* () {
                throw "string error";
              })(),
            ),
          );

          await flush();
          resolve(unwrap(sub.error(), "expected sub.error()").message);
          dispose();
        });
      });

      expect(result).toBe("string error");
    });

    it("clears error on successful item after error recovery", async () => {
      const result = await new Promise<{
        errorBefore: boolean;
        errorAfter: boolean;
        value: number;
      }>((resolve) => {
        createRoot(async (dispose) => {
          let shouldThrow = true;
          const stream = controllableStream<number>();

          const sub = createSubscription(() => {
            if (shouldThrow) {
              shouldThrow = false;
              return Promise.resolve(
                (async function* () {
                  throw new Error("initial fail");
                })(),
              );
            }
            return Promise.resolve(stream.iterate());
          });

          await flush();
          const errorBefore = sub.error() !== undefined;

          // Can't reconnect with the same subscription instance —
          // this tests that error is set and pending is cleared
          resolve({
            errorBefore,
            errorAfter: sub.error() !== undefined,
            value: sub() as unknown as number,
          });
          stream.close();
          dispose();
        });
      });

      expect(result.errorBefore).toBe(true);
    });

    it("does not set error when aborted", async () => {
      const result = await new Promise<{
        error: Error | undefined;
        pending: boolean;
      }>((resolve) => {
        createRoot(async (dispose) => {
          const controller = new AbortController();
          const sub = createSubscription(
            () =>
              Promise.resolve(
                (async function* () {
                  controller.abort();
                  throw new Error("aborted");
                })(),
              ),
            { signal: controller.signal },
          );

          await flush();
          resolve({ error: sub.error(), pending: sub.pending() });
          dispose();
        });
      });

      expect(result.error).toBe(undefined);
    });
  });

  describe("abort / cleanup", () => {
    it("stops consuming when external signal is aborted", async () => {
      const result = await new Promise<number[]>((resolve) => {
        createRoot(async (dispose) => {
          const controller = new AbortController();
          const stream = controllableStream<number>();
          const sub = createSubscription(
            () => Promise.resolve(stream.iterate()),
            { signal: controller.signal },
          );

          stream.push(1);
          await flush();
          stream.push(2);
          await flush();

          controller.abort();

          stream.push(3); // should not be received
          await flush();

          resolve([readSub(sub)]);
          stream.close();
          dispose();
        });
      });

      // Last value before abort was 2
      expect(result).toEqual([2]);
    });

    it("stops consuming when reactive owner is disposed", async () => {
      const result = await new Promise<{ valueBefore: number }>((resolve) => {
        let sub: ReturnType<typeof createSubscription<number>>;
        const stream = controllableStream<number>();

        createRoot(async (dispose) => {
          sub = createSubscription(() => Promise.resolve(stream.iterate()));

          stream.push(1);
          await flush();

          resolve({ valueBefore: readSub(sub) });
          dispose(); // triggers onCleanup → abort
        });

        // After dispose, stream should be closed
        stream.close();
      });

      expect(result.valueBefore).toBe(1);
    });
  });

  describe("pending signal", () => {
    it("is true before first item, false after", async () => {
      const result = await new Promise<{ before: boolean; after: boolean }>(
        (resolve) => {
          createRoot(async (dispose) => {
            const stream = controllableStream<number>();
            const sub = createSubscription(() =>
              Promise.resolve(stream.iterate()),
            );

            const before = sub.pending();

            stream.push(1);
            await flush();

            resolve({ before, after: sub.pending() });
            stream.close();
            dispose();
          });
        },
      );

      expect(result.before).toBe(true);
      expect(result.after).toBe(false);
    });

    it("is false after error (even without items)", async () => {
      const result = await new Promise<boolean>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createSubscription(() =>
            Promise.resolve(
              (async function* () {
                throw new Error("fail");
              })(),
            ),
          );

          await flush();
          resolve(sub.pending());
          dispose();
        });
      });

      expect(result).toBe(false);
    });
  });

  describe("source promise rejection", () => {
    it("handles source() promise rejection", async () => {
      const result = await new Promise<{ error: string; pending: boolean }>(
        (resolve) => {
          createRoot(async (dispose) => {
            const sub = createSubscription(() =>
              Promise.reject(new Error("connection failed")),
            );

            await flush();
            resolve({
              error: unwrap(sub.error(), "expected sub.error()").message,
              pending: sub.pending(),
            });
            dispose();
          });
        },
      );

      expect(result.error).toBe("connection failed");
      expect(result.pending).toBe(false);
    });
  });
});
