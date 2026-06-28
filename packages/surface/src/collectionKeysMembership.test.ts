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
 * The default `keys`/`get` verbs are served here (no `deltas` opt-in), so this
 * pins the path every collection consumer uses; the assertions drive the `keys`
 * membership stream.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import { implement } from "@orpc/server";
import { implementSurface, inMemoryChannelByName } from "./server";

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
    // Canonical name-keyed in-process channels: the SAME `Channel` instance per
    // name across every call, so the per-key `get` bus and the `keys` bus each
    // bind name→instance. A bare `inMemoryChannel()` factory hands out a FRESH
    // channel per lookup, silently severing per-key publishers from subscribers
    // (the keys stream happens to survive it because `keysBus` is captured once,
    // but the `get` value path would be wired to a different bus than the
    // publisher — exactly the footgun `inMemoryPublisher`'s doc warns about).
    channel: inMemoryChannelByName(),
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

/** Subscribe `items.keys` and collect every yielded key-set into `out`. Returns
 *  the `AbortController` plus a `done` promise the test MUST await after
 *  `ac.abort()`: `done` resolves on the expected abort teardown and REJECTS on
 *  any other stream failure (route, schema, iterator), so a broken stream fails
 *  the test loudly instead of being swallowed and the test asserting on a partial
 *  frame list. */
function watchKeys(
  client: ReturnType<typeof serveRegistryBacked>["client"],
  out: number[][],
): { ac: AbortController; done: Promise<void> } {
  const ac = new AbortController();
  const done = (async () => {
    const stream = await client.surface.items.keys({}, { signal: ac.signal });
    for await (const keys of stream) out.push([...keys]);
  })().catch((err) => {
    // `ac.abort()` rejects the in-flight pull with the abort reason — expected
    // end-of-life teardown. ANY other failure is real and must surface.
    if (!ac.signal.aborted) throw err;
  });
  return { ac, done };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("served collection keys-stream — membership for a registry-backed projection", () => {
  it("broadcasts a key added AFTER a consumer subscribed (the registry-projection membership bug)", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a"); // a terminal present before the consumer connects

    const seen: number[][] = [];
    const { ac, done } = watchKeys(kolu.client, seen);
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
    await done;
  });

  it("buffers a membership add that lands in the snapshot→subscribe window", async () => {
    // The lost-update window the `deltas` handler closes with subscribe-before-
    // snapshot — pinned here for the `keys` membership stream. Drive the iterator
    // by hand so the add lands AFTER the connect snapshot is pulled but BEFORE the
    // consumer pulls again: with subscribe-AFTER-snapshot the generator hasn't
    // subscribed yet, the publish hits zero subscribers, and — a quiescent `keys`
    // stream having no later frame to self-heal from — the key is lost until the
    // next membership change or a reconnect.
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");

    const ac = new AbortController();
    const stream = await kolu.client.surface.items.keys(
      {},
      { signal: ac.signal },
    );
    const iter = stream[Symbol.asyncIterator]() as AsyncIterator<number[]>;

    // First pull: the connect snapshot. With the fix the generator is ALREADY
    // subscribed here (subscribe runs before the snapshot yield).
    const first = await iter.next();
    expect(first.value?.sort()).toEqual([1]);

    // A key born in the snapshot→next-pull window — registry-first, then publish.
    kolu.add(2, "b");

    // Second pull MUST deliver the buffered membership snapshot. Without
    // subscribe-before-snapshot this hangs (the publish was dropped and no later
    // membership change follows), so race a short timeout to fail fast and loud.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "second keys pull hung — a membership add in the snapshot→subscribe window was dropped",
            ),
          ),
        250,
      );
    });
    const second = await Promise.race([iter.next(), timeout]);
    clearTimeout(timer);
    expect(second.value?.sort()).toEqual([1, 2]);

    ac.abort();
  });

  it("broadcasts a removal to an already-subscribed consumer", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");
    kolu.add(2, "b");

    const seen: number[][] = [];
    const { ac, done } = watchKeys(kolu.client, seen);
    await flush();
    expect(seen.at(-1)?.sort()).toEqual([1, 2]);

    kolu.drop(1); // registry entry gone, then publish
    await flush();
    expect(seen.at(-1)).toEqual([2]);

    ac.abort();
    await done;
  });

  it("does NOT re-broadcast the key set on a no-op remove of a non-member key (the remove guard mirrors the upsert guard)", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");

    const seen: number[][] = [];
    const { ac, done } = watchKeys(kolu.client, seen);
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
    await done;
  });

  it("does NOT re-broadcast the key set on a value-only update (the optimization holds)", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");

    const seen: number[][] = [];
    const { ac, done } = watchKeys(kolu.client, seen);
    await flush();
    const framesAfterConnect = seen.length;

    // Same key, new value: membership is unchanged, so the keys stream must NOT
    // re-yield (a value-only churn can't storm keys subscribers). The value
    // travels the per-key `get` stream instead.
    kolu.add(1, "a-renamed");
    await flush();
    expect(seen.length).toBe(framesAfterConnect);

    ac.abort();
    await done;
  });

  it("does NOT re-broadcast keys for a value-only update on a key PRELOADED before the server was built", async () => {
    // Key 1 is in the backing store at `implementSurface` time — it never went
    // through `ctx.collections.items.upsert`, so the framework's broadcast set
    // only knows it if it seeds from `readAll()` at construction. An empty seed
    // would treat the first value-only upsert on key 1 as a brand-new key and
    // fire a spurious full keys snapshot.
    const kolu = serveRegistryBacked([[1, { name: "a" }]]);

    const seen: number[][] = [];
    const { ac, done } = watchKeys(kolu.client, seen);
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
    await done;
  });
});
