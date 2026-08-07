/**
 * PIN (ii) #1719: `mirrorRemoteSurface`'s `done` must not resolve while any
 * per-key collection value pump is still settling.
 *
 * The consumer-side half of the #1719 fix. `mirrorCollection` used to spawn each
 * per-key value stream as a DETACHED `void (async…)()` IIFE that was never joined
 * into the mirror's settle graph — so on teardown `done` (hence
 * `pumpRemoteSurface`'s `await mirror.done` and the loop's advance to the next
 * spawn) could resolve while a pump's `.next()` was still parked/settling. A pull
 * that then rejected had no awaiter left → the float.
 *
 * The invariant this pins is: OWNERSHIP. Every per-key pump is a CHILD FIBER of
 * the keys loop's scope, so it is interrupted AND AWAITED before
 * `mirrorCollection` (and thus `done`) resolves — a pump's settle is ALWAYS
 * observed. We prove it by parking a pump on a never-ending stream, ending the
 * keys stream (which closes the collection's scope), and asserting that by the
 * time `done` resolves the pump's own finalizer has run — including a deliberate
 * async hop inside it, so "awaited" means awaited, not merely "started".
 *
 * The mechanism moved (AbortController → fiber interruption) but the test does not
 * assert the mechanism: it asserts the observable ordering, which is the law.
 */

import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import { mirrorRemoteSurface } from "./mirrorRemoteSurface";

const raceSurface = defineSurface({
  collections: {
    items: {
      keySchema: Schema.String,
      schema: Schema.Struct({ v: Schema.Number }),
    },
  },
});

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
// biome-ignore lint/suspicious/noExplicitAny: structural fake mirror client.
const asClient = (c: unknown): any => c;

describe("mirrorRemoteSurface — per-key pump ownership (#1719 pin ii)", () => {
  it("done does NOT resolve until every parked per-key value pump has settled", async () => {
    const upserts: Array<[string, { v: number }]> = [];
    // The completion marker: set in the value pump's OWN finalizer, which runs
    // whether the pump ends by interruption (this test) or by a failed pull. If
    // `done` awaits the pump (the contract), this is true when `done` resolves;
    // if the pump were abandoned, `done` would resolve first and it'd be false.
    let pumpSettled = false;
    const firstUpsert = Promise.withResolvers<void>();

    // One frame, then PARKED forever — only teardown ends this stream.
    const valueStream = Stream.ensuring(
      Stream.concat(Stream.make({ v: 1 }), Stream.never),
      // A measurable async gap inside the finalizer: an implementation that
      // merely *starts* teardown before resolving `done` fails here, only one
      // that AWAITS the pump passes.
      Effect.flatMap(Effect.promise(tick), () =>
        Effect.sync(() => {
          pumpSettled = true;
        }),
      ),
    );

    // Hold the keys stream open until the value pump has delivered its first
    // frame and parked — only then end it, so the collection's scope closes
    // against a genuinely-parked pump.
    const keysStream = Stream.concat(
      Stream.make(["a"]),
      Stream.fromEffectDrain(Effect.promise(() => firstUpsert.promise)),
    );

    const client = {
      surface: {
        items: { keys: () => keysStream, get: () => valueStream },
      },
    };

    // No signal — matches `pumpRemoteSurface` (`hostFanout.ts:206`): teardown is
    // driven by the keys stream ending, not by the caller.
    const { done } = mirrorRemoteSurface(raceSurface, asClient(client), {
      collections: {
        items: {
          upsert: (k, v) => {
            upserts.push([k, v]);
            firstUpsert.resolve();
          },
          remove: () => {},
        },
      },
    });

    await done;
    // The load-bearing assertion: the pump's settle was OWNED — observed before
    // `done`. An abandoned (detached) pump makes this false.
    expect(pumpSettled).toBe(true);
    expect(upserts).toEqual([["a", { v: 1 }]]);
  }, 15000);
});
