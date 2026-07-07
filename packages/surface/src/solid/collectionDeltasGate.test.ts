/**
 * The whole-collection `.use()` deltas/per-key gate must decide from the SPEC's
 * verbs, NOT by probing `(ns as any).deltas` on the link. A real oRPC WIRE
 * client (`websocketLink`/`stdioLink`/`unixSocketLink`) is a lazy Proxy whose
 * every property access returns a truthy callable, so a transport-level probe is
 * `true` for EVERY collection — it would route a non-opted whole-collection
 * `.use()` into a `deltas` call the server never registered, the stream would
 * reject, and the collection would silently read empty. This pins the gate to
 * the spec: a collection WITHOUT the `deltas` verb takes the per-key keys-stream
 * path even when the link proxy makes `ns.deltas` truthy; one WITH it takes the
 * single batched stream. (A stub object link can't catch this — only a proxy
 * that's truthy for absent properties, like the wire client, reproduces it.)
 */

import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type CollectionDeltasMsg, defineSurface } from "../define";
import { surfaceClient } from "./surfaceClient";
import { useCollectionDeltas } from "./useCollection";

const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

const surface = defineSurface({
  collections: {
    // Default verbs — NOT opted into `deltas`.
    plain: { keySchema: z.string(), schema: z.object({ v: z.number() }) },
    // Opted into the batched stream.
    batched: {
      keySchema: z.string(),
      schema: z.object({ v: z.number() }),
      verbs: ["keys", "get", "upsert", "delete", "deltas"],
    },
  },
});

/** A link that mimics the oRPC WIRE client: `surface[key][verb]` is truthy for
 *  ANY verb. `keys`/`deltas` yield one empty frame so a subscription settles;
 *  every other property is a truthy callable (the hazard the gate must ignore). */
function wireProxyLink() {
  const yieldOnce =
    <T>(v: T) =>
    () =>
      Promise.resolve(
        (async function* () {
          yield v;
        })(),
      );
  const verbProxy = () =>
    new Proxy(
      {},
      {
        get(_t, verb: string) {
          if (verb === "keys") return yieldOnce<string[]>([]);
          if (verb === "deltas")
            return yieldOnce({ kind: "snapshot", entries: [] });
          // Any other property: a truthy callable — exactly what a wire client's
          // recursive Proxy returns, and exactly what the old gate mis-read.
          return () => Promise.resolve();
        },
      },
    );
  return { surface: new Proxy({}, { get: () => verbProxy() }) };
}

/** A controllable snapshot-then-delta source: each `push` feeds one frame to the
 *  single batched stream `useCollectionDeltas` folds, so the test can observe the
 *  `byKey` contract step by step. The iterator never completes (mirrors a live
 *  stream); the createRoot dispose tears the subscription down. */
function pushableFrames<T>() {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<T>> {
          while (queue.length === 0) {
            await new Promise<void>((r) => {
              wake = r;
            });
          }
          return { value: queue.shift() as T, done: false };
        },
      };
    },
  };
  return {
    source: () => Promise.resolve(iterable),
    push(frame: T) {
      queue.push(frame);
      wake?.();
      wake = null;
    },
  };
}

describe("collection deltas — byKey contract over the single batched stream", () => {
  it("byKey reads value/absent/removed like the per-key path, with collection-wide error()/pending()", async () => {
    type V = { v: number };
    await createRoot(async (dispose) => {
      const { source, push } = pushableFrames<CollectionDeltasMsg<string, V>>();
      const view = useCollectionDeltas<"batched", string, V>(
        // biome-ignore lint/suspicious/noExplicitAny: descriptor is a runtime type-discriminator only
        (surface.descriptors.collections as any).batched,
        { source },
      );

      // Snapshot establishes one present key; an absent key reads `undefined`
      // (NOT a live accessor) — the contract the per-key path also holds.
      push({ kind: "snapshot", entries: [["a", { v: 1 }]] });
      await settle();
      expect(view.byKey("a")?.()).toEqual({ v: 1 });
      expect(view.byKey("absent")).toBeUndefined();

      // A delta upsert makes a previously-absent key present and readable.
      push({ kind: "delta", upserts: [["b", { v: 2 }]], removes: [] });
      await settle();
      expect(view.byKey("b")?.()).toEqual({ v: 2 });

      // error()/pending() are the SINGLE batched stream's — collection-wide and
      // shared across keys, NOT per-key (the documented divergence the byKey
      // receptacle now spells out). Two present keys share the same accessors.
      const a = view.byKey("a");
      const b = view.byKey("b");
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a?.error).toBe(b?.error);
      expect(a?.pending).toBe(b?.pending);

      // A delta remove returns the key to `undefined`, same as the per-key path.
      push({ kind: "delta", upserts: [], removes: ["a"] });
      await settle();
      expect(view.byKey("a")).toBeUndefined();
      expect(view.byKey("b")?.()).toEqual({ v: 2 });

      dispose();
    });
  });
});

describe("collection deltas — opt-in gate reads the spec, not the link proxy", () => {
  it("a non-opted collection takes the per-key path even when ns.deltas is truthy", async () => {
    await createRoot(async (dispose) => {
      // biome-ignore lint/suspicious/noExplicitAny: proxy link stands in for the typed wire ContractRouterClient.
      const app = surfaceClient(surface, wireProxyLink() as any);
      app.collections.plain.use({});
      app.collections.batched.use({});
      await settle();

      const names = app.health().subs.map((s) => s.name);
      // plain (no `deltas` verb) → the per-key keys-stream, never the batched one.
      expect(names).toContain("plain.keys");
      expect(names).not.toContain("plain.deltas");
      // batched (opted in) → the single folded deltas sub, never the keys-stream.
      expect(names).toContain("batched.deltas");
      expect(names).not.toContain("batched.keys");
      dispose();
    });
  });
});

/** A controllable async-iterable source, for driving a REAL upstream fault through the
 *  exact `createSubscription` catch path a live stream error takes (as opposed to just
 *  asserting on a thrown-or-not registration call): `push` delivers a frame to any
 *  pending `next()` (or queues it for the next call); `fail` rejects the next `next()`
 *  (or the currently-pending one) with the given error. Mirrors a real stream in that an
 *  errored iterator never restarts — `createSubscription`'s consumption loop exits for
 *  good once `next()` rejects once. */
function controllableStream<T>() {
  const queue: T[] = [];
  let waiter: {
    resolve: (r: IteratorResult<T>) => void;
    reject: (e: unknown) => void;
  } | null = null;
  let pendingFailure: { e: unknown } | undefined;

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (pendingFailure) {
            const { e } = pendingFailure;
            pendingFailure = undefined;
            return Promise.reject(e);
          }
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift() as T, done: false });
          }
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            waiter = { resolve, reject };
          });
        },
      };
    },
  };

  return {
    source: () => Promise.resolve(iterable),
    push(v: T) {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w.resolve({ value: v, done: false });
      } else {
        queue.push(v);
      }
    },
    fail(e: unknown) {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w.reject(e);
      } else {
        pendingFailure = { e };
      }
    },
  };
}

/** A `plain`-collection link whose `keys` stream and each per-key `get` stream are
 *  independently controllable — lets a test drive a real collection-level error (the
 *  keys stream faulting) or a real per-key value-stream error, distinctly and on
 *  demand, over the exact two error channels the whole-collection `.use()` dedup
 *  branch wires its shared `onError` dispatcher into. `batched.deltas` is a silent,
 *  immediately-ending stub — only exercised here for the "distinct collection takes
 *  its own first onError, no interaction with `plain`'s registry" case. */
function faultablePlainLink() {
  const keys = controllableStream<string[]>();
  const values = new Map<
    string,
    ReturnType<typeof controllableStream<{ v: number }>>
  >();
  function valueStream(key: string) {
    let s = values.get(key);
    if (!s) {
      s = controllableStream<{ v: number }>();
      values.set(key, s);
    }
    return s;
  }
  return {
    link: {
      surface: {
        plain: {
          keys: keys.source,
          get: (input: { key: string }) => valueStream(input.key).source(),
          upsert: () => Promise.resolve(),
          delete: () => Promise.resolve(),
        },
        batched: {
          deltas: () => Promise.resolve((async function* () {})()),
        },
      },
    },
    pushKeys: (ks: string[]) => keys.push(ks),
    failKeys: (e: unknown) => keys.fail(e),
    pushValue: (key: string, v: { v: number }) => valueStream(key).push(v),
    failValue: (key: string, e: unknown) => valueStream(key).fail(e),
  };
}

describe("collection onError — per-consumer registry: every handler fires, none dropped", () => {
  it("bare + identical + a DIFFERENT second onError all SHARE one slot (no throw); both distinct handlers fire", async () => {
    await createRoot(async (dispose) => {
      const { link, failKeys } = faultablePlainLink();
      // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed wire client.
      const app = surfaceClient(surface, link as any);
      const fires1: Error[] = [];
      const fires2: Error[] = [];
      const onError1 = (e: Error) => fires1.push(e);
      const onError2 = (e: Error) => fires2.push(e);

      // First consumer registers onError1 into the shared slot.
      expect(() =>
        app.collections.plain.use({ onError: onError1 }),
      ).not.toThrow();
      // A second consumer with NO onError shares fine (registers nothing).
      expect(() => app.collections.plain.use({})).not.toThrow();
      // A second consumer with the IDENTICAL handler shares fine — refcounted, so it
      // still fires exactly once per error (not twice) below.
      expect(() =>
        app.collections.plain.use({ onError: onError1 }),
      ).not.toThrow();
      // A second consumer with a DIFFERENT onError now SHARES too (no throw) — the old
      // throw's own message named the fix (per-consumer wiring); it's now built, so a
      // divergent handler is simply ADDED to the slot's registry alongside the first.
      expect(() =>
        app.collections.plain.use({ onError: onError2 }),
      ).not.toThrow();

      await settle();
      // The keys stream is built EAGERLY (inside the shared slot's factory, at the
      // first `.use()`), so faulting it needs no `byKey` read to force anything alive.
      failKeys(new Error("boom"));
      await settle();

      // BOTH the first and the divergent second handler fired — neither was dropped
      // (the silent-drop defect the old throw guarded against, now actually fixed
      // instead of refused). The identical-ref registration above did NOT double-fire.
      expect(fires1.length).toBe(1);
      expect(fires2.length).toBe(1);

      // A DISTINCT collection with no prior registration takes its own first onError,
      // independent of `plain`'s registry.
      expect(() =>
        app.collections.batched.use({ onError: onError2 }),
      ).not.toThrow();
      dispose();
    });
  });

  it("REVERSE order: a bare .use() FIRST then a handler .use() now SHARES (no throw) — order no longer matters", async () => {
    await createRoot(async (dispose) => {
      const { link, failKeys } = faultablePlainLink();
      // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed wire client.
      const app = surfaceClient(surface, link as any);
      const fires: Error[] = [];
      const handler = (e: Error) => fires.push(e);

      // The trap the multi-host membership strip hit at runtime: a BARE consumer
      // (`HostSelectorStrip`'s `<For>`) baked the shared slot with NO onError FIRST, then
      // the HANDLER consumer (`wire.ts`'s reconcile sub) added one SECOND. That used to
      // THROW (order-asymmetric — handler-first-then-bare shared fine, the reverse
      // didn't); now both orders just register, so co-consumers no longer need to
      // coordinate on a shared handler reference to avoid a crash.
      app.collections.plain.use({});
      expect(() =>
        app.collections.plain.use({ onError: handler }),
      ).not.toThrow();

      await settle();
      failKeys(new Error("boom"));
      await settle();
      expect(fires.length).toBe(1);
      dispose();
    });
  });
});

describe("collection onError — three consumers, three handlers, per-owner unregister", () => {
  it("all three fire on a collection error; disposing one consumer's owner stops JUST its handler", async () => {
    await createRoot(async (dispose) => {
      const { link, pushKeys, failValue } = faultablePlainLink();
      // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed wire client.
      const app = surfaceClient(surface, link as any);

      const fires1: Error[] = [];
      const fires2: Error[] = [];
      const fires3: Error[] = [];
      const onError1 = (e: Error) => fires1.push(e);
      const onError2 = (e: Error) => fires2.push(e);
      const onError3 = (e: Error) => fires3.push(e);

      // Consumers 1 and 3 live for the whole test (attached to the outer root, disposed
      // only at the very end). Consumer 2 gets its OWN nested root so it can be disposed
      // independently, mid-test, without touching the other two.
      const view1 = app.collections.plain.use({ onError: onError1 });
      let disposeConsumer2 = (): void => {};
      createRoot((d) => {
        disposeConsumer2 = d;
        app.collections.plain.use({ onError: onError2 });
      });
      app.collections.plain.use({ onError: onError3 });

      await settle();
      pushKeys(["k1", "k2"]);
      await settle();
      // Per-key value subs are created LAZILY on the first `byKey` read — force BOTH
      // k1 and k2 into existence so each can independently fault below.
      view1.byKey("k1");
      view1.byKey("k2");
      await settle();

      // A real collection error (k1's per-key value stream faults) reaches ALL three —
      // however many consumers there are, all registered handlers fire.
      failValue("k1", new Error("boom-1"));
      await settle();
      expect(fires1.length).toBe(1);
      expect(fires2.length).toBe(1);
      expect(fires3.length).toBe(1);

      // Dispose consumer 2's own reactive owner — its handler unregisters from the
      // shared slot's registry, independent of the slot's own (still-live) lifetime.
      disposeConsumer2();

      // A second, INDEPENDENT fault (k2's value stream — a distinct subscription; k1's
      // already-errored one never restarts) now reaches only the two SURVIVING
      // consumers — consumer 2's handler does not fire again.
      failValue("k2", new Error("boom-2"));
      await settle();
      expect(fires1.length).toBe(2);
      expect(fires2.length).toBe(1); // unchanged — unregistered on its owner's disposal
      expect(fires3.length).toBe(2);

      dispose();
    });
  });
});
