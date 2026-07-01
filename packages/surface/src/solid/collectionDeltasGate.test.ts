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
