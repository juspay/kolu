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

import { Effect, Schema, Stream } from "effect";
import { createRoot, onCleanup } from "solid-js";
import { describe, expect, it } from "vitest";
import { defineSurface } from "../define";
import type { SurfaceDispatch } from "../link";

// The cache is wired inside `buildSurfaceClient`; a plain in-process dispatch (no
// wire, no half-open brand) is accepted bare, so we drive the real client with a
// stub dispatch.
import { runUnderOwner, stableOptsKey } from "./keyedSubscriptionCache";
import { surfaceClient } from "./surfaceClient";

/** A tag-keyed {@link SurfaceDispatch} — the shape `surfaceClient` now consumes.
 *  The client builds the nested member face (`surface.<member>.<verb>`) ITSELF via
 *  `buildSurfaceFace`, so a test stubs the DISPATCH one layer down, keyed by the
 *  flat wire tag `surface/<member>/<verb>`.
 *
 *  Each streaming entry is a FACTORY invoked per subscribe (through
 *  `Stream.suspend`), which is what lets the dedup pins below count subscriptions.
 *  An unlisted tag FAILS loudly rather than resolving to `undefined`. */
function fakeDispatch(
  streams: Record<
    string,
    (payload: unknown) => Stream.Stream<unknown, unknown>
  >,
  unaries: Record<string, (payload: unknown) => Promise<unknown>> = {},
): SurfaceDispatch {
  return {
    unary: (tag, payload) => {
      const fn = unaries[tag];
      if (!fn) return Effect.fail(new Error(`no unary bound at "${tag}"`));
      return Effect.tryPromise({ try: () => fn(payload), catch: (e) => e });
    },
    stream: (tag, payload) => {
      const fn = streams[tag];
      if (!fn) return Stream.fail(new Error(`no stream bound at "${tag}"`));
      return Stream.suspend(() => fn(payload));
    },
  };
}

describe("runUnderOwner — THE CLASS pin: an ownerless increment/onCleanup-decrement pair must net to zero", () => {
  // This recurring bug class (SIX prior instances: the keyed-slot ref-count, the
  // whole-collection onError registry, etc.) is always the SAME shape: code pairs an
  // increment with an `onCleanup`-guarded decrement, assuming a reactive owner is
  // ambient. Solid's `onCleanup` outside an owner warns and no-ops, so an ownerless
  // caller gets the increment with NO decrement — a PERMANENT leak. `runUnderOwner`
  // is the ONE place this package now routes such a pair through; this pins its
  // general contract so the SEVENTH instance, if it reuses this helper (as the
  // in-file docs direct future authors to), can't reintroduce the leak.
  it("owned: fn() runs directly under the ambient owner — its onCleanup fires on THAT owner's disposal, not before", () => {
    let cleaned = 0;
    let disposeOuter = (): void => {};
    let result: number | undefined;
    createRoot((d) => {
      disposeOuter = d;
      result = runUnderOwner(() => {
        onCleanup(() => {
          cleaned++;
        });
        return 42;
      });
    });
    expect(result).toBe(42);
    expect(cleaned).toBe(0); // the ambient (outer) owner hasn't disposed yet
    disposeOuter();
    expect(cleaned).toBe(1);
  });

  it("ownerless: fn()'s onCleanup fires in the SAME tick — the increment+decrement nets to zero, never a standing leak", () => {
    let cleaned = 0;
    // No createRoot wrapping — getOwner() is null here (top-level test body).
    const result = runUnderOwner(() => {
      onCleanup(() => {
        cleaned++;
      });
      return 7;
    });
    expect(result).toBe(7);
    // Without the fix (a bare `return fn()`), `onCleanup` outside an owner warns
    // and no-ops — `cleaned` would stay 0 forever, exactly the permanent-leak
    // shape this whole class of bug takes.
    expect(cleaned).toBe(1);
  });
});

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
      schema: Schema.Struct({ state: Schema.String }),
      default: { state: "connecting" },
      verbs: ["get"],
    },
  },
});

/** A mutable cell usable under local authority (has a `set` verb). */
const prefsSurface = defineSurface({
  cells: {
    prefs: {
      schema: Schema.Struct({ n: Schema.Number }),
      default: { n: 0 },
      verbs: ["get", "set"],
    },
  },
});

/** A stream — accessor-input, per-consumer, NOT deduped. */
const streamSurface = defineSurface({
  streams: {
    activity: {
      inputSchema: Schema.Struct({}),
      outputSchema: Schema.Array(Schema.String),
    },
  },
});

/** A wire stream that yields `value` once then COMPLETES (typed end).
 *
 *  Deliberately ASYNC (an async generator rather than `Stream.make`): a real wire
 *  stream always crosses an await before its first frame, and a SYNCHRONOUS stream
 *  runs to completion inside `Effect.runFork` — i.e. the typed end (and the dedup
 *  slot eviction it triggers) would land BEFORE `.use()` even returned, so the
 *  dedup pins below would be measuring an artefact of the stub rather than the
 *  cache. */
function once<T>(value: T): Stream.Stream<T, unknown> {
  return Stream.fromAsyncIterable(
    (async function* () {
      yield value;
    })(),
    (e) => e,
  );
}

/** A wire stream that stays OPEN (never yields, never completes) until the
 *  subscription's fiber is interrupted — for the abort-suppression pin. */
const pendingForever: Stream.Stream<never> = Stream.never;

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
    const dispatch = fakeDispatch({
      "surface/conn/get": () => once({ state: "connected" }),
    });
    await createRoot(async (outer) => {
      const app = surfaceClient(cellSurface, dispatch);
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
    const dispatch = fakeDispatch({
      "surface/conn/get": () => {
        calls++;
        return once({ state: "connected" });
      },
    });
    await createRoot(async (outer) => {
      const app = surfaceClient(cellSurface, dispatch);
      app.cells.conn.use();
      app.cells.conn.use();
      await settle();
      expect(calls).toBe(1);
      outer();
    });
  });

  it("a TYPED completion evicts the slot — a later view re-subscribes (source called again)", async () => {
    let calls = 0;
    const dispatch = fakeDispatch({
      "surface/conn/get": () => {
        calls++;
        return once({ state: "connected" }); // yields once then COMPLETES
      },
    });
    await createRoot(async (outer) => {
      const app = surfaceClient(cellSurface, dispatch);
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
    const dispatch = fakeDispatch({ "surface/conn/get": () => pendingForever });
    let errored = false;
    await createRoot(async (outer) => {
      const app = surfaceClient(cellSurface, dispatch);
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
    const dispatch = fakeDispatch(
      { "surface/prefs/get": () => once({ n: 0 }) },
      {
        "surface/prefs/set": async () => {
          serverWrites++;
        },
      },
    );
    await createRoot(async (outer) => {
      const app = surfaceClient(prefsSurface, dispatch);
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
    const dispatch = fakeDispatch(
      {
        // Stays open (never completes) so a typed-end eviction can't skew the count.
        "surface/prefs/get": () => {
          calls++;
          return pendingForever;
        },
      },
      { "surface/prefs/set": async () => {} },
    );
    await createRoot(async (outer) => {
      const app = surfaceClient(prefsSurface, dispatch);
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
    const dispatch = fakeDispatch({
      "surface/activity/get": () => {
        calls++;
        return once<string[]>([]);
      },
    });
    await createRoot(async (outer) => {
      const app = surfaceClient(streamSurface, dispatch);
      app.streams.activity.use(() => ({}));
      app.streams.activity.use(() => ({}));
      await settle();
      // Two input accessors are honestly two subscriptions — the cache leaves the
      // reactive-input path untouched.
      expect(calls).toBe(2);
      outer();
    });
  });

  it('MINOR FIX — omitted and explicit-default `authority: "server"` fold to the SAME slot', async () => {
    let calls = 0;
    const dispatch = fakeDispatch(
      {
        "surface/prefs/get": () => {
          calls++;
          return pendingForever;
        },
      },
      { "surface/prefs/set": async () => {} },
    );
    await createRoot(async (outer) => {
      const app = surfaceClient(prefsSurface, dispatch);
      // Omitted `authority` and explicit `authority: "server"` (the documented
      // default) are the SAME logical site — `useCell` treats them identically —
      // so both must fold onto ONE upstream subscription, not silently open two.
      app.cells.prefs.use({});
      app.cells.prefs.use({ authority: "server" });
      app.cells.prefs.use(); // no options at all — same default, same slot
      await settle();
      expect(calls).toBe(1);
      outer();
    });
  });

  /** A never-ending upstream stream that RECORDS its own lifecycle: `opened` on
   *  subscribe, `torn` when its finalizer runs.
   *
   *  This is the Effect-4 spelling of the old `opts.signal` capture. There is no
   *  `AbortSignal` on the wire any more — cancellation IS fiber interruption
   *  (D10/#18), and interruption is what runs the stream's finalizers, which is
   *  what cancels the wire subscription. So the SAME law ("the dedup slot's
   *  teardown reaches the upstream call itself, not just the local consume loop")
   *  is now observed at the finalizer instead of at a signal flag. */
  function lifecycleTracked(): {
    stream: Stream.Stream<never>;
    opened: () => boolean;
    torn: () => boolean;
  } {
    let opened = false;
    let torn = false;
    const stream = Stream.ensuring(
      Stream.suspend(() => {
        opened = true;
        return Stream.never;
      }),
      Effect.sync(() => {
        torn = true;
      }),
    );
    return { stream, opened: () => opened, torn: () => torn };
  }

  it("PIN — disposing the last consumer of a cached CELL sub TEARS DOWN the upstream stream", async () => {
    const upstream = lifecycleTracked();
    const dispatch = fakeDispatch({
      "surface/conn/get": () => upstream.stream,
    });
    await createRoot(async (outer) => {
      const app = surfaceClient(cellSurface, dispatch);
      let disposeConsumer = (): void => {};
      createRoot((d) => {
        disposeConsumer = d;
        app.cells.conn.use();
      });
      await settle();
      // The stream is open and NOT torn down while the (only) consumer is mounted.
      expect(upstream.opened()).toBe(true);
      expect(upstream.torn()).toBe(false);

      disposeConsumer(); // last consumer leaves → the shared slot tears down
      await settle();
      // The dedup slot's teardown must reach all the way to the wire call's own
      // finalizers — not just stop the local consume loop — so the server-side
      // subscription actually closes instead of surviving indefinitely.
      expect(upstream.torn()).toBe(true);
      outer();
    });
  });

  it("PIN — disposing the last consumer of a cached whole-COLLECTION's keys-stream tears it down too", async () => {
    const upstream = lifecycleTracked();
    const dispatch = fakeDispatch(
      {
        "surface/plain/keys": () => upstream.stream,
        "surface/plain/get": () => pendingForever,
      },
      {
        "surface/plain/upsert": () => Promise.resolve(),
        "surface/plain/delete": () => Promise.resolve(),
      },
    );
    const surface = defineSurface({
      collections: {
        plain: {
          keySchema: Schema.String,
          schema: Schema.Struct({ v: Schema.Number }),
        },
      },
    });
    await createRoot(async (outer) => {
      const app = surfaceClient(surface, dispatch);
      let disposeConsumer = (): void => {};
      createRoot((d) => {
        disposeConsumer = d;
        app.collections.plain.use({});
      });
      await settle();
      expect(upstream.opened()).toBe(true);
      expect(upstream.torn()).toBe(false);

      disposeConsumer();
      await settle();
      expect(upstream.torn()).toBe(true);
      outer();
    });
  });

  it("WEAKENED FIX — an ownerless .use() does not leak the listener count; it tears down instead of standing forever", async () => {
    let calls = 0;
    const dispatch = fakeDispatch({
      "surface/conn/get": () => {
        calls++;
        return pendingForever;
      },
    });
    const app = surfaceClient(cellSurface, dispatch);

    // Call `.use()` completely OWNERLESS — no `createRoot` wrapping, mirroring
    // kolu's `refuseIfWarming` → `entry(host).state()` called from a DOM handler.
    // getOwner() is null here (top-level test body, no reactive scope).
    app.cells.conn.use();
    await settle();
    // Without the fix, `onCleanup` outside an owner warns-and-no-ops, so the
    // singleton root's listener count is incremented and NEVER decremented — the
    // slot (and its underlying wire subscription) would stand forever, and
    // `connCount` would stay 1 with no way to ever reach 0. With the fix, the
    // ownerless call acquires-and-releases in the same tick, so by now it's
    // already torn back down.
    expect(connCount(app)).toBe(0);

    // A subsequent REAL, owned consumer re-subscribes cleanly (source called
    // again) — proof the ownerless call didn't wedge the slot into some
    // half-registered state that a real consumer could never properly join.
    createRoot((d) => {
      app.cells.conn.use();
      d();
    });
    await settle();
    expect(calls).toBe(2);
  });
});
