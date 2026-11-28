/**
 * padi's owner-less ask: a procedure called from a `createEffect` APPLY arm,
 * before any membership frame has landed.
 *
 * The shape this pins is the one padi really has. A component mounts, an effect's
 * apply arm runs in the effect phase — which carries no reactive owner — and it
 * asks the entry something straight away, while the map's `entries` membership
 * subscription is still in flight. Three things must hold, and each is a separate
 * decision in `client.ts`:
 *
 * - `entry(key)` outside an owner reads NO membership id (`client.ts:1058`), so it
 *   routes onto the `#pending` per-key client. That client is total, not a
 *   placeholder: the wire folds the key by its ENCODING, never by the id, so the
 *   ask reaches the right session on the first try — exactly ONE dispatch, no
 *   wait-for-membership retry and no second ask.
 * - The answer arrives, over the real served map, with no membership frame
 *   anywhere in its path.
 * - When the first frame lands, the real id's client SUPERSEDES the pending one
 *   (`client.ts:954`), and supersession is pure cleanup: it re-asks nothing. The
 *   ask count is still one after the pending client has been disposed.
 *
 * `useEntry` cannot stand in for this: it THROWS without an owner
 * (`client.ts:1098`), which is the whole reason the pure `entry(key)` lens exists.
 */

import { defineSurface } from "@kolu/surface/define";
import { brandDirectDispatch } from "@kolu/surface/link";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface } from "@kolu/surface/server";
import { Effect, Schema } from "effect";
import {
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  untrack,
} from "solid-js";
import { describe, expect, it } from "vitest";
import { connectSurfaceMap } from "./client";
import {
  A,
  buildTestMap,
  connected,
  HostKeySchema,
  identityCodec,
  makeRegistry,
  settle,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";

/** A padi-shaped entry: one procedure the UI asks the moment it mounts. */
const askSurface = defineSurface({
  procedures: {
    ask: {
      question: {
        input: Schema.Struct({ prompt: Schema.String }),
        output: Schema.Struct({ answer: Schema.String }),
      },
    },
  },
});

/** The entry's own served dispatch, counting how many times the question
 *  actually reached the SERVER — the upstream twin of the per-key dispatch
 *  counter below, so "one dispatch" cannot be one dispatch fanned into two asks. */
function buildAskEntry() {
  let served = 0;
  const { handlers } = implementSurface(askSurface, {
    procedures: {
      ask: {
        question: ({ input }) => {
          served++;
          return Effect.succeed({ answer: `re:${input.prompt}` });
        },
      },
    },
  });
  return { dispatch: directDispatch({ handlers }), servedAsks: () => served };
}

/** The map, its registry, and a map-level dispatch that counts every unary ask
 *  crossing the wire — whichever per-key client issued it. */
function setup() {
  const map = buildTestMap({
    key: HostKeySchema,
    entry: askSurface,
    codec: identityCodec,
  });
  const reg = makeRegistry();
  const base = directDispatch(serveSurfaceMap(map, reg.registry));
  let asks = 0;
  // The counting wrapper is re-branded: `connectSurfaceMap` refuses any transport
  // that is neither a branded live handle nor an in-process direct dispatch, and
  // wrapping erases the brand this one really still carries.
  const mapDispatch = brandDirectDispatch({
    unary: (tag: string, payload: unknown) => {
      if (tag.endsWith("/ask/question")) asks++;
      return base.unary(tag, payload);
    },
    stream: base.stream,
  }) as typeof base;
  return { map, mapDispatch, reg, asks: () => asks };
}

describe("a procedure asked from an apply arm, before any membership frame", () => {
  it("asks once on the #pending client, answers, and the real id supersedes it with no second ask", async () => {
    const { map, mapDispatch, reg, asks } = setup();
    const entry = buildAskEntry();
    // The session exists SERVER-side from the start; what has not happened yet is
    // the client's first `entries` membership frame. That gap is the whole case.
    reg.addSession(A, entry.dispatch, connected(0));

    await createRoot(async (dispose) => {
      const client = connectSurfaceMap(map, mapDispatch);

      const [mounted] = createSignal(true);
      let stateInArm: string | undefined;
      let ownedInArm: boolean | undefined;
      let asksAtArm: number | undefined;
      let answer: Promise<{ readonly answer: string }> | undefined;
      createEffect(
        () => mounted(),
        () => {
          const e = client.entry(A);
          // The apply arm carries no owner — this is padi's real position, and it
          // is what sends `entry(key)` down the owner-free `#pending` route.
          ownedInArm = getOwner() !== null && getOwner() !== undefined;
          // No membership frame yet: the key is not in the keyset at all. The read
          // is DELIBERATELY one-time — an apply arm is imperative, and Solid 2
          // raises STRICT_READ_UNTRACKED for a bare reactive read there — so it is
          // spelled `untrack`, which is what marks a point read as intentional.
          // `state()` stays fully reactive for its tracked callers; only this call
          // site says it wants the value now.
          stateInArm = untrack(() => e.state()).kind;
          asksAtArm = asks();
          answer = Effect.runPromise(
            e.procedures.ask.question({ prompt: "p" }),
          );
        },
      );
      // A TRACKED, owner-bearing read beside it: it keys on the membership id, so
      // once the first frame lands `clientFor` builds the authoritative client and
      // disposes the `#pending` one it supersedes. (Tracked is also what holds the
      // per-key status subscription open long enough for its frame to arrive — a
      // point read's throwaway owner releases it in the same tick.)
      let settled: string | undefined;
      createEffect(
        () => client.entry(A).state().kind,
        (kind) => {
          settled = kind;
        },
      );

      await settle();

      expect(ownedInArm).toBe(false);
      expect(stateInArm).toBe("not-a-member");
      expect(asksAtArm).toBe(0); // the arm ran before anything else asked
      expect(await answer).toEqual({ answer: "re:p" });
      expect(asks()).toBe(1);
      expect(entry.servedAsks()).toBe(1);
      expect(settled).toBe("connected");
      // Supersession is cleanup: a further settle re-asks nothing.
      await settle();
      expect(asks()).toBe(1);
      expect(entry.servedAsks()).toBe(1);

      dispose();
    });
  });
});
