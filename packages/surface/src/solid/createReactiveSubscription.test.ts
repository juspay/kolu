import * as assert from "node:assert";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createReactiveSubscription } from "./createReactiveSubscription";
import type { Subscription } from "./createSubscription";

function readSub<T>(sub: Subscription<T>): T {
  const value = sub();
  if (value === undefined) {
    throw new Error("subscription has not yielded a value yet");
  }
  return value;
}

function readSubError<T>(sub: Subscription<T>): Error {
  const err = sub.error();
  assert.ok(err !== undefined, "expected sub.error() to be set");
  return err;
}

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

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

/** Drain several macrotasks. `createReactiveSubscription` wraps the iife in
 *  a `createEffect`, whose initial run is deferred. One tick covers signal
 *  propagation, one for factory resolution, one for the async iterator's
 *  first `next()`, one for store update — four is comfortable. */
async function flush(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

describe("createReactiveSubscription", () => {
  describe("initial state", () => {
    it("input=null: undefined value, pending=true, factory not called", async () => {
      let calls = 0;
      const result = await new Promise<{ v: undefined; p: boolean }>(
        (resolve) => {
          createRoot(async (dispose) => {
            const sub = createReactiveSubscription<string, number>(
              () => null,
              () => {
                calls += 1;
                return Promise.resolve(fromArray([1]));
              },
            );
            await flush();
            resolve({ v: sub() as undefined, p: sub.pending() });
            dispose();
          });
        },
      );

      expect(result.v).toBe(undefined);
      expect(result.p).toBe(true);
      expect(calls).toBe(0);
    });

    it("non-null input: yields land in store, pending clears", async () => {
      const result = await new Promise<{ v: number; p: boolean }>((resolve) => {
        createRoot(async (dispose) => {
          const stream = controllableStream<number>();
          const sub = createReactiveSubscription<string, number>(
            () => "A",
            () => Promise.resolve(stream.iterate()),
          );
          stream.push(42);
          await flush();
          resolve({ v: readSub(sub), p: sub.pending() });
          stream.close();
          dispose();
        });
      });

      expect(result.v).toBe(42);
      expect(result.p).toBe(false);
    });

    it("factory receives the current input", async () => {
      const seen: string[] = [];
      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          createReactiveSubscription<string, number>(
            () => "input-A",
            (input) => {
              seen.push(input);
              return Promise.resolve(fromArray([1]));
            },
          );
          await flush();
          resolve();
          dispose();
        });
      });

      expect(seen).toEqual(["input-A"]);
    });
  });

  describe("resubscribe on input change", () => {
    it("invokes factory again with new input", async () => {
      const inputs: string[] = [];
      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          const [input, setInput] = createSignal<string>("A");
          createReactiveSubscription<string, number>(input, (i) => {
            inputs.push(i);
            return Promise.resolve(fromArray([1]));
          });
          await flush();
          setInput("B");
          await flush();
          resolve();
          dispose();
        });
      });

      expect(inputs).toEqual(["A", "B"]);
    });

    it("resets value to undefined on input change until next yield", async () => {
      const result = await new Promise<{
        before: number;
        afterChange: number | undefined;
        afterYield: number;
      }>((resolve) => {
        createRoot(async (dispose) => {
          const [input, setInput] = createSignal<string>("A");
          const streams = new Map<
            string,
            ReturnType<typeof controllableStream<number>>
          >();
          const sub = createReactiveSubscription<string, number>(input, (i) => {
            const s = controllableStream<number>();
            streams.set(i, s);
            return Promise.resolve(s.iterate());
          });

          await flush();
          streams.get("A")?.push(1);
          await flush();
          const before = readSub(sub);

          setInput("B");
          await flush();
          const afterChange = sub();

          streams.get("B")?.push(2);
          await flush();
          const afterYield = readSub(sub);

          resolve({ before, afterChange, afterYield });
          for (const s of streams.values()) s.close();
          dispose();
        });
      });

      expect(result.before).toBe(1);
      expect(result.afterChange).toBe(undefined);
      expect(result.afterYield).toBe(2);
    });

    it("pending returns to true between input change and next yield", async () => {
      const result = await new Promise<{ mid: boolean; after: boolean }>(
        (resolve) => {
          createRoot(async (dispose) => {
            const [input, setInput] = createSignal<string>("A");
            const streams = new Map<
              string,
              ReturnType<typeof controllableStream<number>>
            >();
            const sub = createReactiveSubscription<string, number>(
              input,
              (i) => {
                const s = controllableStream<number>();
                streams.set(i, s);
                return Promise.resolve(s.iterate());
              },
            );

            await flush();
            streams.get("A")?.push(1);
            await flush();
            // pending=false now

            setInput("B");
            await flush();
            const mid = sub.pending();

            streams.get("B")?.push(2);
            await flush();
            const after = sub.pending();

            resolve({ mid, after });
            for (const s of streams.values()) s.close();
            dispose();
          });
        },
      );

      expect(result.mid).toBe(true);
      expect(result.after).toBe(false);
    });

    it("late items from prior iterator do not contaminate new subscription", async () => {
      const result = await new Promise<number | undefined>((resolve) => {
        createRoot(async (dispose) => {
          const [input, setInput] = createSignal<string>("A");
          const streams = new Map<
            string,
            ReturnType<typeof controllableStream<number>>
          >();
          const sub = createReactiveSubscription<string, number>(input, (i) => {
            const s = controllableStream<number>();
            streams.set(i, s);
            return Promise.resolve(s.iterate());
          });

          await flush();
          // No items yielded for A yet — its iife is parked on iterable.next().
          setInput("B");
          await flush();

          // Push to A's old stream after the abort. The aborted iife wakes,
          // checks signal.aborted, and breaks before setStore.
          streams.get("A")?.push(99);
          await flush();

          // Push to B's new stream — should land.
          streams.get("B")?.push(2);
          await flush();

          resolve(sub());
          for (const s of streams.values()) s.close();
          dispose();
        });
      });

      expect(result).toBe(2);
    });

    it("clears prior error on input change", async () => {
      const result = await new Promise<{ before: boolean; after: boolean }>(
        (resolve) => {
          createRoot(async (dispose) => {
            const [input, setInput] = createSignal<string>("A");
            const sub = createReactiveSubscription<string, number>(
              input,
              (i) => {
                if (i === "A") return Promise.reject(new Error("A failed"));
                return Promise.resolve(fromArray([1]));
              },
            );
            await flush();
            const before = sub.error() !== undefined;

            setInput("B");
            await flush();
            const after = sub.error() !== undefined;

            resolve({ before, after });
            dispose();
          });
        },
      );

      expect(result.before).toBe(true);
      expect(result.after).toBe(false);
    });
  });

  describe("input → null", () => {
    it("input flips to null: value resets, factory not re-called", async () => {
      let calls = 0;
      const result = await new Promise<{
        before: number;
        afterNull: number | undefined;
      }>((resolve) => {
        createRoot(async (dispose) => {
          const [input, setInput] = createSignal<string | null>("A");
          const stream = controllableStream<number>();
          const sub = createReactiveSubscription<string, number>(input, () => {
            calls += 1;
            return Promise.resolve(stream.iterate());
          });
          stream.push(1);
          await flush();
          const before = readSub(sub);

          setInput(null);
          await flush();
          const afterNull = sub();

          resolve({ before, afterNull });
          stream.close();
          dispose();
        });
      });

      expect(result.before).toBe(1);
      expect(result.afterNull).toBe(undefined);
      expect(calls).toBe(1);
    });
  });

  describe("error handling", () => {
    it("sets error on factory promise rejection", async () => {
      const result = await new Promise<string>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createReactiveSubscription<string, number>(
            () => "A",
            () => Promise.reject(new Error("boom")),
          );
          await flush();
          resolve(readSubError(sub).message);
          dispose();
        });
      });
      expect(result).toBe("boom");
    });

    it("sets error on stream throw", async () => {
      const result = await new Promise<string>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createReactiveSubscription<string, number>(
            () => "A",
            () =>
              Promise.resolve(
                (async function* () {
                  throw new Error("stream broke");
                })(),
              ),
          );
          await flush();
          resolve(readSubError(sub).message);
          dispose();
        });
      });
      expect(result).toBe("stream broke");
    });

    it("calls onError with wrapped Error for non-Error throws", async () => {
      const seen: string[] = [];
      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          createReactiveSubscription<string, number>(
            () => "A",
            () => Promise.reject("string-error"),
            { onError: (e) => seen.push(e.message) },
          );
          await flush();
          resolve();
          dispose();
        });
      });
      expect(seen).toEqual(["string-error"]);
    });

    it("does not call onError when subscription is aborted by input change", async () => {
      const seen: string[] = [];
      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          const [input, setInput] = createSignal<string>("A");
          createReactiveSubscription<string, number>(
            input,
            (i, signal) =>
              i === "A"
                ? new Promise<AsyncIterable<number>>((_, reject) => {
                    signal.addEventListener("abort", () =>
                      reject(new Error("aborted")),
                    );
                  })
                : Promise.resolve(fromArray<number>([1])),
            { onError: (e) => seen.push(e.message) },
          );
          await flush();
          setInput("B");
          await flush();
          resolve();
          dispose();
        });
      });
      expect(seen).toEqual([]);
    });
  });

  describe("cleanup", () => {
    it("aborts the in-flight subscription when reactive owner is disposed", async () => {
      let aborted = false;
      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          createReactiveSubscription<string, number>(
            () => "A",
            (_, signal) => {
              signal.addEventListener("abort", () => {
                aborted = true;
              });
              return Promise.resolve(fromArray<number>([]));
            },
          );
          await flush();
          dispose();
          resolve();
        });
      });
      expect(aborted).toBe(true);
    });
  });

  describe("object values", () => {
    it("yields object values via reconcile branch", async () => {
      const result = await new Promise<{ a: number; b: number }>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createReactiveSubscription<
            string,
            { a: number; b: number }
          >(
            () => "A",
            () => Promise.resolve(fromArray([{ a: 1, b: 2 }])),
          );
          await flush();
          resolve(readSub(sub));
          dispose();
        });
      });
      expect(result).toEqual({ a: 1, b: 2 });
    });
  });
});
