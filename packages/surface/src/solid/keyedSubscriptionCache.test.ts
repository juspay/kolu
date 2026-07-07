/**
 * The base-client subscription DEDUP cache (`createKeyedSubscriptionCache`), pinned
 * through the real `surfaceClient` seam (not the cache in isolation) — because the
 * contract that matters is observable end-to-end: N views of one `(proc, static-input)`
 * fold to ONE upstream subscription, enrolled ONCE, torn down when the last leaves.
 *
 * THE required pin (coordinator-mandated): `health()` counts a shared slot ONCE with
 * N consumers attached, and un-enrols on the last-listener disposal. Reverting the
 * enrol-once (enrolling per consumer) or the ref-counted teardown fails it.
 */

import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "../define";

// The cache is wired inside `buildSurfaceClient`; a plain in-process link (no wire,
// no half-open) is accepted bare, so we drive the real client with a stub link.
import { surfaceClient } from "./surfaceClient";

/** A get-only cell (read-only server-authority path → deduped). */
const cellSurface = defineSurface({
  cells: {
    conn: {
      schema: z.object({ state: z.string() }),
      default: { state: "connecting" },
      verbs: ["get"],
    },
  },
});

/** A mutable cell usable under local authority (has a `set` verb). */
const prefsSurface = defineSurface({
  cells: {
    prefs: {
      schema: z.object({ n: z.number() }),
      default: { n: 0 },
      verbs: ["get", "set"],
    },
  },
});

/** A stream — accessor-input, per-consumer, NOT deduped. */
const streamSurface = defineSurface({
  streams: {
    activity: { inputSchema: z.object({}), outputSchema: z.array(z.string()) },
  },
});

/** A wire stream that yields `value` once then COMPLETES (typed end). */
function once<T>(value: T) {
  return (..._args: unknown[]): Promise<AsyncIterable<T>> =>
    Promise.resolve(
      (async function* () {
        yield value;
      })(),
    );
}

/** A wire stream that stays OPEN (never yields, never completes) until aborted —
 *  for the abort-suppression pin. */
function pendingForever<T>() {
  return (..._args: unknown[]): Promise<AsyncIterable<T>> =>
    Promise.resolve({
      [Symbol.asyncIterator]() {
        return { next: () => new Promise<IteratorResult<T>>(() => {}) };
      },
    });
}

/** Flush microtasks (the `queueMicrotask` teardown) + macrotasks (async stream
 *  consumption) — matches the package's other subscription tests. */
const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

const connCount = (app: {
  health: () => { subs: readonly { name: string }[] };
}): number => app.health().subs.filter((s) => s.name === "conn").length;

describe("keyed subscription cache — dedup + lifetime", () => {
  it("THE PIN: health() counts a shared slot ONCE with N consumers, un-enrols on last-listener disposal", async () => {
    const link = { surface: { conn: { get: once({ state: "connected" }) } } };
    await createRoot(async (outer) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed client.
      const app = surfaceClient(cellSurface, link as any);
      // Three consumers, each under its OWN reactive owner (three components).
      const disposers: Array<() => void> = [];
      for (let i = 0; i < 3; i++) {
        createRoot((d) => {
          app.cells.conn.use();
          disposers.push(d);
        });
      }
      await settle();
      // ONE "conn" in health() — not three. Enrol-once inside the shared slot.
      expect(connCount(app)).toBe(1);

      // Dispose all three consumers → the last listener leaves → the shared slot's
      // root disposes (in a microtask) → the enrolment drops.
      for (const d of disposers) d();
      await settle();
      expect(connCount(app)).toBe(0);
      outer();
    });
  });

  it("two views of one cell share ONE upstream subscription (source called once)", async () => {
    let calls = 0;
    const src = (
      ..._a: unknown[]
    ): Promise<AsyncIterable<{ state: string }>> => {
      calls++;
      return once({ state: "connected" })();
    };
    const link = { surface: { conn: { get: src } } };
    await createRoot(async (outer) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link.
      const app = surfaceClient(cellSurface, link as any);
      app.cells.conn.use();
      app.cells.conn.use();
      await settle();
      expect(calls).toBe(1);
      outer();
    });
  });

  it("a TYPED completion evicts the slot — a later view re-subscribes (source called again)", async () => {
    let calls = 0;
    const src = (
      ..._a: unknown[]
    ): Promise<AsyncIterable<{ state: string }>> => {
      calls++;
      return once({ state: "connected" })(); // yields once then COMPLETES
    };
    const link = { surface: { conn: { get: src } } };
    await createRoot(async (outer) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link.
      const app = surfaceClient(cellSurface, link as any);
      app.cells.conn.use();
      await settle(); // the stream yields + completes → onComplete → slot evicted
      expect(calls).toBe(1);
      // The slot was evicted on the typed end, so a fresh view rebuilds it.
      app.cells.conn.use();
      await settle();
      expect(calls).toBe(2);
      outer();
    });
  });

  it("disposing a consumer (abort) sets no error and fires no onError — abort-suppression through the cache", async () => {
    const link = {
      surface: { conn: { get: pendingForever<{ state: string }>() } },
    };
    let errored = false;
    await createRoot(async (outer) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link.
      const app = surfaceClient(cellSurface, link as any);
      createRoot((d) => {
        app.cells.conn.use({ onError: () => (errored = true) });
        d(); // dispose immediately — the last (only) listener leaves → slot aborts
      });
      await settle();
      // A deliberate teardown is not an error: no toast, and the shared sub never
      // reports (an aborted subscription reports nothing). This is the switch-toast
      // pin at the cache layer.
      expect(errored).toBe(false);
      outer();
    });
  });

  it("two consumers of a LOCAL-authority cell share ONE store — a .set from one is seen by the other", async () => {
    let serverWrites = 0;
    const link = {
      surface: {
        prefs: {
          get: once({ n: 0 }),
          set: async () => {
            serverWrites++;
          },
        },
      },
    };
    await createRoot(async (outer) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link.
      const app = surfaceClient(prefsSurface, link as any);
      const a = app.cells.prefs.use({ authority: "local", initial: { n: 0 } });
      const b = app.cells.prefs.use({ authority: "local", initial: { n: 0 } });
      await settle();
      await a.set({ n: 42 });
      // Shared store: the write through `a` is visible through `b` (this is what
      // replaces the module-const `createSharedRoot` singleton).
      expect(b.value()).toEqual({ n: 42 });
      expect(serverWrites).toBe(1);
      outer();
    });
  });

  it("streams (ACCESSOR-input) are NOT deduped — two consumers open two subscriptions", async () => {
    let calls = 0;
    const src = (..._a: unknown[]): Promise<AsyncIterable<string[]>> => {
      calls++;
      return once<string[]>([])();
    };
    const link = { surface: { activity: { get: src } } };
    await createRoot(async (outer) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link.
      const app = surfaceClient(streamSurface, link as any);
      app.streams.activity.use(() => ({}));
      app.streams.activity.use(() => ({}));
      await settle();
      // Two input accessors are honestly two subscriptions — the cache leaves the
      // reactive-input path untouched.
      expect(calls).toBe(2);
      outer();
    });
  });
});
