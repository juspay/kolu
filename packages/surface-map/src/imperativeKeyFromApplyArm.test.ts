/**
 * The IMPERATIVE member walk resolves the active key as a point-in-time sample.
 *
 * `useEntry(keyAccessor)`'s walk has two halves. `.use()` opens a subscription
 * under a keyed root, which re-keys when the key changes — that half IS the
 * dependency. The other half is imperative: a collection's `upsert`/`delete`,
 * and the raw un-enrolled refs (`collections.<k>.unenrolledKeys`,
 * `streams.<k>.unenrolled`) kolu hands to `unenrolledStreamCall`. A call on
 * that half goes to the key active when the call is made and must enrol
 * nobody, which is what `client.ts`'s `untrack` around the walk says.
 *
 * Two consequences, one per case below.
 *
 * - **A raw ref is re-read inside `Stream.suspend`.** `unenrolledStreamCall`
 *   wraps the ref so every subscribe and every retry calls it again, under the
 *   effect-ts fiber of whichever effect callback opened the subscription — the
 *   terminal re-attach and the Code tab's change pulses are both that shape. An
 *   effect callback is a strict-read window, so a bare key read there is
 *   `STRICT_READ_UNTRACKED`; kolu's own key is the active-host pref
 *   (`wire.ts`'s `kolu-active-host`). The setup file fails a test on any Solid
 *   diagnostic, so case 1 states no assertion for that; what it asserts is that
 *   the sampled call still reached the member.
 * - **A call from a TRACKED caller must not subscribe it.** Case 2 calls the
 *   same ref from a memo and moves the key: the memo must not recompute. That is
 *   the consumer-visible half — without the sample, taking a raw ref inside any
 *   computation would make that computation a reader of the active key and
 *   re-run it on every host switch, on top of the re-key the keyed root already
 *   performs.
 */

import { unenrolledStreamCall } from "@kolu/surface/client";
import { directDispatch } from "@kolu/surface/links/direct";
import { Effect, Option, Stream } from "effect";
import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { connectSurfaceMap } from "./client";
import {
  A,
  B,
  buildTestMap,
  connected,
  entrySurface,
  HostKeySchema,
  identityCodec,
  makeEntry,
  makeRegistry,
  settle,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";

/** The served map, with both keys already members. `connectSurfaceMap` is left
 *  to each case, which opens it INSIDE its own root: the client builds owned
 *  computations, and one built outside a reactive owner is `NO_OWNER_EFFECT`. */
function served() {
  const map = buildTestMap({
    key: HostKeySchema,
    entry: entrySurface,
    codec: identityCodec,
  });
  const reg = makeRegistry();
  for (const key of [A, B])
    reg.addSession(
      key,
      makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch,
      connected(0),
    );
  return { map, dispatch: directDispatch(serveSurfaceMap(map, reg.registry)) };
}

/** The raw un-enrolled keys ref of one entry's `terminals` collection — the
 *  imperative half of the walk, typed as the streaming procedure
 *  `unenrolledStreamCall` takes. */
type KeysRef = () => Stream.Stream<readonly string[], unknown>;

describe("the imperative member walk samples the active key", () => {
  it("takes a raw ref from an effect callback and routes it to the key active then", async () => {
    const { map, dispatch } = served();

    await createRoot(async (dispose) => {
      const client = connectSurfaceMap(map, dispatch);
      const [key] = createSignal(A, { name: "activeMapKey" });
      const entry = client.useEntry(key);

      let opened: Promise<readonly string[] | undefined> | undefined;
      createEffect(
        () => true,
        () => {
          // Exactly kolu's shape: the ref is a property read (it reads no key),
          // and the CALL — which does read the key — happens inside the fence's
          // `Stream.suspend`, run here on the effect callback's own fiber.
          const ref = entry.collections.terminals
            .unenrolledKeys as unknown as KeysRef;
          opened = Effect.runPromise(
            Stream.runHead(unenrolledStreamCall(ref, undefined)).pipe(
              Effect.map(Option.getOrUndefined),
            ),
          );
        },
      );

      await settle();
      // The served entry holds no terminals, so the first keys frame is the
      // empty snapshot — the member answering, not a stream that never ran.
      expect(await opened).toEqual([]);

      dispose();
    });
  });

  it("does not subscribe a tracked caller to the key", async () => {
    const { map, dispatch } = served();

    await createRoot(async (dispose) => {
      const client = connectSurfaceMap(map, dispatch);
      const [key, setKey] = createSignal(A, { name: "activeMapKey" });
      const entry = client.useEntry(key);

      let runs = 0;
      const ref = createMemo(
        () => {
          runs++;
          return (
            entry.collections.terminals.unenrolledKeys as unknown as KeysRef
          )();
        },
        { name: "rawKeysRef" },
      );
      ref();
      await settle();
      expect(runs).toBe(1);

      // A host switch re-keys the `.use()` subscriptions through the keyed root;
      // a memo that merely TOOK a raw ref is not a reader of the key and must
      // stay put.
      setKey(B);
      await settle();
      ref();
      expect(runs).toBe(1);

      dispose();
    });
  });
});
