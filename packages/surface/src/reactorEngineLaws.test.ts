/**
 * The signals ENGINE's acceptance suite.
 *
 * `reactor.ts` wraps `@preact/signals-core` and names `@solidjs/signals` as the
 * swap target. These tests pin the three guarantees the reactor's design LEANS
 * ON, exercised against the raw engine — so a swap is a two-way door: a new
 * engine must make this file pass, byte for byte, before it can replace preact
 * behind `reactor.ts`. They are the reason the engine import is allowed here
 * (the one exception, beside `reactor.ts`, to `biome.jsonc`'s ban).
 *
 * The three laws:
 *   - **glitch-freedom** — a diamond recomputes its apex ONCE per frame, never
 *     transiently observing a half-updated pair.
 *   - **equality-cascade stop** — a recompute whose OUTPUT is unchanged (`===`)
 *     does not propagate; dependents don't re-run.
 *   - **disposal** — tearing down an effect stops it; a later dependency change
 *     runs nothing.
 */

import { computed, effect, batch, signal } from "@preact/signals-core";
import { describe, expect, it } from "vitest";

describe("signals engine — the reactor's swappability contract", () => {
  it("glitch-freedom: a diamond recomputes its apex once per frame", () => {
    const root = signal(1);
    const left = computed(() => root.value + 1);
    const right = computed(() => root.value * 2);
    let apexRuns = 0;
    const apex = computed(() => {
      apexRuns++;
      return left.value + right.value;
    });

    // Force initial evaluation.
    expect(apex.value).toBe(1 + 1 + 1 * 2); // 4
    const runsAfterInit = apexRuns;

    // One write touches BOTH diamond legs. A glitchy engine would recompute the
    // apex twice (once per leg) and could transiently read a half-updated pair;
    // a glitch-free one recomputes exactly once and only ever sees a coherent
    // (left, right).
    root.value = 5;
    expect(apex.value).toBe(5 + 1 + 5 * 2); // 16
    expect(apexRuns - runsAfterInit).toBe(1);
  });

  it("glitch-freedom under batch: N writes in one frame => one apex recompute", () => {
    const a = signal(0);
    const b = signal(0);
    let sumRuns = 0;
    const sum = computed(() => {
      sumRuns++;
      return a.value + b.value;
    });
    expect(sum.value).toBe(0);
    const base = sumRuns;

    batch(() => {
      a.value = 3;
      b.value = 4;
    });
    expect(sum.value).toBe(7);
    // Both writes coalesced into one frame → one recompute, never two.
    expect(sumRuns - base).toBe(1);
  });

  it("equality-cascade stop: an unchanged (===) output does not propagate", () => {
    const level = signal(10);
    // A projection whose value only flips at a threshold — many inputs, few
    // outputs. This is exactly the shape a derived cell's `equals` relies on.
    const high = computed(() => level.value >= 80);
    let downstreamRuns = 0;
    const dispose = effect(() => {
      void high.value;
      downstreamRuns++;
    });
    expect(downstreamRuns).toBe(1); // initial

    // Input changes but the projected boolean stays `false` — the cascade stops
    // at `high`, the effect does not re-run.
    level.value = 20;
    level.value = 50;
    expect(downstreamRuns).toBe(1);

    // Now the output genuinely changes → exactly one propagation.
    level.value = 90;
    expect(downstreamRuns).toBe(2);
    dispose();
  });

  it("disposal: a disposed effect runs nothing on a later dependency change", () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      void s.value;
      runs++;
    });
    expect(runs).toBe(1);
    s.value = 1;
    expect(runs).toBe(2);

    dispose();
    s.value = 2;
    s.value = 3;
    // No further runs — the effect is gone, its subscription torn down.
    expect(runs).toBe(2);
  });
});
