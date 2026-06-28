/**
 * A served collection's `keys` stream must broadcast a MEMBERSHIP delta to an
 * already-subscribed consumer when a key is added (or removed) AFTER it
 * subscribed — even when the collection's backing inserted that key OUT-OF-BAND.
 *
 * This pins the registry-projection case that a Map-backed test misses. kolu's
 * `awareness` / `authored` / `daemonStatus` collections are projections of a
 * registry: their `upsert` dep is a NO-OP, and the entry is added to the registry
 * BEFORE the publishing `ctx.collections.X.upsert(k, v)` is called. So at publish
 * time `readAll().has(k)` is ALREADY true — a "new key?" test taken against the
 * store before `upsert` reads the key as pre-existing and never fires the keys
 * snapshot, so a cross-process `keys` consumer (a `mirrorRemoteSurface` mirror)
 * subscribed before the add never learns the key exists. (kolu's own client dodges
 * it by sourcing membership from a sibling and reading per-key values, so the bug
 * stays latent until a consumer mirrors the `keys` stream generically.) The fix
 * tracks the framework's own broadcast set, so the membership snapshot fires on a
 * key's first upsert regardless of the backing.
 *
 * The default per-key `keys`/`get` path is exercised here (no `deltas` verb), so
 * this is the path every collection consumer uses.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import { implement } from "@orpc/server";
import { type Channel, implementSurface, inMemoryChannel } from "./server";

const surface = defineSurface({
  collections: {
    items: {
      keySchema: z.number(),
      schema: z.object({ name: z.string() }),
    },
  },
});

/**
 * Serve `items` as a REGISTRY PROJECTION — exactly kolu's pattern: an external
 * `registry` Map the test mutates directly is the store, `readAll` projects it,
 * and `upsert`/`remove` are NO-OPS (the registry is the authority; the framework
 * call only fans out to subscribers). `add(k, v)` reproduces kolu's
 * `installAwareness` ordering: insert into the registry FIRST, THEN publish.
 */
function serveRegistryBacked(
  /** Keys ALREADY in the backing store at `implementSurface` time — preloaded
   *  out-of-band, NOT through `ctx.collections.items.upsert`. Models a registry
   *  that already holds entries when kolu builds its surface server. */
  preload?: ReadonlyArray<readonly [number, { name: string }]>,
) {
  const registry = new Map<number, { name: string }>(preload);
  const { router, ctx } = implementSurface(surface, {
    channel: <T>(_name: string): Channel<T> => inMemoryChannel<T>(),
    collections: {
      items: {
        readAll: () => registry,
        upsert: () => {},
        remove: () => {},
      },
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: documented fragment→client cast — the implementSurface router's Lazy<Router> spread isn't accepted by directLink's input type; the runtime shape is valid.
  const wrapped = implement(surface.contract).router({ ...router }) as any;
  const client = directLink<typeof surface.contract>(wrapped);
  return {
    registry,
    client,
    /** Born like a kolu terminal: registry entry first, then the publish. */
    add(key: number, name: string): void {
      registry.set(key, { name });
      ctx.collections.items.upsert(key, { name });
    },
    /** Dropped like a kolu terminal: registry entry gone first, then the publish. */
    drop(key: number): void {
      registry.delete(key);
      ctx.collections.items.remove(key);
    },
  };
}

/** Subscribe `items.keys` and collect every yielded key-set into `out`. */
function watchKeys(
  client: ReturnType<typeof serveRegistryBacked>["client"],
  out: number[][],
): AbortController {
  const ac = new AbortController();
  void (async () => {
    try {
      const stream = await client.surface.items.keys({}, { signal: ac.signal });
      for await (const keys of stream) out.push([...keys]);
    } catch {
      /* aborted on teardown */
    }
  })();
  return ac;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("served collection keys-stream — membership for a registry-backed projection", () => {
  it("broadcasts a key added AFTER a consumer subscribed (the registry-projection membership bug)", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a"); // a terminal present before the consumer connects

    const seen: number[][] = [];
    const ac = watchKeys(kolu.client, seen);
    await flush();
    // The connect snapshot carries the pre-existing key.
    expect(seen.at(-1)).toEqual([1]);

    // A SECOND terminal is born after the consumer subscribed — registry-first,
    // then publish (kolu's `installAwareness` ordering). Without the fix the
    // keys-set delta is suppressed and the consumer is stuck at [1].
    kolu.add(2, "b");
    await flush();
    expect(seen.at(-1)?.sort()).toEqual([1, 2]);

    // A third, to be sure it isn't a one-off.
    kolu.add(3, "c");
    await flush();
    expect(seen.at(-1)?.sort()).toEqual([1, 2, 3]);

    ac.abort();
  });

  it("broadcasts a removal to an already-subscribed consumer", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");
    kolu.add(2, "b");

    const seen: number[][] = [];
    const ac = watchKeys(kolu.client, seen);
    await flush();
    expect(seen.at(-1)?.sort()).toEqual([1, 2]);

    kolu.drop(1); // registry entry gone, then publish
    await flush();
    expect(seen.at(-1)).toEqual([2]);

    ac.abort();
  });

  it("does NOT re-broadcast the key set on a no-op remove of a non-member key (the remove guard mirrors the upsert guard)", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");

    const seen: number[][] = [];
    const ac = watchKeys(kolu.client, seen);
    await flush();
    const framesAfterConnect = seen.length;

    // Drop a key that was never added/seeded: membership is unchanged, so the keys
    // stream must NOT re-yield. Without the guard the remove path would fire a
    // redundant full-snapshot, breaking the symmetry the upsert path enforces.
    kolu.drop(99);
    await flush();
    expect(seen.length).toBe(framesAfterConnect);

    // Dropping the SAME key twice: the first drop is a real membership delta, the
    // second is a no-op that must NOT re-yield.
    kolu.drop(1);
    await flush();
    expect(seen.at(-1)).toEqual([]);
    const framesAfterRealDrop = seen.length;
    kolu.drop(1);
    await flush();
    expect(seen.length).toBe(framesAfterRealDrop);

    ac.abort();
  });

  it("does NOT re-broadcast the key set on a value-only update (the optimization holds)", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");

    const seen: number[][] = [];
    const ac = watchKeys(kolu.client, seen);
    await flush();
    const framesAfterConnect = seen.length;

    // Same key, new value: membership is unchanged, so the keys stream must NOT
    // re-yield (a value-only churn can't storm keys subscribers). The value
    // travels the per-key `get` stream instead.
    kolu.add(1, "a-renamed");
    await flush();
    expect(seen.length).toBe(framesAfterConnect);

    ac.abort();
  });

  it("does NOT re-broadcast keys for a value-only update on a key PRELOADED before the server was built", async () => {
    // Key 1 is in the backing store at `implementSurface` time — it never went
    // through `ctx.collections.items.upsert`, so the framework's broadcast set
    // only knows it if it seeds from `readAll()` at construction. An empty seed
    // would treat the first value-only upsert on key 1 as a brand-new key and
    // fire a spurious full keys snapshot.
    const kolu = serveRegistryBacked([[1, { name: "a" }]]);

    const seen: number[][] = [];
    const ac = watchKeys(kolu.client, seen);
    await flush();
    // The connect snapshot still carries the preloaded key.
    expect(seen.at(-1)).toEqual([1]);
    const framesAfterConnect = seen.length;

    // A value-only update on the PRELOADED key: membership is unchanged, so the
    // keys stream must NOT re-yield even though this key never went through upsert.
    kolu.add(1, "a-renamed");
    await flush();
    expect(seen.length).toBe(framesAfterConnect);

    // A genuinely new key (not preloaded) still fires the membership delta, so the
    // seed suppresses only the redundant snapshot, never a real add.
    kolu.add(2, "b");
    await flush();
    expect(seen.at(-1)?.sort()).toEqual([1, 2]);

    ac.abort();
  });
});
