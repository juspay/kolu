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
import { stableOptsKey } from "./keyedSubscriptionCache";
import { surfaceClient } from "./surfaceClient";

describe("stableOptsKey — divergent options are distinct keys; non-plain-JSON throws", () => {
  it("distinguishes divergent plain-JSON option values, folds identical ones", () => {
    // Divergent → distinct keys (so two .use() get two slots, not one silent share).
    expect(stableOptsKey({ authority: "local", initial: { n: 1 } })).not.toBe(
      stableOptsKey({ authority: "local", initial: { n: 2 } }),
    );
    // Identical (any key order) → the SAME key (dedup preserved for a genuine share).
    expect(stableOptsKey({ authority: "server", coalesceMs: 50 })).toBe(
      stableOptsKey({ coalesceMs: 50, authority: "server" }),
    );
    // …and NESTED object keys too (the recursive canonical sort): `initial`'s inner keys
    // reordered must still fold to ONE slot, else two identical-config sites over-split.
    expect(stableOptsKey({ initial: { a: 1, b: 2 } })).toBe(
      stableOptsKey({ initial: { b: 2, a: 1 } }),
    );
  });

  it("THROWS on a non-plain-JSON option value (Set/Map/undefined-bearing) — the collision is unrepresentable", () => {
    // Set/Map both JSON.stringify to "{}" regardless of contents → would silently share.
    expect(() =>
      stableOptsKey({ authority: "local", initial: new Set(["a"]) }),
    ).toThrow(/non-plain-JSON|Set\/Map/);
    expect(() => stableOptsKey({ initial: new Map([["k", 1]]) })).toThrow(
      /non-plain-JSON|Set\/Map/,
    );
    // A nested `undefined` value is dropped by JSON.stringify → `{a:1,b:undefined}`
    // collides with `{a:1}` → also rejected.
    expect(() => stableOptsKey({ initial: { a: 1, b: undefined } })).toThrow(
      /non-plain-JSON/,
    );
    // A plain-JSON initial is fine (the live case — preferences with a plain default).
    expect(() =>
      stableOptsKey({ authority: "local", initial: { a: 1, list: ["x"] } }),
    ).not.toThrow();
  });

  it("THROWS on a non-finite / -0 number option value (JSON.stringify collapses them)", () => {
    // NaN/±Infinity all JSON.stringify to "null", and -0 to "0" — so two divergent
    // numeric sentinels (a NaN "disabled" vs an Infinity "never") would silently share
    // one slot. The number-typeof branch used to admit all of these; now they throw.
    expect(() => stableOptsKey({ initial: { threshold: Number.NaN } })).toThrow(
      /non-injective|NaN|Infinity|-0/,
    );
    expect(() =>
      stableOptsKey({ initial: { threshold: Number.POSITIVE_INFINITY } }),
    ).toThrow(/non-injective|NaN|Infinity|-0/);
    expect(() =>
      stableOptsKey({ initial: { threshold: Number.NEGATIVE_INFINITY } }),
    ).toThrow(/non-injective|NaN|Infinity|-0/);
    expect(() => stableOptsKey({ coalesceMs: -0 })).toThrow(
      /non-injective|NaN|Infinity|-0/,
    );
    // A finite, non-(-0) number keys fine, and two identical ones still fold to one.
    expect(() => stableOptsKey({ initial: { threshold: 5 } })).not.toThrow();
    expect(stableOptsKey({ initial: { threshold: 5 } })).toBe(
      stableOptsKey({ initial: { threshold: 5 } }),
    );
  });

  it("THROWS on a SPARSE-array hole (JSON.stringify fills it to null, colliding with an explicit null)", () => {
    // `.every` spec-SKIPS holes, so the array branch used to admit `[1,,3]` while its
    // stringify "[1,null,3]" collides with the DISTINCT dense `[1,null,3]` — a silent share.
    // A hole is a dropped-undefined, so reject it like the explicit `[1,undefined,3]`.
    // biome-ignore lint/suspicious/noSparseArray: the hole is the exact input under test
    expect(() => stableOptsKey({ initial: [1, , 3] })).toThrow(
      /non-injective|sparse|undefined|hole/,
    );
    const holed = [1, 2, 3];
    delete holed[1]; // a hole from an ordinary op, not just the literal
    expect(() => stableOptsKey({ initial: holed })).toThrow(
      /non-injective|sparse|undefined|hole/,
    );
    // A DENSE array still keys fine, and two identical dense sites still fold to one.
    expect(() => stableOptsKey({ initial: [1, null, 3] })).not.toThrow();
    expect(stableOptsKey({ initial: [1, null, 3] })).toBe(
      stableOptsKey({ initial: [1, null, 3] }),
    );
  });
});

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

  it("FIX 1 — divergent shared options are TWO subscriptions (opts-in-key); identical fold to ONE", async () => {
    let calls = 0;
    const link = {
      surface: {
        prefs: {
          // Stays open (never completes) so a typed-end eviction can't skew the count.
          get: (..._a: unknown[]): Promise<AsyncIterable<{ n: number }>> => {
            calls++;
            return pendingForever<{ n: number }>()();
          },
          set: async () => {},
        },
      },
    };
    await createRoot(async (outer) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link.
      const app = surfaceClient(prefsSurface, link as any);
      app.cells.prefs.use({ authority: "local", initial: { n: 0 } }); // slot A
      app.cells.prefs.use({ authority: "server" }); // slot B — DIVERGENT authority
      app.cells.prefs.use({ authority: "server" }); // folds into slot B (identical)
      await settle();
      // A local-authority coalesced store and a server-authority view are honestly TWO
      // upstream subs — the 2nd `.use()` must NOT silently inherit the 1st's variant; the
      // 3rd (identical to the 2nd) shares. So exactly TWO — never one (the old silent
      // share), never three.
      expect(calls).toBe(2);
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
