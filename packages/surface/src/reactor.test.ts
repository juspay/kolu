/**
 * `reactor.ts` — the reactive bridge phase 0. These tests pin the wrapper's
 * OWN contract (source occurrences, scan's fold + prev-ref-no-publish + the
 * stop-hold error law, and `derived.cell`'s seed / connect-seam / equals dedup),
 * and the boot narrowing that keeps a derived member wire-read-only. The raw
 * engine's guarantees live in `reactorEngineLaws.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import { derived, scan, source } from "./reactor";
import type { CellStore } from "./server";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "./server";

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
      channel: inMemoryChannelByName(),
      cells: { count: derived.cell(count) },
    });
    const client = directLink<typeof surface.contract>(router);

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
        channel: inMemoryChannelByName(),
        cells: { count: derived.cell(count) },
      }),
    ).toThrow(/wire-read-only/);
  });

  it("a non-derived cell with write verbs is unaffected by the narrowing", () => {
    const surface = defineSurface({
      cells: { count: { schema: z.number(), default: 0 } },
    });
    // Plain authored cell (not derived) — narrowing does not fire.
    expect(() =>
      implementSurface(surface, {
        channel: inMemoryChannelByName(),
        cells: { count: { store: inMemoryStore(0) } },
      }),
    ).not.toThrow();
  });
});
