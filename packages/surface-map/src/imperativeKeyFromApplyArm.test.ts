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
 * Three consequences, one per case below.
 *
 * - **A raw ref is re-read inside `Stream.suspend`.** `unenrolledStreamCall`
 *   wraps the ref so every subscribe and every retry calls it again, under the
 *   effect-ts fiber of whichever effect callback opened the subscription — the
 *   terminal re-attach and the Code tab's change pulses are both that shape. An
 *   effect callback is a strict-read window, so a bare key read there is
 *   `STRICT_READ_UNTRACKED`; kolu's own key is the active-host pref
 *   (`wire.ts`'s `kolu-active-host`). The setup file fails a test on any Solid
 *   diagnostic, so case 1 states no assertion for that; what it asserts is WHICH
 *   key the sampled call reached.
 * - **A call from a TRACKED caller must not subscribe it.** Case 2 calls the
 *   same ref from a memo and moves the key: the memo must not recompute. That is
 *   the consumer-visible half — without the sample, taking a raw ref inside any
 *   computation would make that computation a reader of the active key and
 *   re-run it on every host switch, on top of the re-key the keyed root already
 *   performs.
 * - **`stableKey` is read in ONE direction.** It is handed across a boundary
 *   (into the walk, and from there into every proxy it mints), so case 3 mounts
 *   the shape where two lenses' keys are PEERS: the mirror lens's key is derived
 *   from the primary's entry, and each lens makes an imperative call on the
 *   OTHER'S face from its own compute. A cycle here would throw inside Solid's
 *   flush rather than raise a diagnostic, so the case asserts the crossing stays
 *   a DAG — both directions answer, and both follow a key switch.
 */

import { unenrolledStreamCall } from "@kolu/surface/client";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
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
  type HostKey,
  HostKeySchema,
  identityCodec,
  makeRegistry,
  settle,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";

/** The one terminal each key's entry serves, so a keys frame NAMES the key the
 *  imperative call routed to rather than merely proving it answered. */
const terminalOf = (key: HostKey) => `t-${key}`;

/** An entry serving exactly one terminal, named after its key. */
function entryServing(key: HostKey) {
  const { handlers } = implementSurface(entrySurface, {
    cells: {
      urgency: { store: inMemoryStore({ awaiting: 0, awaitingIds: [] }) },
    },
    collections: {
      terminals: {
        readAll: () => new Map([[terminalOf(key), { title: key as string }]]),
        upsert: () => {},
        remove: () => {},
      },
    },
  });
  return directDispatch({ handlers });
}

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
    reg.addSession(key, entryServing(key), connected(0));
  return { map, dispatch: directDispatch(serveSurfaceMap(map, reg.registry)) };
}

/** The raw un-enrolled keys ref of one entry's `terminals` collection — the
 *  imperative half of the walk, typed as the streaming procedure
 *  `unenrolledStreamCall` takes. */
type KeysRef = () => Stream.Stream<readonly string[], unknown>;

/** The first keys frame of a raw ref's stream, as a plain array. */
const firstFrame = (
  stream: Stream.Stream<readonly string[], unknown>,
): Promise<readonly string[] | undefined> =>
  Effect.runPromise(
    Stream.runHead(stream).pipe(Effect.map(Option.getOrUndefined)),
  );

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
          opened = firstFrame(unenrolledStreamCall(ref, undefined));
        },
      );

      await settle();
      // A's own terminal, not B's: the sample reached the key that was active.
      expect(await opened).toEqual([terminalOf(A)]);

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

  it("stays a DAG when two lenses' keys are peers that read each other", async () => {
    const { map, dispatch } = served();

    await createRoot(async (dispose) => {
      const client = connectSurfaceMap(map, dispatch);
      const [primaryKey, setPrimaryKey] = createSignal(A, {
        name: "primaryMapKey",
      });
      const primary = client.useEntry(primaryKey);

      // Peer 2's KEY is derived from peer 1's entry — the boundary `stableKey`
      // is handed across, in the one direction it is read: a key flows into the
      // walk that uses it, and the walk publishes nothing the key reads back.
      const mirrorKey = createMemo(
        () =>
          primary.state().kind === "connected"
            ? primaryKey() === A
              ? B
              : A
            : primaryKey(),
        { name: "mirrorMapKey" },
      );
      const mirror = client.useEntry(mirrorKey);

      // …and each peer makes an IMPERATIVE call on the OTHER'S face from its own
      // compute. Without the sample each of these computes would also become a
      // reader of the other lens's key; with it they stay what they declare.
      const refFromMirror = createMemo(
        () => {
          mirror.state();
          mirrorKey();
          return (
            primary.collections.terminals.unenrolledKeys as unknown as KeysRef
          )();
        },
        { name: "primaryRefTakenOnTheMirrorSide" },
      );
      const refFromPrimary = createMemo(
        () => {
          primary.state();
          primaryKey();
          return (
            mirror.collections.terminals.unenrolledKeys as unknown as KeysRef
          )();
        },
        { name: "mirrorRefTakenOnThePrimarySide" },
      );

      await settle();
      expect(mirrorKey()).toBe(B);
      expect(await firstFrame(refFromMirror())).toEqual([terminalOf(A)]);
      expect(await firstFrame(refFromPrimary())).toEqual([terminalOf(B)]);

      // The switch moves BOTH keys — the primary by its signal, the mirror by
      // the derivation that reads the primary's entry — and each crossing call
      // follows its own lens.
      setPrimaryKey(B);
      await settle();
      expect(mirrorKey()).toBe(A);
      expect(await firstFrame(refFromMirror())).toEqual([terminalOf(B)]);
      expect(await firstFrame(refFromPrimary())).toEqual([terminalOf(A)]);

      dispose();
    });
  });
});
