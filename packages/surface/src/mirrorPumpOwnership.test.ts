/**
 * PIN (ii) #1719: `mirrorRemoteSurface`'s `done` must not resolve while any
 * per-key collection value pump is still settling.
 *
 * The consumer-side half of the #1719 fix. `mirrorCollection` spawns each
 * per-key value stream as a DETACHED `void (async…)()` IIFE that was never
 * joined into the mirror's settle graph — so on teardown `done` (hence
 * `pumpRemoteSurface`'s `await mirror.done` and the loop's advance to the next
 * spawn) could resolve while a pump's `.next()` was still parked/settling. A
 * pull that then rejects has no awaiter left → the float.
 *
 * The invariant this pins — deterministic under OUR contract, not orpc's
 * microtask ordering — is: OWNERSHIP. Every per-key pump is tracked and
 * awaited before `mirrorCollection` (and thus `done`) resolves, so a pump's
 * settle is ALWAYS observed. We prove it by parking a pump, ending the keys
 * stream (which drives `mirrorCollection`'s `finally`), and asserting that by
 * the time `done` resolves the pump's own `finally` has run. RED pre-fix
 * (`done` resolves first); GREEN post-fix.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { mirrorRemoteSurface } from "./mirrorRemoteSurface";

const raceSurface = defineSurface({
  collections: {
    items: { keySchema: z.string(), schema: z.object({ v: z.number() }) },
  },
});

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
// biome-ignore lint/suspicious/noExplicitAny: structural fake mirror client.
const asClient = (c: unknown): any => c;

describe("mirrorRemoteSurface — per-key pump ownership (#1719 pin ii)", () => {
  it("done does NOT resolve until every parked per-key value pump has settled", async () => {
    const upserts: Array<[string, { v: number }]> = [];
    // The completion marker: set in the value pump's OWN `finally`, which runs
    // whether the pump ends via abort-return (this test) or a thrown pull. If
    // `done` awaits the pump (the fix), this is true when `done` resolves;
    // if the pump is abandoned (pre-fix), `done` resolves first and it is false.
    let pumpSettled = false;

    async function* valueStream(
      signal: AbortSignal,
    ): AsyncGenerator<{ v: number }> {
      yield { v: 1 };
      try {
        // Park on the next pull until the collection's `finally` aborts our ctl.
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        // A measurable microtask gap: pre-fix `done` has already resolved by
        // the time this runs; post-fix `done` is awaiting exactly this.
        await tick();
        pumpSettled = true;
      }
    }

    async function* keysStream(): AsyncGenerator<string[]> {
      yield ["a"];
      // Hold the keys stream open until the value pump has delivered its first
      // frame and PARKED — only then end it, so the collection's `finally`
      // (and the teardown race) fires against a genuinely-parked pump.
      for (let i = 0; i < 500 && upserts.length === 0; i++) await tick();
      // return → keys stream ends → `mirrorCollection`'s keysLoop finishes →
      // its `finally` aborts the per-key ctl(s).
    }

    const client = {
      surface: {
        items: {
          keys: (_input: unknown, _opts: unknown) => keysStream(),
          get: (_input: { key: string }, opts: { signal: AbortSignal }) =>
            valueStream(opts.signal),
        },
      },
    };

    // No signal — matches `pumpRemoteSurface` (`hostFanout.ts:206`).
    const { done } = mirrorRemoteSurface(raceSurface, asClient(client), {
      collections: {
        items: {
          upsert: (k, v) => upserts.push([k, v as { v: number }]),
          remove: () => {},
        },
      },
    });

    await done;
    // The load-bearing assertion: the pump's settle was OWNED — observed before
    // `done`. Pre-fix the detached pump is abandoned and this is false.
    expect(pumpSettled).toBe(true);
  }, 15000);
});
