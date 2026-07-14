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

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import {
  batch,
  computed,
  derived,
  type DerivedComputeCell,
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
    dc.connect(ctx);
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
    dc.connect(ctx);
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

    dc.connect({ set: () => {} });
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
    dc.connect(ctx);
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
});
