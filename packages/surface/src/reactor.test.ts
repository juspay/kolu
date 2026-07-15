/**
 * `reactor.ts` — the reactive bridge. These tests pin the wrapper's OWN contract
 * (source occurrences, scan's fold + prev-ref-no-publish + the stop-hold error
 * law, and `derived.cell`'s seed / connect-seam / equals dedup), the boot
 * narrowing that keeps a derived member wire-read-only, and — for SR7 — the `$`
 * sibling-read face end-to-end through `implementSurface`: the LAWS as written in
 * the reactive-bridge note (glitch-freedom, `batch` coalescing, change-iff-fired,
 * and the post-equals mirror-poke → derived-recompute edge), plus `computed` as a
 * composable graph node. The raw engine's guarantees live in
 * `reactorEngineLaws.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import {
  batch,
  computed,
  derived,
  type DerivedCell,
  type DerivedComputeCell,
  everyMsOr,
  scan,
  source,
} from "./reactor";
import type { CellStore } from "./server";
import { implementSurface, inMemoryStore } from "./server";

/** A recorder that mirrors `server.ts`'s `ctxApply` write gate exactly — the
 *  path `connect(cell)` drives — so a unit test can observe what would reach the
 *  wire without standing up a full surface: `equals` dedup → store.set →
 *  publish. Kept in lockstep with the real gate (equals-then-store-then-publish)
 *  so a divergence in either surfaces as a test that stops matching reality. */
function recordingCtx<T>(
  store: CellStore<T>,
  equals?: (a: T, b: T) => boolean,
) {
  const published: T[] = [];
  return {
    published,
    set: (next: T): void => {
      if (equals?.(store.get(), next)) return;
      store.set(next);
      published.push(next);
    },
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

async function take<T>(iterable: AsyncIterable<T>, n: number): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iterable) {
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

describe("source", () => {
  it("installs lazily on the first subscriber, uninstalls on the last", () => {
    let installed = 0;
    let uninstalled = 0;
    const src = source<number>((_emit) => {
      installed++;
      return () => {
        uninstalled++;
      };
    });
    expect(installed).toBe(0); // nobody reading yet → no tap

    const a = src.subscribe(() => {});
    const b = src.subscribe(() => {});
    expect(installed).toBe(1); // installed once, on the FIRST subscriber
    expect(uninstalled).toBe(0);

    a();
    expect(uninstalled).toBe(0); // still one subscriber
    b();
    expect(uninstalled).toBe(1); // last one left → tap removed
  });

  it("contains a throwing uninstall during teardown (never propagates out of emit)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const src = source<number>(() => () => {
        throw new Error("uninstall boom");
      });
      const off = src.subscribe(() => {});
      // The last unsubscribe tears down the tap; a throwing uninstall must be
      // caught and logged, not thrown — teardown runs from inside a scan's
      // stop-hold catch, itself inside the batched emit fan-out.
      expect(() => off()).not.toThrow();
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it("delivers each emission to every subscriber as a distinct occurrence", () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    const seen: number[] = [];
    src.subscribe((n) => seen.push(n));
    emit(1);
    emit(2);
    emit(2);
    expect(seen).toEqual([1, 2, 2]); // occurrences, not deduped levels
  });

  it("fences a late emit from a torn-down tap (generation fence)", () => {
    // A racy source keeps its `emit` and fires it AFTER uninstall — a stale
    // occurrence from generation A must not reach generation B's listeners.
    let staleEmit!: (n: number) => void; // generation-A's emit, held across re-install
    let firstInstall = true;
    const src = source<number>((e) => {
      if (firstInstall) {
        staleEmit = e;
        firstInstall = false;
      }
      return () => {};
    });
    const genA: number[] = [];
    const off = src.subscribe((n) => genA.push(n));
    off(); // last subscriber leaves → tap uninstalled, generation bumped
    // Re-subscribe (generation B) with a fresh listener.
    const genB: number[] = [];
    src.subscribe((n) => genB.push(n));
    staleEmit(99); // the STALE generation-A emit fires now
    expect(genA).toEqual([]); // A's listener is gone
    expect(genB).toEqual([]); // and B never hears A's stale occurrence
  });

  it("a throwing install is retryable — not wedged installed with a leaked listener", () => {
    let attempts = 0;
    const src = source<number>((e) => {
      attempts++;
      if (attempts === 1) throw new Error("install failed");
      e(7); // second attempt installs and emits synchronously
      return () => {};
    });
    expect(() => src.subscribe(() => {})).toThrow("install failed");
    // The failed install left nothing behind; a later subscriber retries install.
    const seen: number[] = [];
    src.subscribe((n) => seen.push(n));
    expect(attempts).toBe(2);
    expect(seen).toEqual([7]);
  });

  it("fences the emitter a FAILED install retained (failed-A, success-B, late-A dropped)", () => {
    // A failed install can capture its `emit` before throwing. Its generation must
    // be invalidated on the failure so a SUCCESSFUL retry (which, with no teardown
    // in between, would otherwise reuse the same generation) never receives the
    // failed attempt's late callback as a current occurrence.
    let attempts = 0;
    let failedEmit!: (n: number) => void; // generation-A's emit, held across the throw
    const src = source<number>((e) => {
      attempts++;
      if (attempts === 1) {
        failedEmit = e; // retain A's emit, THEN throw
        throw new Error("install failed");
      }
      return () => {}; // second attempt installs cleanly
    });
    expect(() => src.subscribe(() => {})).toThrow("install failed");

    const seen: number[] = [];
    src.subscribe((n) => seen.push(n)); // generation B's listener
    expect(attempts).toBe(2);

    failedEmit(99); // the STALE generation-A emit fires now — must be fenced
    expect(seen).toEqual([]); // never delivered to generation B
  });
});

describe("scan", () => {
  it("steps the fold exactly once per source occurrence", () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    const count = scan(src, 0, (n) => n + 1);
    expect(count.value.value).toBe(0);
    emit(0);
    emit(0);
    emit(0);
    expect(count.value.value).toBe(3);
  });

  it("a step returning the prev reference publishes nothing (held level)", () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    // Hysteresis: raise at >=80, clear at <70, HOLD (return prev ref) between.
    type Level = { level: "ok" | "alert" };
    const alerts = scan<number, Level>(src, { level: "ok" }, (s, v) => {
      if (v >= 80) return s.level === "alert" ? s : { level: "alert" };
      if (v < 70) return s.level === "ok" ? s : { level: "ok" };
      return s; // hold band → prev reference → no change
    });

    let recomputes = 0;
    // A cheap observer of the level signal — reruns only when the value changes.
    const stopWatch = (() => {
      // Use derived.cell's connect path as the observer would; here just poll.
      let last = alerts.value.peek();
      return () => {
        const now = alerts.value.value;
        if (now !== last) {
          recomputes++;
          last = now;
        }
      };
    })();

    emit(85); // ok -> alert  (a change)
    stopWatch();
    emit(90); // hold at alert (>=80, already alert) -> prev ref -> no change
    stopWatch();
    emit(75); // hold band -> prev ref -> no change
    stopWatch();
    emit(50); // alert -> ok  (a change)
    stopWatch();

    expect(recomputes).toBe(2); // only the two genuine transitions
    expect(alerts.value.value).toEqual({ level: "ok" });
  });

  it("stop-hold error law: a throwing step stops, holds last value, latches, logs", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let emit!: (n: number) => void;
      const src = source<number>((e) => {
        emit = e;
      });
      const acc = scan(src, 0, (n, v) => {
        if (v < 0) throw new Error("bad frame");
        return n + v;
      });

      emit(1);
      emit(2);
      expect(acc.value.value).toBe(3);
      expect(acc.stopped.value).toBe(false);

      emit(-1); // step throws
      expect(acc.stopped.value).toBe(true); // latched
      expect(acc.value.value).toBe(3); // last value HELD, not reset
      expect(spy).toHaveBeenCalledOnce();

      emit(10); // after stop: ignored — the derivation is frozen
      expect(acc.value.value).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  it("stop-hold disposes the source tap even when the FIRST frame throws synchronously on install", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let uninstalled = 0;
      // A source that emits synchronously DURING install — the scan's step throws
      // on that first frame, before `subscribe` has returned its unsubscribe
      // handle. The stop must still dispose the tap (not leak it, guarded).
      const src = source<number>((emit) => {
        emit(-1); // synchronous first occurrence
        return () => {
          uninstalled++;
        };
      });
      const acc = scan(src, 0, (_n, v) => {
        if (v < 0) throw new Error("bad first frame");
        return v;
      });
      expect(acc.stopped.value).toBe(true); // latched even though it threw on install
      expect(uninstalled).toBe(1); // the source tap was disposed, not left subscribed
    } finally {
      spy.mockRestore();
    }
  });
});

describe("derived.cell", () => {
  it("seeds from the node's current level and rides the equals-gated connect seam", () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    const count = scan(src, 0, (n) => n + 1);
    const dc = derived.cell(count);

    // Seed by eager pull — never a fabricated default.
    expect(dc.store.get()).toBe(0);
    // The public store is READ-ONLY (graph is the one writer): its `set` throws.
    expect(() => dc.store.set(99)).toThrow(/graph-owned/);

    // `implementSurface` builds its OWN private serving store, seeded from the
    // read-only facade's `get` (the node's current level), and drives it through
    // `connect` — the dep carries no writable store. Simulate that gate here.
    const ctx = recordingCtx(
      inMemoryStore(dc.store.get()),
      (a: number, b: number) => a === b,
    );
    void dc.connect(ctx);
    // The first (synchronous) connect run pushes the seed, deduped against the
    // identical store seed → nothing published at wiring.
    expect(ctx.published).toEqual([]);

    emit(0);
    emit(0);
    expect(ctx.published).toEqual([1, 2]); // each genuine change publishes once
    dc.dispose();
  });

  it("dedups a recompute that is spec-equals-equal but reference-fresh", () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    // Every emission produces a NEW object, but content only flips at 80/70.
    type Level = { level: "ok" | "alert" };
    const alerts = scan<number, Level>(src, { level: "ok" }, (_s, v) => ({
      level: v >= 80 ? "alert" : "ok",
    }));
    const dc = derived.cell(alerts);
    const ctx = recordingCtx(
      inMemoryStore(dc.store.get()),
      (a: { level: string }, b: { level: string }) => a.level === b.level,
    );
    void dc.connect(ctx);
    expect(ctx.published).toEqual([]); // seed deduped

    emit(85); // ok -> alert
    emit(90); // fresh {alert} object, same level -> deduped at the wire
    emit(50); // alert -> ok
    expect(ctx.published).toEqual([{ level: "alert" }, { level: "ok" }]);
    dc.dispose();
  });

  it("rides implementSurface's connect seam end-to-end (real client frames)", async () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    const count = scan(src, 0, (n) => n + 1);

    const surface = defineSurface({
      cells: {
        // wire-read-only derived cell
        count: {
          schema: z.number(),
          default: 0,
          equals: (a: number, b: number) => a === b,
          verbs: ["get"],
        },
      },
    });
    const { router } = implementSurface(surface, {
      cells: { count: derived.cell(count) },
    });
    const client = directLink<typeof surface.contract>(router as never);

    const iter = await client.surface.count.get(undefined);
    const collected = take(iter, 3);
    await flush(); // let the get subscribe to the bus before we emit deltas
    emit(0); // -> 1
    emit(0); // -> 2
    expect(await collected).toEqual([0, 1, 2]); // seed snapshot, then two deltas
  });

  it("boot narrowing: a derived cell that declares a write verb crashes at wiring", () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    void emit;
    const count = scan(src, 0, (n) => n + 1);

    const surface = defineSurface({
      cells: {
        // A derived cell must be wire-read-only; the default no-patch verbs
        // (`["get","set"]`) declare a second writer → boot crash.
        count: { schema: z.number(), default: 0 },
      },
    });
    expect(() =>
      implementSurface(surface, {
        cells: { count: derived.cell(count) },
      }),
    ).toThrow(/wire-read-only/);
  });

  it("fail-fast: connect() AFTER a standalone dispose() throws (no silent leaked effect)", () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    void emit;
    const count = scan(src, 0, (n) => n + 1);
    const dc = derived.cell(count);

    // Standalone dispose first (a caller that owned its own teardown point) …
    dc.dispose();
    // … then a connect() would install an effect whose teardown is a permanent
    // no-op (the cell is already torn). Crash loudly rather than leak it.
    expect(() => dc.connect({ set: () => {} })).toThrow(/after dispose/);
  });

  it("fail-fast: connect() twice throws (a derived cell wires exactly one subscription)", () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    void emit;
    const count = scan(src, 0, (n) => n + 1);
    const dc = derived.cell(count);

    void dc.connect({ set: () => {} });
    expect(() => dc.connect({ set: () => {} })).toThrow(/twice/);
    dc.dispose();
  });

  it("a non-derived cell with write verbs is unaffected by the narrowing", () => {
    const surface = defineSurface({
      cells: { count: { schema: z.number(), default: 0 } },
    });
    // Plain authored cell (not derived) — narrowing does not fire.
    expect(() =>
      implementSurface(surface, {
        cells: { count: { store: inMemoryStore(0) } },
      }),
    ).not.toThrow();
  });
});

describe("computed", () => {
  it("composes as a graph node into derived.cell and recomputes reactively", () => {
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    const count = scan(src, 0, (n) => n + 1);
    const doubled = computed(() => count.value.value * 2);
    const dc = derived.cell(doubled);
    const ctx = recordingCtx(
      inMemoryStore(dc.store.get()),
      (a: number, b: number) => a === b,
    );
    // Eager seed from the computed's current value (count 0 → 0), never a default.
    expect(dc.store.get()).toBe(0);
    void dc.connect(ctx);
    expect(ctx.published).toEqual([]); // seed deduped at wiring

    emit(0); // count → 1 → doubled 2
    emit(0); // count → 2 → doubled 4
    expect(ctx.published).toEqual([2, 4]);
    dc.dispose();
  });
});

describe("derived.cell($) — the SR7 sibling-read face (laws end-to-end)", () => {
  // The `$` face + the post-equals mirror poke live across `reactor.ts` and
  // `server.ts`, so these ride a REAL `implementSurface` (never a hand-rolled
  // ctx) — the poke is a property of the walk's store wrapper, not the reactor
  // alone.

  it("the post-equals mirror poke edge: a sibling write recomputes a derived compute cell", async () => {
    const surface = defineSurface({
      cells: {
        a: { schema: z.number(), default: 1 },
        doubled: {
          schema: z.number(),
          default: 0,
          equals: (x: number, y: number) => x === y,
          verbs: ["get"],
        },
      },
    });
    const { router, ctx } = implementSurface(surface, {
      cells: {
        a: { store: inMemoryStore(1) },
        doubled: derived.cell(($) => $.a() * 2),
      },
    });
    const client = directLink<typeof surface.contract>(router as never);
    const collected = take(await client.surface.doubled.get(undefined), 3);
    await flush(); // let the get subscribe before we poke

    ctx.cells.a.set(5); // poke a → doubled recomputes → 10
    ctx.cells.a.set(6); // poke a → doubled recomputes → 12
    // Eager seed (1*2), then two recomputes driven purely by the sibling write.
    expect(await collected).toEqual([2, 10, 12]);
  });

  it("change-iff-fired: a suppressed (equals-equal) sibling write never pokes → no recompute", () => {
    let runs = 0;
    const surface = defineSurface({
      cells: {
        a: {
          schema: z.number(),
          default: 0,
          equals: (x: number, y: number) => x === y, // a dedups its own writes
        },
        mirror: {
          schema: z.number(),
          default: 0,
          equals: (x: number, y: number) => x === y,
          verbs: ["get"],
        },
      },
    });
    const { ctx } = implementSurface(surface, {
      cells: {
        a: { store: inMemoryStore(0) },
        mirror: derived.cell(($) => {
          runs++;
          return $.a();
        }),
      },
    });
    const runsAfterSeed = runs; // one compute at the eager seed

    ctx.cells.a.set(0); // equals(0,0) true → SUPPRESSED before store.set → no poke
    expect(runs).toBe(runsAfterSeed); // the derivation did NOT re-run

    ctx.cells.a.set(7); // a genuine change → poke → exactly one recompute
    expect(runs).toBe(runsAfterSeed + 1);
  });

  it("batch coalesces sibling writes into ONE glitch-free recompute (a diamond)", async () => {
    let runs = 0;
    const seen: Array<[number, number]> = [];
    const surface = defineSurface({
      cells: {
        a: { schema: z.number(), default: 0 },
        b: { schema: z.number(), default: 0 },
        sum: {
          schema: z.number(),
          default: 0,
          equals: (x: number, y: number) => x === y,
          verbs: ["get"],
        },
      },
    });
    const { router, ctx } = implementSurface(surface, {
      cells: {
        a: { store: inMemoryStore(0) },
        b: { store: inMemoryStore(0) },
        sum: derived.cell(($) => {
          runs++;
          const av = $.a();
          const bv = $.b();
          seen.push([av, bv]);
          return av + bv;
        }),
      },
    });
    const client = directLink<typeof surface.contract>(router as never);
    const collected = take(await client.surface.sum.get(undefined), 2);
    await flush();

    const runsBefore = runs;
    batch(() => {
      ctx.cells.a.set(3);
      ctx.cells.b.set(4);
    });
    // ONE recompute for the two-write burst …
    expect(runs).toBe(runsBefore + 1);
    // … and it saw BOTH new values together — never the half-updated [3, 0]
    // (glitch-freedom): the only frame the batch produced is [3, 4].
    expect(seen.slice(runsBefore)).toEqual([[3, 4]]);
    // Seed snapshot 0, then the single coalesced delta 7.
    expect(await collected).toEqual([0, 7]);
  });

  it("$ types each sibling read — a cell is its value, a collection its live map (compile-time)", () => {
    const surface = defineSurface({
      cells: {
        n: { schema: z.number(), default: 0 },
        combined: {
          schema: z.number(),
          default: 0,
          equals: (x: number, y: number) => x === y,
          verbs: ["get"],
        },
      },
      collections: {
        items: {
          keySchema: z.string(),
          schema: z.object({ v: z.number() }),
          verbs: ["keys", "get"],
        },
      },
    });
    // The assignments below are the assertion: `$.n()` MUST be `number` and
    // `$.items()` MUST be `ReadonlyMap<string, { v: number }>`, or this fails to
    // typecheck (the file is part of the typecheck gate).
    const { ctx } = implementSurface(surface, {
      cells: {
        n: { store: inMemoryStore(2) },
        combined: derived.cell(($) => {
          const nv: number = $.n();
          const items: ReadonlyMap<string, { v: number }> = $.items();
          return nv + items.size;
        }),
      },
      collections: {
        items: {
          readAll: () => new Map<string, { v: number }>(),
          upsert: () => {},
          remove: () => {},
        },
      },
    });
    // Seed folds the (empty) collection + n: 2 + 0.
    expect(ctx.cells.combined.get()).toBe(2);
  });

  it("fail-fast: reading an unknown sibling throws", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately bypass the typed $ to reach the runtime guard
    const dc = derived.cell(($: any) => $.ghost()) as DerivedComputeCell<
      never,
      unknown
    >;
    dc.bindSiblings({}); // no sources
    expect(() => dc.store.get()).toThrow(/unknown sibling/);
  });

  it("fail-fast: used before bindSiblings throws (the walk must bind before seeding)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: reach store.get before the walk binds siblings
    const dc = derived.cell(($: any) => $.x()) as DerivedComputeCell<
      never,
      unknown
    >;
    expect(() => dc.store.get()).toThrow(/before bindSiblings/);
  });

  it("DIAMOND: derived-reads-derived is glitch-free (the law's permanent pin)", async () => {
    // overview reads BOTH terminals (authored, direct) AND urgency (DERIVED) —
    // worked example 5's diamond. A derived sibling is read as its COMPUTED (not a
    // push-lagging mirror), so the engine's lazy pull orders the recompute: overview
    // never observes a half-updated pair. This test is RED on an all-mirror bridge
    // (overview sees {t:2,u:10} before {t:2,u:20}) and GREEN once a derived sibling
    // is read as its computed. It is the law "derived reads derived as computed,
    // never as mirror" made executable.
    const surface = defineSurface({
      cells: {
        terminals: { schema: z.number(), default: 0 },
        urgency: {
          schema: z.number(),
          default: 0,
          equals: (a: number, b: number) => a === b,
          verbs: ["get"],
        },
        overview: {
          schema: z.object({ t: z.number(), u: z.number() }),
          default: { t: 0, u: 0 },
          equals: (a: { t: number; u: number }, b: { t: number; u: number }) =>
            a.t === b.t && a.u === b.u,
          verbs: ["get"],
        },
      },
    });
    const seen: Array<{ t: number; u: number }> = [];
    const { router, ctx } = implementSurface(surface, {
      cells: {
        terminals: { store: inMemoryStore(0) },
        // Declaration order is irrelevant here — the boot walk builds every derived
        // node before it seeds any, so overview reads urgency's computed whether
        // urgency is declared before or after it (see the order-independence test).
        urgency: derived.cell(($) => $.terminals() * 10),
        overview: derived.cell(($) => {
          const v = { t: $.terminals(), u: $.urgency() };
          seen.push(v);
          return v;
        }),
      },
    });
    const client = directLink<typeof surface.contract>(router as never);
    const frames = take(await client.surface.overview.get(undefined), 3);
    await flush();

    ctx.cells.terminals.set(1); // → overview {t:1,u:10}
    batch(() => {
      ctx.cells.terminals.set(2); // → overview {t:2,u:20}
    });

    // No `seen` value is ever a half-updated pair (u must always equal t*10).
    for (const v of seen) expect(v.u).toBe(v.t * 10);
    // And each terminals change publishes overview exactly once (no double from a
    // transient glitch): seed + two coalesced deltas.
    expect(await frames).toEqual([
      { t: 0, u: 0 },
      { t: 1, u: 10 },
      { t: 2, u: 20 },
    ]);
  });

  it("ORDER-INDEPENDENT BOOT: a downstream compute cell declared BEFORE its upstream seeds correctly", async () => {
    // overview (reads urgency) is DECLARED BEFORE urgency (reads terminals) — the
    // reverse of the diamond above. The two-pass boot walk builds every derived
    // node before it seeds any, so overview's seed finds urgency's node already
    // built regardless of declaration order and pulls its computed value. RED on
    // the old single-pass build: seeding overview would pull a not-yet-built
    // urgency node and crash the walk (`implementSurface` would throw here). (Only
    // the seed is order-independent; a diamond's glitch-free UPDATE ordering is
    // pinned by the DIAMOND test above, which declares upstream-first.)
    const surface = defineSurface({
      cells: {
        terminals: { schema: z.number(), default: 0 },
        overview: {
          schema: z.object({ t: z.number(), u: z.number() }),
          default: { t: 0, u: 0 },
          equals: (a: { t: number; u: number }, b: { t: number; u: number }) =>
            a.t === b.t && a.u === b.u,
          verbs: ["get"],
        },
        urgency: {
          schema: z.number(),
          default: 0,
          equals: (a: number, b: number) => a === b,
          verbs: ["get"],
        },
      },
    });
    const { router } = implementSurface(surface, {
      cells: {
        terminals: { store: inMemoryStore(3) },
        // Downstream declared FIRST — reads urgency, which is declared LAST.
        overview: derived.cell(($) => ({ t: $.terminals(), u: $.urgency() })),
        urgency: derived.cell(($) => $.terminals() * 10),
      },
    });
    const client = directLink<typeof surface.contract>(router as never);
    const frames = take(await client.surface.overview.get(undefined), 1);
    await flush();

    // Boot did not crash and seeded from the whole graph: overview = {t:3, u:3*10}.
    expect(await frames).toEqual([{ t: 3, u: 30 }]);
  });

  it("a derived cell folding a COLLECTION recomputes on upsert/remove (the version-poke edge padi urgency rides)", async () => {
    // The exact edge that drives padi urgency: a derived cell reads $.<collection>()
    // and must recompute whenever the collection's wrapped publishers fire — an
    // upsert or a remove. The $-typing test above only seeds an empty collection;
    // this end-to-end test mutates it and asserts the recompute + wire frames, so
    // the bridge→collection integration can't silently regress.
    const surface = defineSurface({
      cells: {
        bigCount: {
          schema: z.number(),
          default: 0,
          equals: (a: number, b: number) => a === b,
          verbs: ["get"],
        },
      },
      collections: {
        items: {
          keySchema: z.string(),
          schema: z.object({ n: z.number() }),
          verbs: ["keys", "get"],
        },
      },
    });
    const store = new Map<string, { n: number }>();
    const { router, ctx } = implementSurface(surface, {
      cells: {
        // count the items whose n > 1 — a fold over the whole collection
        bigCount: derived.cell(
          ($) => [...$.items().values()].filter((v) => v.n > 1).length,
        ),
      },
      collections: {
        items: {
          readAll: () => store,
          readOne: (k) => store.get(k),
          upsert: (k, v) => {
            store.set(k, v);
          },
          remove: (k) => {
            store.delete(k);
          },
        },
      },
    });
    const client = directLink<typeof surface.contract>(router as never);
    const frames = take(await client.surface.bigCount.get(undefined), 4);
    await flush();

    ctx.collections.items.upsert("a", { n: 5 }); // → 1
    ctx.collections.items.upsert("b", { n: 0 }); // n≤1: fold unchanged → deduped, no frame
    ctx.collections.items.upsert("c", { n: 9 }); // → 2
    ctx.collections.items.remove("a"); // → 1
    // seed 0, then the three folds that MOVED the count (the b-upsert deduped).
    expect(await frames).toEqual([0, 1, 2, 1]);
  });

  it("derived.cell(computed(fn)) holds last published on a LATER throw — log-skip-continue, no escape", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let emit!: (n: number) => void;
    const src = source<number>((e) => {
      emit = e;
    });
    const count = scan(src, 0, (n) => n + 1);
    let boom = false;
    const c = computed(() => {
      const v = count.value.value;
      if (boom) throw new Error("boom");
      return v * 2;
    });
    const dc = derived.cell(c);
    const ctx = recordingCtx(
      inMemoryStore(dc.store.get()),
      (a: number, b: number) => a === b,
    );
    void dc.connect(ctx);

    emit(0); // count 1 → 2
    expect(ctx.published).toEqual([2]);
    boom = true;
    // The compute throw is LOGGED and swallowed at the effect boundary — it must
    // NOT escape synchronously into the writer's (`emit`'s) stack.
    expect(() => emit(0)).not.toThrow();
    expect(ctx.published).toEqual([2]); // last value HELD
    expect(errSpy).toHaveBeenCalled();
    boom = false;
    emit(0); // count 3 → 6 — heals on the next good recompute
    expect(ctx.published).toEqual([2, 6]);
    dc.dispose();
    errSpy.mockRestore();
  });

  it("fail-fast: a cell and a collection sharing a key is rejected at defineSurface", () => {
    // The $-face flat-namespace invariant is a static property of the spec, so it
    // is caught at DEFINITION (for every consumer, server or contract-only client)
    // — not deferred to the boot walk. Disjoint wire verbs (cell `get`, collection
    // `keys`), so the existing duplicate-verb guard can't mask it — the key
    // collision itself is what must fail.
    expect(() =>
      defineSurface({
        cells: { same: { schema: z.number(), default: 0, verbs: ["get"] } },
        collections: {
          same: { keySchema: z.string(), schema: z.number(), verbs: ["keys"] },
        },
      }),
    ).toThrow(/declared as BOTH a cell and a collection/);
  });

  it("a member named like an Object.prototype key (toString) does NOT falsely collide", () => {
    // Member names are arbitrary Record keys; a cell named `toString` must not read
    // as already-registered off the sibling dictionary's prototype (nor leak the
    // inherited function to `$`). Boots clean and `$.toString()` reads the real cell.
    const surface = defineSurface({
      cells: {
        toString: { schema: z.number(), default: 7, verbs: ["get"] },
        mirror: {
          schema: z.number(),
          default: 0,
          equals: (a: number, b: number) => a === b,
          verbs: ["get"],
        },
      },
    });
    const { ctx } = implementSurface(surface, {
      cells: {
        toString: { store: inMemoryStore(7) },
        mirror: derived.cell(($) => $.toString()),
      },
    });
    expect(ctx.cells.mirror.get()).toBe(7);
  });
});

describe("source (poll shape) — derived.cell(source({ read, install }))", () => {
  it("seeds from the T+0 read, then re-reads and publishes on each tick", async () => {
    let value = 1;
    let tick!: () => void;
    let uninstalled = 0;
    const src = source({
      read: () => Promise.resolve(value),
      install: (t) => {
        tick = t;
        return () => {
          uninstalled++;
        };
      },
    });
    const dc = derived.cell(src);
    const ctx = recordingCtx(
      inMemoryStore<number | undefined>(undefined),
      (a, b) => a === b,
    );
    // The connect is ASYNC for a poll source — it awaits the T+0 seed read.
    const dispose = await dc.connect(ctx);
    expect(ctx.published).toEqual([1]); // T+0 seed published

    value = 2;
    tick();
    await flush();
    expect(ctx.published).toEqual([1, 2]); // re-read on tick

    value = 2; // unchanged value — the member `equals` dedups it
    tick();
    await flush();
    expect(ctx.published).toEqual([1, 2]);

    dispose();
    expect(uninstalled).toBe(1); // the disposer uninstalls the caller's cadence
  });

  it("a poll source's level is honestly T | undefined; the dedicated overload recovers the served T (compile-time)", () => {
    const src = source<number>({
      read: () => Promise.resolve(1),
      install: () => () => {},
    });
    // The poll source's own level is HONESTLY `number | undefined` (undefined until
    // the seed) — NOT a synchronously-readable `number`. This assignment is the
    // assertion; it would fail to typecheck if `value` claimed `number`.
    const level: number | undefined = src.value.value;
    void level;
    // The dedicated poll overload returns a `PollDerivedCell<number>` whose CONNECTOR
    // publishes a `number` (the served value), but whose SYNCHRONOUS dep face is
    // honestly `number | undefined` — the type does NOT launder pre-seed undefined
    // into `number`. These assignments are the assertion (F3):
    const cell = derived.cell(src);
    const preSeedGet: number | undefined = cell.store.get();
    const preSeedSibling: number | undefined = cell.siblingRead();
    void preSeedGet;
    void preSeedSibling;
    // @ts-expect-error — `store.get()` is `number | undefined`, NOT `number`: a poll
    // dep's facade has no value before the seed, and the type says so.
    const launderedGet: number = cell.store.get();
    void launderedGet;
    // @ts-expect-error — `siblingRead()` is `number | undefined`, NOT `number`.
    const launderedSibling: number = cell.siblingRead();
    void launderedSibling;
    // The exploit F3 closes: wrapping the level in a `computed` yields a
    // `GraphNode<number | undefined>` (honest), so the cell it makes is
    // `DerivedCell<number | undefined>` — it can NOT masquerade as a `number` cell.
    const wrapped = derived.cell(computed(() => src.value.value));
    // @ts-expect-error — the wrapped cell is DerivedCell<number | undefined>; the
    // undefined can't be silently laundered away under a `number` type.
    const notNumber: DerivedCell<number> = wrapped;
    void notNumber;
    expect(typeof src).toBe("object");
  });

  it("first-read failure PROPAGATES — the connect rejects (a boot crash)", async () => {
    const src = source<number>({
      read: () => Promise.reject(new Error("sensor down")),
      install: () => () => {},
    });
    const dc = derived.cell(src);
    const ctx = recordingCtx(inMemoryStore<number | undefined>(undefined));
    await expect(dc.connect(ctx)).rejects.toThrow("sensor down");
    expect(ctx.published).toEqual([]); // nothing served — never a fabricated default
  });

  it("a LATER read that throws is log-skip-continue (holds the last value)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let mode: "ok" | "boom" = "ok";
      let tick!: () => void;
      const src = source<number>({
        read: () =>
          mode === "ok"
            ? Promise.resolve(5)
            : Promise.reject(new Error("blip")),
        install: (t) => {
          tick = t;
          return () => {};
        },
      });
      const dc = derived.cell(src);
      const ctx = recordingCtx(
        inMemoryStore<number | undefined>(undefined),
        (a, b) => a === b,
      );
      await dc.connect(ctx);
      expect(ctx.published).toEqual([5]);

      mode = "boom";
      tick();
      await flush();
      expect(ctx.published).toEqual([5]); // held — no new publish, no throw out
      expect(spy).toHaveBeenCalledOnce();
      dc.dispose();
    } finally {
      spy.mockRestore();
    }
  });

  it("a LATER tick whose PUBLISHER throws is log-skip-continue — no unhandled rejection, holds last", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let value = 5;
      let tick!: () => void;
      const src = source<number>({
        read: () => Promise.resolve(value),
        install: (t) => {
          tick = t;
          return () => {};
        },
      });
      const dc = derived.cell(src);
      // A cell whose `set` THROWS on the second publish (a later-tick publisher throw
      // — a write hook / reconcile publisher failing). The seed publish (5) succeeds.
      const published: number[] = [];
      let boom = false;
      const throwingCell = {
        set: (v: number) => {
          if (boom) throw new Error("publish blip");
          published.push(v);
        },
      };
      await dc.connect(throwingCell);
      expect(published).toEqual([5]); // seed published

      boom = true;
      value = 6;
      tick(); // the later read succeeds, but the publish throws
      await flush();
      // Log-skip-continue: the throw is logged and the last value HELD — NOT an
      // unhandled rejection (nothing awaits tickRead's chain), and the poll lives on.
      expect(published).toEqual([5]);
      expect(spy).toHaveBeenCalledOnce();

      // The poll is NOT wedged — a later good publish still lands (inFlight cleared).
      boom = false;
      value = 7;
      tick();
      await flush();
      expect(published).toEqual([5, 7]);
      dc.dispose();
    } finally {
      spy.mockRestore();
    }
  });

  it("non-overlap guard COALESCES a tick during an in-flight read into ONE trailing read (not dropped)", async () => {
    let reads = 0;
    let resolveRead!: (n: number) => void;
    let tick!: () => void;
    const src = source<number>({
      read: () => {
        reads++;
        return new Promise<number>((r) => {
          resolveRead = r;
        });
      },
      install: (t) => {
        tick = t;
        return () => {};
      },
    });
    const dc = derived.cell(src);
    const ctx = recordingCtx(inMemoryStore<number | undefined>(undefined));
    const connectP = dc.connect(ctx); // T+0 seed read in flight (reads === 1)
    expect(reads).toBe(1);
    resolveRead(1);
    await connectP;

    // `tick` sets `inFlight` synchronously, then defers the read a microtask (so a
    // SYNCHRONOUS throw from `read` takes the logged-skip path, not the callback).
    tick(); // inFlight = true synchronously; read A scheduled
    tick(); // LATCHED (dirty) — inFlight is already true; NOT dropped
    tick(); // still latched — a burst COALESCES to a single trailing read
    await flush(); // let read A actually run
    expect(reads).toBe(2); // seed (1) + read A (1); the burst is still latched, not yet read

    // Resolving read A fires the ONE coalesced trailing read for the whole burst —
    // the edge is remembered, not lost (F6), and exactly once (not per tick).
    resolveRead(2);
    await flush();
    expect(reads).toBe(3); // the single trailing read — never 4+ (burst coalesced)
    resolveRead(3);
    await flush();
    expect(reads).toBe(3); // nothing further latched → no extra read
    dc.dispose();
  });

  it("a later read that throws SYNCHRONOUSLY is log-skip-continue — inFlight never wedges", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let mode: "ok" | "throw" = "ok";
      let val = 5;
      let tick!: () => void;
      const src = source<number>({
        // A THROW-ONLY read is type-compatible; this returns before its Promise.
        read: () => {
          if (mode === "throw") throw new Error("sync boom");
          return Promise.resolve(val);
        },
        install: (t) => {
          tick = t;
          return () => {};
        },
      });
      const dc = derived.cell(src);
      const ctx = recordingCtx(
        inMemoryStore<number | undefined>(undefined),
        (a, b) => a === b,
      );
      await dc.connect(ctx);
      expect(ctx.published).toEqual([5]);

      mode = "throw";
      tick();
      await flush();
      expect(ctx.published).toEqual([5]); // held, not crashed
      expect(spy).toHaveBeenCalled();

      // NOT wedged: a subsequent good read still publishes (inFlight was cleared even
      // though the previous read threw synchronously).
      mode = "ok";
      val = 9;
      tick();
      await flush();
      expect(ctx.published).toEqual([5, 9]);
      dc.dispose();
    } finally {
      spy.mockRestore();
    }
  });

  it("an edge DURING the seed is latched and reflected by a trailing read (durable readiness)", async () => {
    // The install (the change-listener) runs BEFORE the seed, so an edge that fires
    // while the seed is still in flight is remembered — not lost to a not-yet-
    // subscribed listener, the exact race a kaval connecting mid-inventory-seed hits.
    let value = 1;
    let resolveSeed!: (n: number) => void;
    let seeded = false;
    let tick!: () => void;
    const src = source<number>({
      read: () => {
        if (!seeded) {
          seeded = true;
          return new Promise<number>((r) => {
            resolveSeed = r;
          }); // the seed — held until resolveSeed
        }
        return Promise.resolve(value); // later reads sample the live value
      },
      install: (t) => {
        tick = t;
        return () => {};
      },
    });
    const dc = derived.cell(src);
    const ctx = recordingCtx(
      inMemoryStore<number | undefined>(undefined),
      (a, b) => a === b,
    );
    const connectP = dc.connect(ctx); // installs, then the seed goes in flight
    tick(); // an edge fires WHILE the seed is in flight — latched as `dirty`
    value = 2; // the state that edge signalled
    resolveSeed(1); // the seed lands = the now-stale 1
    await connectP;
    await flush(); // the trailing read for the during-seed edge runs
    // The seed published 1, then the latched trailing read corrected it to 2 at once
    // — the mid-seed edge is honoured, not deferred to the next cadence.
    expect(ctx.published).toEqual([1, 2]);
    dc.dispose();
  });

  it("a throwing seed PUBLISHER tears down the cadence before connect rejects — no leak (F8)", async () => {
    // Install-before-seed puts the cadence into the seed's publication lifetime, so a
    // publisher throw (a cell write hook / a collection reconcile publisher) at
    // `set(seed)` — the SAME fault class as a read failure — must roll the cadence
    // back immediately, not leave it polling a failed publisher until an external
    // dispose.
    let installed = 0;
    let uninstalled = 0;
    const src = source<number>({
      read: () => Promise.resolve(1),
      install: (t) => {
        installed++;
        void t;
        return () => {
          uninstalled++;
        };
      },
    });
    const dc = derived.cell(src);
    // A cell whose seed publish THROWS.
    const throwingCell = {
      set: () => {
        throw new Error("publisher boom");
      },
    };
    await expect(dc.connect(throwingCell)).rejects.toThrow("publisher boom");
    // Cadence rolled back at once — no dispose() call, no leaked interval.
    expect(installed).toBe(1);
    expect(uninstalled).toBe(1);
  });

  it("close during a LATER in-flight read: no failure log, no late publish (owned abort is silent)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let tick!: () => void;
      let seeded = false;
      const src = source<number>({
        read: (signal) => {
          if (!seeded) {
            seeded = true;
            return Promise.resolve(1);
          }
          // A later read that COOPERATES with the abort — it rejects when close aborts.
          return new Promise<number>((_res, rej) => {
            signal?.addEventListener("abort", () => rej(new Error("aborted")), {
              once: true,
            });
          });
        },
        install: (t) => {
          tick = t;
          return () => {};
        },
      });
      const dc = derived.cell(src);
      const ctx = recordingCtx(inMemoryStore<number | undefined>(undefined));
      const ctl = new AbortController();
      await dc.connect(ctx, { signal: ctl.signal });
      expect(ctx.published).toEqual([1]);

      tick(); // a later read starts and is in flight
      await flush();
      ctl.abort(); // close() aborts the in-flight read cooperatively
      await flush();
      // The read rejects with the OWNED abort reason — clean shutdown, NOT a poll
      // failure: nothing logged, nothing published.
      expect(spy).not.toHaveBeenCalled();
      expect(ctx.published).toEqual([1]);
    } finally {
      spy.mockRestore();
    }
  });

  it("close during the T+0 seed: no late publish, cadence torn down, connect settles", async () => {
    let resolveRead!: (n: number) => void;
    let installed = 0;
    let uninstalled = 0;
    const src = source<number>({
      read: () =>
        new Promise<number>((r) => {
          resolveRead = r;
        }),
      install: (t) => {
        installed++;
        void t;
        return () => {
          uninstalled++;
        };
      },
    });
    const dc = derived.cell(src);
    const ctx = recordingCtx(inMemoryStore<number | undefined>(undefined));
    const ctl = new AbortController();
    const connectP = dc.connect(ctx, { signal: ctl.signal }); // installs, seed in flight
    ctl.abort(); // close() races the seed
    resolveRead(7); // seed resolves AFTER the abort
    await connectP; // must SETTLE (not hang)
    expect(ctx.published).toEqual([]); // no late publish over a closing runtime
    // The cadence is installed BEFORE the seed (so a during-seed edge isn't lost),
    // so a close-during-seed must TEAR IT DOWN — no live listener leaks.
    expect(installed).toBe(1);
    expect(uninstalled).toBe(1);
  });

  it("rides implementSurface: a poll cell seeds the spec DEFAULT, then publishes reads", async () => {
    let value = 100;
    let tick!: () => void;
    const src = source({
      read: () => Promise.resolve(value),
      install: (t) => {
        tick = t;
        return () => {};
      },
    });
    const surface = defineSurface({
      cells: {
        temp: {
          schema: z.number(),
          default: -1,
          equals: (a: number, b: number) => a === b,
          verbs: ["get"],
        },
      },
    });
    const { ctx, done } = implementSurface(surface, {
      cells: { temp: derived.cell(src) },
    });
    void done;
    // The seed read resolves on a microtask; before it lands the cell serves the
    // spec DEFAULT (behavior-neutral with the hand-rolled sampler), never undefined.
    await flush();
    expect(ctx.cells.temp.get()).toBe(100); // first read published over the default

    value = 200;
    tick();
    await flush();
    expect(ctx.cells.temp.get()).toBe(200);
  });
});

describe("derived.collection — the keyed reconciler", () => {
  const surface = defineSurface({
    collections: {
      items: {
        keySchema: z.string(),
        schema: z.object({ n: z.number() }),
        // per-key value equality — the reconciler's diff predicate
        equals: (a: { n: number }, b: { n: number }) => a.n === b.n,
        verbs: ["keys", "get"],
      },
    },
  });

  it("reconciles a poll source's whole-map read into per-key upserts + removes", async () => {
    let table = new Map<string, { n: number }>([
      ["a", { n: 1 }],
      ["b", { n: 2 }],
    ]);
    let tick!: () => void;
    const runtime = implementSurface(surface, {
      collections: {
        items: derived.collection(
          source({
            read: () => Promise.resolve(new Map(table)),
            install: (t) => {
              tick = t;
              return () => {};
            },
          }),
        ),
      },
    });
    await flush(); // the T+0 seed read lands → reconcile upserts every key
    expect(runtime.ctx.collections.items.readAll()).toEqual(
      new Map([
        ["a", { n: 1 }],
        ["b", { n: 2 }],
      ]),
    );

    // Change b's value, add c, drop a — the reconciler upserts b+c and removes a.
    table = new Map([
      ["b", { n: 5 }],
      ["c", { n: 9 }],
    ]);
    tick();
    await flush();
    expect(runtime.ctx.collections.items.readAll()).toEqual(
      new Map([
        ["b", { n: 5 }],
        ["c", { n: 9 }],
      ]),
    );
    await runtime.close();
  });

  it("immediate same-turn close is clean — the deferred connect never runs on a torn collection (F4)", async () => {
    let seedStarted = false;
    const runtime = implementSurface(surface, {
      collections: {
        items: derived.collection(
          source({
            read: () => {
              seedStarted = true;
              return Promise.resolve(new Map<string, { n: number }>());
            },
            install: () => () => {},
          }),
        ),
      },
    });
    // Close in the SAME TURN — this synchronously aborts the connector and disposes
    // the collection BEFORE the deferred connect microtask runs. That microtask must
    // observe the abort and no-op; otherwise it calls `connect()` on a torn
    // collection ("connect() after dispose()") and faults `done` on a clean close.
    const closeP = runtime.close();
    await flush(); // drain the deferred connect microtask
    await expect(closeP).resolves.toBeUndefined();
    await expect(runtime.done).resolves.toBeUndefined(); // clean, not a fault
    expect(seedStarted).toBe(false); // connect was skipped — the seed never started
  });

  it("is graph-owned: ctx upsert/remove throw (the reconciler is the one writer)", async () => {
    const runtime = implementSurface(surface, {
      collections: {
        items: derived.collection(
          source({
            read: () => Promise.resolve(new Map<string, { n: number }>()),
            install: () => () => {},
          }),
        ),
      },
    });
    await flush();
    expect(() => runtime.ctx.collections.items.upsert("x", { n: 1 })).toThrow(
      /graph-owned/,
    );
    expect(() => runtime.ctx.collections.items.remove("x")).toThrow(
      /graph-owned/,
    );
    await runtime.close();
  });

  it("boot narrowing: a derived collection declaring a wire WRITE verb crashes at wiring", () => {
    // A derived collection is wire-read-only (its reconciler is the one writer); a
    // declared `upsert`/`delete` wire verb would let a client publish a value the
    // graph never derived — a second writer. Crash at boot, mirroring derived cells.
    const writeSurface = defineSurface({
      collections: {
        items: {
          keySchema: z.string(),
          schema: z.object({ n: z.number() }),
          verbs: ["keys", "get", "upsert", "delete"],
        },
      },
    });
    expect(() =>
      implementSurface(writeSurface, {
        collections: {
          items: derived.collection(
            source({
              read: () => Promise.resolve(new Map<string, { n: number }>()),
              install: () => () => {},
            }),
          ),
        },
      }),
    ).toThrow(/wire-read-only/);
  });

  it("an unchanged tick reconciles to NOTHING — same map in, no key churn (equals dedup)", async () => {
    // A poll read that keeps yielding the SAME content (fresh object refs, equal
    // `.n`) must not churn the collection: the reconciler's `equals` diff drops it.
    let table = new Map<string, { n: number }>([["a", { n: 1 }]]);
    let tick!: () => void;
    const runtime = implementSurface(surface, {
      collections: {
        items: derived.collection(
          source({
            read: () => Promise.resolve(new Map(table)),
            install: (t) => {
              tick = t;
              return () => {};
            },
          }),
        ),
      },
    });
    await flush();
    const afterSeed = runtime.ctx.collections.items.readAll();
    // Same content, fresh object references — equal by `.n`.
    table = new Map([["a", { n: 1 }]]);
    tick();
    tick();
    await flush();
    // The reconciler held: content is unchanged (an equals-changed value WOULD have
    // replaced it — see the reconcile test above).
    expect(runtime.ctx.collections.items.readAll()).toEqual(afterSeed);
    // A genuinely changed value still lands, proving the tick loop is live.
    table = new Map([["a", { n: 2 }]]);
    tick();
    await flush();
    expect(runtime.ctx.collections.items.readAll()).toEqual(
      new Map([["a", { n: 2 }]]),
    );
    await runtime.close();
  });
});

describe("everyMsOr — the fused interval + edge cadence", () => {
  // These pin the graduated cadence fuse at its HOME (SR8.c): the interval+edge
  // `install` moved here out of kolu-server's app-local `everyMsOrOnState` twin, and
  // its contract — edge-fire, unref'd interval, both-teardown — is asserted where it
  // lives. Fake timers are scoped to this block so the async poll-source tests above
  // keep their real-timer `flush`.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the tick when the subscribed edge fires (the force-resample), not just on the interval", () => {
    let fireEdge!: () => void;
    const subscribe = (tick: () => void): (() => void) => {
      fireEdge = tick;
      return () => {};
    };
    const tick = vi.fn();

    const cleanup = everyMsOr(5_000, subscribe)(tick);

    // No interval elapsed yet — but an edge force-resamples immediately.
    expect(tick).not.toHaveBeenCalled();
    fireEdge();
    expect(tick).toHaveBeenCalledTimes(1);

    // The interval still ticks independently.
    vi.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(2);
    fireEdge();
    expect(tick).toHaveBeenCalledTimes(3);

    cleanup?.();
  });

  it("the interval is unref'd so a live sampler never holds the process open on its own", () => {
    const unref = vi.fn();
    const setInterval = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref } as unknown as ReturnType<
        typeof globalThis.setInterval
      >);

    const cleanup = everyMsOr(5_000, () => () => {})(() => {});
    expect(setInterval).toHaveBeenCalledOnce();
    expect(unref).toHaveBeenCalledOnce();

    cleanup?.();
    setInterval.mockRestore();
  });

  it("cleanup unsubscribes the edge AND clears the interval — both, not one", () => {
    const off = vi.fn();
    const subscribe = vi.fn((_tick: () => void) => off);
    const tick = vi.fn();

    const cleanup = everyMsOr(5_000, subscribe)(tick);
    expect(subscribe).toHaveBeenCalledOnce();

    cleanup?.();
    // The subscription is torn down …
    expect(off).toHaveBeenCalledOnce();
    // … and the interval no longer fires the tick.
    vi.advanceTimersByTime(20_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
