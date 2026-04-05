/**
 * Integration tests: toAsyncIterable (server) → createSubscription (client)
 *
 * Tests the full signal→stream→signal pipeline without any transport layer.
 */

import { describe, it, expect } from "vitest";
import { createSignal, createMemo, flush } from "@solidjs/signals";
import { createRoot } from "solid-js";
import { toAsyncIterable } from "./server.ts";
import { createSubscription } from "./solid.ts";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("toAsyncIterable → createSubscription", () => {
  it("server signal change arrives as client signal update", async () => {
    const [count, setCount] = createSignal(0);

    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const sub = createSubscription(() =>
          Promise.resolve(toAsyncIterable(() => count())()),
        );

        await tick();
        expect(sub()).toBe(0);
        expect(sub.pending()).toBe(false);

        setCount(1);
        flush();
        await tick();
        expect(sub()).toBe(1);

        setCount(42);
        flush();
        await tick();
        expect(sub()).toBe(42);

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("derived server signal (createMemo) propagates", async () => {
    const [x, setX] = createSignal(2);
    const [y, setY] = createSignal(3);
    const product = createMemo(() => x() * y());

    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const sub = createSubscription(() =>
          Promise.resolve(toAsyncIterable(() => product())()),
        );

        await tick();
        expect(sub()).toBe(6);

        setX(10);
        flush();
        await tick();
        expect(sub()).toBe(30);

        setY(5);
        flush();
        await tick();
        expect(sub()).toBe(50);

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("object state with fine-grained fields", async () => {
    const [name, setName] = createSignal("alpha");
    const [count, setCount] = createSignal(0);
    const meta = createMemo(() => ({ name: name(), count: count() }));

    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const sub = createSubscription(() =>
          Promise.resolve(toAsyncIterable(() => meta())()),
        );

        await tick();
        expect(sub()).toEqual({ name: "alpha", count: 0 });

        setCount(5);
        flush();
        await tick();
        expect(sub()).toEqual({ name: "alpha", count: 5 });

        setName("bravo");
        flush();
        await tick();
        expect(sub()).toEqual({ name: "bravo", count: 5 });

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("client accumulates server events with reduce", async () => {
    const [count, setCount] = createSignal(0);

    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const sub = createSubscription(
          () => Promise.resolve(toAsyncIterable(() => count())()),
          {
            reduce: (acc: number[], item: number) => [...acc, item].slice(-3),
            initial: [] as number[],
          },
        );

        await tick();
        expect(sub()).toEqual([0]); // snapshot

        setCount(1);
        flush();
        await tick();
        expect(sub()).toEqual([0, 1]);

        setCount(2);
        flush();
        await tick();
        expect(sub()).toEqual([0, 1, 2]);

        setCount(3);
        flush();
        await tick();
        expect(sub()).toEqual([1, 2, 3]); // oldest dropped

        resolveDispose(dispose);
      });
    });
    dispose();
  });

  it("abort stops the pipeline", async () => {
    const [count, setCount] = createSignal(0);
    const controller = new AbortController();

    const dispose = await new Promise<() => void>((resolveDispose) => {
      createRoot(async (dispose) => {
        const sub = createSubscription(() =>
          Promise.resolve(toAsyncIterable(() => count())(controller.signal)),
        );

        await tick();
        expect(sub()).toBe(0);

        setCount(1);
        flush();
        await tick();
        expect(sub()).toBe(1);

        // Abort the server-side stream
        controller.abort();

        setCount(2);
        flush();
        await tick();
        // Value should NOT update — stream is aborted
        expect(sub()).toBe(1);

        resolveDispose(dispose);
      });
    });
    dispose();
  });
});
