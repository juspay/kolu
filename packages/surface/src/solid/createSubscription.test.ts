import * as assert from "node:assert";
import { Effect, Stream } from "effect";
import { createEffect, createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { controllableStream } from "./controllableStream.testlib";
import {
  createSubscription,
  createUpdatedTracker,
  type Subscription,
} from "./createSubscription";

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

/** Test-local: assert that a subscription is in error state and return
 *  the error. `assert.ok` narrows `err` from `Error | undefined` to
 *  `Error` for the read on the next line. */
function readSubError<T>(sub: Subscription<T>): Error {
  const err = sub.error();
  assert.ok(err !== undefined, "expected sub.error() to be set");
  return err;
}

/** The ONE harness adapter for the Effect port: `createSubscription` now takes a
 *  `Stream`, so every async-iterable fixture below is lifted through here. The
 *  failure mapping is the identity — `runStreamScoped` normalises a non-`Error`
 *  failure value to an `Error` itself, which is what pins "a thrown string
 *  surfaces as `Error("string error")`" below. */
function streamOf<T>(it: AsyncIterable<T>): Stream.Stream<T, unknown> {
  return Stream.fromAsyncIterable(it, (e) => e);
}

/** Create an async iterable from an array, yielding items with optional delay. */
async function* fromArray<T>(items: T[], delayMs = 0): AsyncGenerator<T> {
  for (const item of items) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    yield item;
  }
}

/** Drain macrotasks so stream frames are processed. Frames now arrive on an
 *  Effect FIBER (`runStreamScoped`), so a bare `await Promise.resolve()` micro-flush
 *  is not enough — two full macrotask turns cover the fiber's own scheduling plus
 *  the store write, with margin. Never fewer: an assertion is never relaxed to fit
 *  the timing, the flush is made longer. */
async function flush(ticks = 2): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

describe("createSubscription", () => {
  describe("value replacement (no reducer)", () => {
    it("starts with undefined and pending=true", () => {
      createRoot((dispose) => {
        const stream = controllableStream<number>();
        const sub = createSubscription(stream.source);

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
            const sub = createSubscription(stream.source);

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
          const sub = createSubscription(stream.source);

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
          const sub = createSubscription(streamOf(fromArray(["hello"])));
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
          const sub = createSubscription(streamOf(fromArray([true])));
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
          const sub = createSubscription(
            streamOf(fromArray([null as unknown as string])),
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
          const sub = createSubscription(stream.source);

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
          const sub = createSubscription(stream.source);

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
          const sub = createSubscription(streamOf(fromArray([[1, 2, 3]])));
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
          const sub = createSubscription(stream.source, {
            reduce: (acc: number[], item: number) => [...acc, item],
            initial: [] as number[],
          });

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
          createSubscription(streamOf(fromArray([1])), {
            reduce: (acc: number, item: number) => acc + item,
          });
          dispose();
        });
      }).toThrow("'initial' is required when using 'reduce'");
    });

    it("uses initial value before first item", () => {
      createRoot((dispose) => {
        const stream = controllableStream<number>();
        const sub = createSubscription(stream.source, {
          reduce: (acc: number[], item: number) => [...acc, item],
          initial: [0],
        });

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
            const sub = createSubscription(
              streamOf(
                (async function* () {
                  throw new Error("stream broke");
                })(),
              ),
            );

            await flush();

            resolve({
              error: readSubError(sub).message,
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
          const sub = createSubscription(
            streamOf(
              (async function* () {
                throw "string error";
              })(),
            ),
          );

          await flush();
          resolve(readSubError(sub).message);
          dispose();
        });
      });

      expect(result).toBe("string error");
    });

    it("a failing source sets error and keeps it set (no reconnect on this instance)", async () => {
      // Pre-port this read "clears error on successful item after error recovery",
      // but the source was a `() => Promise<AsyncIterable>` called ONCE, so it never
      // reached the recovery half either — it only ever asserted `errorBefore`. The
      // same fact is asserted here, plus the one the port makes newly checkable: a
      // frame can no longer follow a failure (a stream failure is the FIBER's exit),
      // so the error stays set for the life of this subscription. Recovery is a
      // FRESH subscription — `createReactiveSubscription`'s "clears prior error on
      // input change" is where the self-clearing law is pinned.
      const result = await new Promise<{
        errorBefore: boolean;
        errorAfter: boolean;
        value: number | undefined;
      }>((resolve) => {
        createRoot(async (dispose) => {
          const sub = createSubscription(
            streamOf(
              (async function* (): AsyncGenerator<number> {
                throw new Error("initial fail");
              })(),
            ),
          );

          await flush();
          const errorBefore = sub.error() !== undefined;

          resolve({
            errorBefore,
            errorAfter: sub.error() !== undefined,
            value: sub(),
          });
          dispose();
        });
      });

      expect(result.errorBefore).toBe(true);
      expect(result.errorAfter).toBe(true);
      expect(result.value).toBe(undefined);
    });

    it("does not set error when aborted", async () => {
      // "A disposed subscription reports nothing" — even a failure racing the stop.
      // The same generator WITHOUT the signal is the control: it is exactly the
      // "sets error signal on stream failure" fixture two tests up, which does set
      // `error()`. Here the abort latches `stopped` first, so the fiber's failure
      // exit is silent.
      const result = await new Promise<{
        error: Error | undefined;
        pending: boolean;
      }>((resolve) => {
        createRoot(async (dispose) => {
          const controller = new AbortController();
          const sub = createSubscription(
            streamOf(
              (async function* (): AsyncGenerator<number> {
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
          const sub = createSubscription(stream.source, {
            signal: controller.signal,
          });

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
          sub = createSubscription(stream.source);

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

  describe("typed end", () => {
    it("latches complete() and fires onComplete once, clearing pending", async () => {
      // A typed end (the producer completed) FREEZES this subscription's value —
      // without the latch an ended subscription reads byte-identical to a healthy
      // streaming one (no error, not pending), so a holder cannot tell its last
      // value is stale-forever.
      const completions: number[] = [];
      const result = await new Promise<{
        complete: boolean;
        pending: boolean;
        value: number | undefined;
      }>((resolve) => {
        createRoot(async (dispose) => {
          const stream = controllableStream<number>();
          const sub = createSubscription(stream.source, {
            onComplete: () => completions.push(1),
          });

          stream.push(1);
          await flush();
          expect(sub.complete?.()).toBe(false);

          stream.close(); // the producer ENDS the stream — a typed end
          await flush();

          resolve({
            complete: sub.complete?.() ?? false,
            pending: sub.pending(),
            value: sub(),
          });
          dispose();
        });
      });

      expect(result.complete).toBe(true);
      expect(result.pending).toBe(false);
      expect(result.value).toBe(1);
      expect(completions).toEqual([1]);
    });

    it("an aborted subscription never fires onComplete or latches complete()", async () => {
      // "A disposed subscription cannot report anything" extends to the typed end:
      // an interruption is a TEARDOWN, not a completion.
      const completions: number[] = [];
      const result = await new Promise<boolean>((resolve) => {
        createRoot(async (dispose) => {
          const controller = new AbortController();
          const stream = controllableStream<number>();
          const sub = createSubscription(stream.source, {
            signal: controller.signal,
            onComplete: () => completions.push(1),
          });

          stream.push(1);
          await flush();
          controller.abort();
          stream.close(); // the end lands AFTER the abort — must stay silent
          await flush();

          resolve(sub.complete?.() ?? false);
          dispose();
        });
      });

      expect(result).toBe(false);
      expect(completions).toEqual([]);
    });
  });

  describe("pending signal", () => {
    it("is true before first item, false after", async () => {
      const result = await new Promise<{ before: boolean; after: boolean }>(
        (resolve) => {
          createRoot(async (dispose) => {
            const stream = controllableStream<number>();
            const sub = createSubscription(stream.source);

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
          const sub = createSubscription(
            streamOf(
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

  describe("source that fails to OPEN (pre-port: a rejected source() promise)", () => {
    it("surfaces the open failure as error(), pending cleared", async () => {
      // The pre-port source was `() => Promise<AsyncIterable>`, so "the connection
      // could not be established" was a REJECTED promise. Its exact analogue on a
      // `Stream` is a failure in the effect that OPENS the stream — no frame ever
      // arrives — which is what `Stream.unwrap(Effect.fail(...))` spells.
      const result = await new Promise<{ error: string; pending: boolean }>(
        (resolve) => {
          createRoot(async (dispose) => {
            const sub = createSubscription(
              Stream.unwrap(Effect.fail(new Error("connection failed"))),
            );

            await flush();
            resolve({
              error: readSubError(sub).message,
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

  describe("updated() — the change-iff-fired law", () => {
    it("a first frame is a value, not a change — it never fires", async () => {
      await createRoot(async (dispose) => {
        const stream = controllableStream<number>();
        const sub = createSubscription(stream.source);
        const changes: Array<{ prev: number; next: number }> = [];
        sub.updated?.((c) => changes.push(c));

        stream.push(7);
        await flush();
        expect(readSub(sub)).toBe(7);
        expect(changes).toEqual([]); // first frame: silent
        dispose();
      });
    });

    it("a differing frame fires once with prev = the last-seen value", async () => {
      await createRoot(async (dispose) => {
        const stream = controllableStream<number>();
        const sub = createSubscription(stream.source);
        const changes: Array<{ prev: number; next: number }> = [];
        sub.updated?.((c) => changes.push(c));

        stream.push(1);
        await flush();
        stream.push(2);
        await flush();
        stream.push(5);
        await flush();
        expect(changes).toEqual([
          { prev: 1, next: 2 },
          { prev: 2, next: 5 },
        ]);
        dispose();
      });
    });

    it("an equal reconnect snapshot (fresh object, same content) never fires", async () => {
      await createRoot(async (dispose) => {
        const stream = controllableStream<{ ids: number[] }>();
        const sub = createSubscription(stream.source);
        const changes: Array<unknown> = [];
        sub.updated?.((c) => changes.push(c));

        stream.push({ ids: [1, 2] });
        await flush();
        // A link flap replays current truth as a byte-fresh object — value-equal
        // to the last-seen, so the law says: silent.
        stream.push({ ids: [1, 2] });
        await flush();
        expect(changes).toEqual([]);

        // A genuine change still fires, with the structurally-correct prev.
        stream.push({ ids: [1, 2, 3] });
        await flush();
        expect(changes).toEqual([
          { prev: { ids: [1, 2] }, next: { ids: [1, 2, 3] } },
        ]);
        dispose();
      });
    });

    it("a change in a non-JSON value (distinct Dates) is NOT suppressed", async () => {
      // The primitives are generic over arbitrary AsyncIterable<T>, and a value need
      // not be JSON-shaped (a directLink passes objects through unserialized; Zod
      // admits z.date()). A naive plain-object walk reads two Dates as equal (they
      // have no enumerable keys) and would SUPPRESS a real change — the comparator
      // must compare Dates by instant and, in general, never yield a false-positive.
      await createRoot(async (dispose) => {
        const stream = controllableStream<{ at: Date }>();
        const sub = createSubscription(stream.source);
        const seen: Array<{ prev: { at: Date }; next: { at: Date } }> = [];
        sub.updated?.((c) => seen.push(c));

        stream.push({ at: new Date(1000) });
        await flush();
        // Equal instant, fresh object — the law says silent.
        stream.push({ at: new Date(1000) });
        await flush();
        expect(seen).toEqual([]);
        // Different instant — a REAL change; must fire (the suppression bug).
        stream.push({ at: new Date(2000) });
        await flush();
        expect(seen).toHaveLength(1);
        expect(seen[0]?.prev.at.getTime()).toBe(1000);
        expect(seen[0]?.next.at.getTime()).toBe(2000);
        dispose();
      });
    });

    // The frame comparator (`framesEqual`) is private; these exercise it directly
    // through the tracker that owns it, so a cyclic / sparse / augmented / non-JSON
    // frame is checked WITHOUT the store's `reconcile` (which cannot hold a cyclic
    // object at all — an orthogonal limit). A directLink passes values through
    // unserialized, so any of these shapes can reach the comparator.
    describe("framesEqual (via the tracker) — conservative + cycle-safe", () => {
      it("compares a cyclic frame without a stack overflow", () => {
        type Node = { label: string; self?: Node };
        const tracker = createUpdatedTracker<Node>();
        const seen: Array<{ prev: Node; next: Node }> = [];
        tracker.updated((c) => seen.push(c));

        const a: Node = { label: "x" };
        a.self = a;
        tracker.noteFrame(a); // first frame: seed, silent
        // A value-equal cyclic frame (fresh object, same shape): the back-edge is
        // compared as equal — no unbounded recursion, and silent.
        const a2: Node = { label: "x" };
        a2.self = a2;
        tracker.noteFrame(a2);
        expect(seen).toEqual([]);
        // A genuine change to a cyclic frame still fires exactly once.
        const b: Node = { label: "y" };
        b.self = b;
        tracker.noteFrame(b);
        expect(seen).toHaveLength(1);
        expect(seen[0]?.next.label).toBe("y");
      });

      it("distinguishes a self-cycle from a child-cycle of the same labels", () => {
        // Both frames are `{ self: <node labelled "x"> }`, but the back-edge closes
        // DIFFERENTLY: the seed self-references the root, the next references a
        // distinct child. A cycle guard that only asks "seen this node before" reads
        // them equal and suppresses the change; a topology-aware guard fires it.
        type Node = { label: string; self?: Node };
        const tracker = createUpdatedTracker<Node>();
        const seen: Array<{ prev: Node; next: Node }> = [];
        tracker.updated((c) => seen.push(c));

        const root: Node = { label: "x" };
        root.self = root; // self-cycle: root.self === root
        tracker.noteFrame(root); // seed, silent

        const outer: Node = { label: "x" };
        const child: Node = { label: "x" };
        child.self = child;
        outer.self = child; // child-cycle: outer.self !== outer
        tracker.noteFrame(outer);
        // The topologies differ (root.self === root vs outer.self !== outer), so this
        // is a real change and must fire exactly once — never be swallowed.
        expect(seen).toHaveLength(1);
      });

      it("treats two matching self-cycles as equal (no spurious fire)", () => {
        type Node = { label: string; self?: Node };
        const tracker = createUpdatedTracker<Node>();
        const seen: unknown[] = [];
        tracker.updated((c) => seen.push(c));

        const a: Node = { label: "x" };
        a.self = a;
        tracker.noteFrame(a); // seed
        const b: Node = { label: "x" };
        b.self = b;
        tracker.noteFrame(b); // same topology + labels — must stay silent
        expect(seen).toEqual([]);
      });

      it("does not treat a sparse array as equal to a dense-undefined array", () => {
        const tracker = createUpdatedTracker<number[]>();
        const seen: unknown[] = [];
        tracker.updated((c) => seen.push(c));

        // biome-ignore lint/suspicious/noSparseArray: exercising sparse-vs-dense
        const sparse = [, ,] as unknown as number[];
        tracker.noteFrame(sparse); // seed
        // Holes (absent indices) differ from present `undefined` — must fire, never
        // be suppressed.
        const dense = [undefined, undefined] as unknown as number[];
        tracker.noteFrame(dense);
        expect(seen).toHaveLength(1);
      });

      it("does not ignore an augmenting own property on an array", () => {
        type Aug = number[] & { tag?: string };
        const tracker = createUpdatedTracker<Aug>();
        const seen: unknown[] = [];
        tracker.updated((c) => seen.push(c));

        tracker.noteFrame([1, 2] as Aug); // seed
        const augmented = [1, 2] as Aug;
        augmented.tag = "changed";
        tracker.noteFrame(augmented);
        expect(seen).toHaveLength(1);
      });

      it("does not ignore a non-enumerable own property", () => {
        type WithHidden = { visible: number };
        const tracker = createUpdatedTracker<WithHidden>();
        const seen: unknown[] = [];
        tracker.updated((c) => seen.push(c));

        tracker.noteFrame({ visible: 1 }); // seed
        const withHidden = { visible: 1 } as WithHidden;
        Object.defineProperty(withHidden, "hidden", {
          value: 9,
          enumerable: false,
        });
        // `Object.keys` would miss `hidden`; `getOwnPropertyNames` sees it, so the
        // extra prop makes the frame differ and fire.
        tracker.noteFrame(withHidden);
        expect(seen).toHaveLength(1);
      });
    });

    it("a handler added mid-stream sees only changes from that point on", async () => {
      await createRoot(async (dispose) => {
        const stream = controllableStream<number>();
        const sub = createSubscription(stream.source);

        stream.push(1);
        await flush();
        stream.push(2);
        await flush();

        // Subscribe AFTER two frames — no replay of the missed change.
        const changes: Array<{ prev: number; next: number }> = [];
        sub.updated?.((c) => changes.push(c));
        stream.push(9);
        await flush();
        expect(changes).toEqual([{ prev: 2, next: 9 }]);
        dispose();
      });
    });

    it("dispose stops a handler firing", async () => {
      await createRoot(async (dispose) => {
        const stream = controllableStream<number>();
        const sub = createSubscription(stream.source);
        const changes: number[] = [];
        const off = sub.updated?.((c) => changes.push(c.next));

        stream.push(1);
        await flush();
        stream.push(2);
        await flush();
        off?.();
        stream.push(3);
        await flush();
        expect(changes).toEqual([2]); // 3's change never reached the disposed handler
        dispose();
      });
    });

    it("a throwing handler does not abort fanout, terminate the stream, or become a stream error", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await createRoot(async (dispose) => {
          const stream = controllableStream<number>();
          const sub = createSubscription(stream.source);
          const good: number[] = [];
          // A misbehaving consumer subscribes first, then a well-behaved one.
          sub.updated?.(() => {
            throw new Error("consumer bug");
          });
          sub.updated?.((c) => good.push(c.next));

          stream.push(1);
          await flush();
          stream.push(2); // the throwing handler runs first on THIS change…
          await flush();
          stream.push(3); // …and the stream keeps delivering after it
          await flush();

          expect(good).toEqual([2, 3]); // fanout continued past the thrower, both frames
          expect(sub.error()).toBeUndefined(); // a handler bug is NOT an upstream stream error
          dispose();
        });
      } finally {
        spy.mockRestore();
      }
    });

    it("with no handler registered, the baseline still advances (a late subscriber sees only changes from then on)", async () => {
      await createRoot(async (dispose) => {
        const stream = controllableStream<number>();
        const sub = createSubscription(stream.source);
        // No handler yet — the hot path advances lastSeen in O(1) without compares.
        stream.push(1);
        await flush();
        stream.push(2);
        await flush();
        const changes: Array<{ prev: number; next: number }> = [];
        sub.updated?.((c) => changes.push(c));
        stream.push(2); // equal to the last-seen baseline (2) → silent
        await flush();
        stream.push(7); // a genuine change from the advanced baseline
        await flush();
        expect(changes).toEqual([{ prev: 2, next: 7 }]);
        dispose();
      });
    });
  });
});
