/**
 * The signals ENGINE's acceptance suite.
 *
 * `reactor.ts` wraps a signals engine — Effect's `Atom`/`AtomRegistry`
 * (`effect/unstable/reactivity`) today. These tests pin the guarantees the
 * reactor's design LEANS ON, exercised against the RAW engine — so a swap stays
 * a two-way door: a new engine must make this file pass before it can replace
 * the current one behind `reactor.ts`. They are the reason the engine import is
 * allowed here (the one exception, beside `reactor.ts`, to `biome.jsonc`'s ban).
 *
 * The laws:
 *   - **glitch-freedom** — a diamond recomputes its apex ONCE per frame, never
 *     transiently observing a half-updated pair. Stated twice: for an
 *     UNSUBSCRIBED apex (lazy pull gives it free) and for a SUBSCRIBED one
 *     (which this engine gives only inside a `batch` — hence the wrapper's rule
 *     that EVERY graph write opens one).
 *   - **equality-cascade stop** — a recompute whose OUTPUT is unchanged does not
 *     propagate; dependents don't re-run. Equality is `Object.is`, which the
 *     NaN law below states rather than leaves to be discovered.
 *   - **disposal** — tearing down an effect stops it; a later dependency change
 *     runs nothing.
 *   - **synchronous notification** — a subscriber has already run by the time
 *     the write returns (and by the time an enclosing `batch` returns). The
 *     graph→wire publish seam is ordered against event publishes in the same
 *     tick; an engine that deferred notification to a microtask would reorder
 *     it.
 */

import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

/** A mutable graph root, configured exactly as `reactor.ts` configures one: a
 *  writable atom that is `keepAlive`, because it carries STATE and an idle
 *  auto-disposed node would silently reset to its initial value. */
const state = <A>(initial: A): Atom.Writable<A, A> =>
  Atom.writable<A, A>(
    () => initial,
    (ctx, next) => {
      ctx.setSelf(next);
    },
  ).pipe(Atom.keepAlive);

describe("signals engine — the reactor's swappability contract", () => {
  it("glitch-freedom: a diamond recomputes its apex once per frame", () => {
    const registry = AtomRegistry.make();
    const root = state(1);
    const left = Atom.readable((get) => get(root) + 1);
    const right = Atom.readable((get) => get(root) * 2);
    let apexRuns = 0;
    const apex = Atom.readable((get) => {
      apexRuns++;
      return get(left) + get(right);
    });

    // Force initial evaluation.
    expect(registry.get(apex)).toBe(1 + 1 + 1 * 2); // 4
    const runsAfterInit = apexRuns;

    // One write touches BOTH diamond legs. A glitchy engine would recompute the
    // apex twice (once per leg) and could transiently read a half-updated pair;
    // a glitch-free one recomputes exactly once and only ever sees a coherent
    // (left, right).
    registry.set(root, 5);
    expect(registry.get(apex)).toBe(5 + 1 + 5 * 2); // 16
    expect(apexRuns - runsAfterInit).toBe(1);
  });

  it("glitch-freedom under batch: N writes in one frame => one apex recompute", () => {
    const registry = AtomRegistry.make();
    const a = state(0);
    const b = state(0);
    let sumRuns = 0;
    const sum = Atom.readable((get) => {
      sumRuns++;
      return get(a) + get(b);
    });
    expect(registry.get(sum)).toBe(0);
    const base = sumRuns;

    Atom.batch(() => {
      registry.set(a, 3);
      registry.set(b, 4);
    });
    expect(registry.get(sum)).toBe(7);
    // Both writes coalesced into one frame → one recompute, never two.
    expect(sumRuns - base).toBe(1);
  });

  it("glitch-freedom for a SUBSCRIBED apex: one recompute, one notify, no half-updated pair", () => {
    // The law the wrapper's "every write opens a batch" rule exists for. A
    // subscribed node is rebuilt EAGERLY on invalidation — outside a batch that
    // happens once per diamond leg, so the apex would both observe a
    // half-updated pair and notify twice. Inside a batch the collect/rebuild
    // pass orders parents first and notifies each node once.
    const registry = AtomRegistry.make();
    const root = state(1);
    const left = Atom.readable((get) => get(root) + 1);
    const right = Atom.readable((get) => get(root) * 2);
    const seen: number[] = [];
    const apex = Atom.readable((get) => {
      const v = get(left) + get(right);
      seen.push(v);
      return v;
    });
    let notifies = 0;
    const dispose = registry.subscribe(
      apex,
      () => {
        notifies++;
      },
      { immediate: true },
    );
    expect(seen).toEqual([4]);
    notifies = 0;

    Atom.batch(() => {
      registry.set(root, 5);
    });
    // Exactly one recompute — and its value is the coherent 16, never a
    // half-updated 6 + 2 = 8 or 2 + 10 = 12.
    expect(seen).toEqual([4, 16]);
    expect(notifies).toBe(1);
    dispose();
  });

  it("equality-cascade stop: an unchanged output does not propagate", () => {
    const registry = AtomRegistry.make();
    const level = state(10);
    // A projection whose value only flips at a threshold — many inputs, few
    // outputs. This is exactly the shape a derived cell's `equals` relies on.
    const high = Atom.readable((get) => get(level) >= 80);
    let downstreamRuns = 0;
    const dispose = registry.subscribe(
      high,
      () => {
        downstreamRuns++;
      },
      { immediate: true },
    );
    expect(downstreamRuns).toBe(1); // initial

    // Input changes but the projected boolean stays `false` — the cascade stops
    // at `high`, the effect does not re-run.
    registry.set(level, 20);
    registry.set(level, 50);
    expect(downstreamRuns).toBe(1);

    // Now the output genuinely changes → exactly one propagation.
    registry.set(level, 90);
    expect(downstreamRuns).toBe(2);
    dispose();
  });

  it("equality is Object.is: a NaN → NaN write does not propagate", () => {
    // Stated, not discovered. `Object.is(NaN, NaN)` is true, so a numeric level
    // that stays NaN publishes nothing — where an engine comparing with `!==`
    // would republish forever. Reachable through any numeric cell (an RSS
    // sample), so it belongs in the laws rather than in a bug report.
    const registry = AtomRegistry.make();
    const n = state(0);
    let runs = 0;
    const dispose = registry.subscribe(
      n,
      () => {
        runs++;
      },
      { immediate: true },
    );
    expect(runs).toBe(1);

    registry.set(n, Number.NaN);
    expect(runs).toBe(2); // 0 → NaN is a genuine change
    registry.set(n, Number.NaN);
    expect(runs).toBe(2); // NaN → NaN is not
    dispose();
  });

  it("disposal: a disposed effect runs nothing on a later dependency change", () => {
    const registry = AtomRegistry.make();
    const s = state(0);
    let runs = 0;
    const dispose = registry.subscribe(
      s,
      () => {
        runs++;
      },
      { immediate: true },
    );
    expect(runs).toBe(1);
    registry.set(s, 1);
    expect(runs).toBe(2);

    dispose();
    registry.set(s, 2);
    registry.set(s, 3);
    // No further runs — the effect is gone, its subscription torn down.
    expect(runs).toBe(2);
  });

  it("synchronous notification: a subscriber has run before the write returns", () => {
    // The publish-ordering seam. A reactor cell's wire frame is published from
    // inside a subscriber, so "two channels publishing in the same tick deliver
    // in publish order" holds only while notification is synchronous with the
    // writer. Pinned here so a future engine bump cannot make it a microtask
    // without this file going red.
    const registry = AtomRegistry.make();
    const s = state(0);
    const order: string[] = [];
    const dispose = registry.subscribe(
      s,
      () => {
        order.push("notified");
      },
      { immediate: true },
    );

    order.length = 0;
    registry.set(s, 1);
    order.push("after-set");
    expect(order).toEqual(["notified", "after-set"]);

    // Inside a batch the notification is deferred to the batch's commit — still
    // synchronous, still before `batch` returns.
    order.length = 0;
    Atom.batch(() => {
      registry.set(s, 2);
      order.push("inside-batch");
    });
    order.push("after-batch");
    expect(order).toEqual(["inside-batch", "notified", "after-batch"]);
    dispose();
  });
});
