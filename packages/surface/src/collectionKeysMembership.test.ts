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

import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import {
  flush,
  memberStream,
  type Subscription,
  subscribeMember,
} from "./handlerDispatch.testlib";
import { implementSurface } from "./server";

const surface = defineSurface({
  collections: {
    items: {
      keySchema: Schema.Number,
      schema: Schema.Struct({ name: Schema.String }),
    },
  },
});

/**
 * Serve `items` as a REGISTRY PROJECTION — exactly kolu's pattern: an external
 * `registry` Map the test mutates directly is the store, `readAll` projects it,
 * and `upsert`/`remove` are NO-OPS (the registry is the authority; the framework
 * call only fans out to subscribers). `add(k, v)` reproduces kolu's
 * `installSnapshot` ordering: insert into the registry FIRST, THEN publish.
 */
function serveRegistryBacked(
  /** Keys ALREADY in the backing store at `implementSurface` time — preloaded
   *  out-of-band, NOT through `ctx.collections.items.upsert`. Models a registry
   *  that already holds entries when kolu builds its surface server. */
  preload?: ReadonlyArray<readonly [number, { name: string }]>,
  /** Optional hook fired on every framework `readAll()` — used to publish INSIDE
   *  the snapshot read, the sharpest probe of subscribe-before-snapshot. */
  onReadAll?: () => void,
) {
  const registry = new Map<number, { name: string }>(preload);
  const { handlers, ctx } = implementSurface(surface, {
    collections: {
      items: {
        readAll: () => {
          onReadAll?.();
          return registry;
        },
        upsert: () => {},
        remove: () => {},
      },
    },
  });
  return {
    registry,
    handlers,
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

/** Subscribe `items.keys` and collect every emitted key-set. A stream FAILURE is
 *  a real fault (route, schema, relay) and would surface as an unhandled defect
 *  in the consuming fiber rather than being swallowed into a partial frame list;
 *  teardown is `stop()` (fiber interruption), which cannot fail. */
function watchKeys(
  handlers: ReturnType<typeof serveRegistryBacked>["handlers"],
): Subscription<readonly number[]> {
  return subscribeMember<readonly number[]>(handlers, "surface/items/keys");
}

/**
 * How many frames there are once the count has STOPPED MOVING.
 *
 * Every assertion in this file is about MEMBERSHIP — did a key set change, and
 * did an unchanged one stay quiet — and none is about how many turns of the
 * event loop a frame takes to arrive. `flush()` conflates the two: it is ONE
 * turn, which was enough while a subscription's delivery was one hop (publish,
 * then the consumer's next pull) and is a hop COUNT rather than a wait either
 * way. When delivery gained a buffer between those two, a frame started landing
 * a turn later than it used to, and a count sampled exactly one turn after the
 * action read either the frame before it or the one after — the same test
 * passing and failing on scheduling.
 *
 * So the wait here is for QUIET: read the count until it holds still, and
 * answer with the number it settled on. That is the same answer for any
 * delivery that eventually delivers, which is the only promise a membership
 * stream makes — and it keeps the claims exactly as they were, because "the
 * count did not move" is precisely what a no-re-broadcast test means.
 *
 * STILL is four turns rather than one, because "quiet" has to outlast the hops
 * a delivery may take; the cap is there so a stream that never settles fails
 * this file rather than hanging it.
 */
const STILL = 4;
const settled = async (count: () => number): Promise<number> => {
  let last = count();
  let held = 0;
  for (let turn = 0; turn < 200 && held < STILL; turn++) {
    await flush();
    const now = count();
    held = now === last ? held + 1 : 0;
    last = now;
  }
  return last;
};

describe("served collection keys-stream — membership for a registry-backed projection", () => {
  it("broadcasts a key added AFTER a consumer subscribed (the registry-projection membership bug)", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a"); // a terminal present before the consumer connects

    const { seen, stop } = watchKeys(kolu.handlers);
    await settled(() => seen.length);
    // The connect snapshot carries the pre-existing key.
    expect(seen.at(-1)).toEqual([1]);

    // A SECOND terminal is born after the consumer subscribed — registry-first,
    // then publish (kolu's `installSnapshot` ordering). Without the fix the
    // keys-set delta is suppressed and the consumer is stuck at [1].
    kolu.add(2, "b");
    await settled(() => seen.length);
    expect([...(seen.at(-1) ?? [])].sort()).toEqual([1, 2]);

    // A third, to be sure it isn't a one-off.
    kolu.add(3, "c");
    await settled(() => seen.length);
    expect([...(seen.at(-1) ?? [])].sort()).toEqual([1, 2, 3]);

    await stop();
  });

  it("buffers a membership add that lands DURING the snapshot read", async () => {
    // The lost-update window the `deltas` handler closes with subscribe-before-
    // snapshot — pinned here for the `keys` membership stream. The add fires from
    // INSIDE the framework's own `readAll()`, i.e. while the snapshot is being
    // computed. With subscribe-AFTER-snapshot there is no subscriber yet, the
    // frame hits zero subscribers, and — a quiescent `keys` stream having no
    // later frame to self-heal from — the key is lost until the next membership
    // change or a reconnect, so the second frame below never arrives and
    // `Stream.take(2)` hangs.
    //
    // What this pins EXACTLY, now that the publish is coalesced: the add no
    // longer publishes inside the read, it SCHEDULES, and the frame lands a
    // microtask later. So the window being closed here is the one that still
    // exists — the subscription is acquired before the snapshot is composed, so
    // a frame born anywhere after that point is buffered rather than dropped.
    // The publish-during-read variant it used to probe is now unreachable by
    // construction, which is a stronger guarantee than the test could give.
    let armed = false;
    const kolu = serveRegistryBacked(undefined, () => {
      // Armed only for the SNAPSHOT read below, never for the construction-time
      // seed read or the `readAll()` a publish itself performs.
      if (!armed) return;
      armed = false;
      kolu.add(2, "b");
    });
    kolu.add(1, "a");
    armed = true;

    const frames = (await Effect.runPromise(
      Stream.runCollect(
        Stream.take(memberStream(kolu.handlers, "surface/items/keys"), 2),
      ),
    )) as ReadonlyArray<readonly number[]>;

    // TWO frames arrived, which is the whole point: the membership publish that
    // fired inside the snapshot read reached a LIVE subscriber. (The snapshot
    // itself may already reflect that add — the documented, benign
    // double-delivery of subscribe-before-snapshot; a `keys` consumer folds a
    // repeated full set idempotently. What must never happen is the SECOND frame
    // going missing, which is what a lost update looks like on a quiescent
    // stream.)
    expect(frames.length).toBe(2);
    expect([...(frames[1] ?? [])].sort()).toEqual([1, 2]);
  });

  it("broadcasts a removal to an already-subscribed consumer", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");
    kolu.add(2, "b");

    const { seen, stop } = watchKeys(kolu.handlers);
    await settled(() => seen.length);
    expect([...(seen.at(-1) ?? [])].sort()).toEqual([1, 2]);

    kolu.drop(1); // registry entry gone, then publish
    await settled(() => seen.length);
    expect(seen.at(-1)).toEqual([2]);

    await stop();
  });

  it("does NOT re-broadcast the key set on a no-op remove of a non-member key (the remove guard mirrors the upsert guard)", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");

    const { seen, stop } = watchKeys(kolu.handlers);
    const framesAfterConnect = await settled(() => seen.length);

    // Drop a key that was never added/seeded: membership is unchanged, so the keys
    // stream must NOT re-yield. Without the guard the remove path would fire a
    // redundant full-snapshot, breaking the symmetry the upsert path enforces.
    kolu.drop(99);
    expect(await settled(() => seen.length)).toBe(framesAfterConnect);

    // Dropping the SAME key twice: the first drop is a real membership delta, the
    // second is a no-op that must NOT re-yield.
    kolu.drop(1);
    const framesAfterRealDrop = await settled(() => seen.length);
    expect(seen.at(-1)).toEqual([]);
    kolu.drop(1);
    expect(await settled(() => seen.length)).toBe(framesAfterRealDrop);

    await stop();
  });

  it("does NOT re-broadcast the key set on a value-only update (the optimization holds)", async () => {
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");

    const { seen, stop } = watchKeys(kolu.handlers);
    const framesAfterConnect = await settled(() => seen.length);

    // Same key, new value: membership is unchanged, so the keys stream must NOT
    // re-yield (a value-only churn can't storm keys subscribers). The value
    // travels the per-key `get` stream instead.
    kolu.add(1, "a-renamed");
    expect(await settled(() => seen.length)).toBe(framesAfterConnect);

    await stop();
  });

  it("a same-tick bulk add of M keys costs ONE keys frame and ONE readAll, not M of each (the O(M·N) fix)", async () => {
    // Before the per-tick coalescer, each of the M adds published a full key-set
    // snapshot AND ran the backing `readAll()` to compose it — M frames of a
    // growing set (Σ i = M·(M+1)/2 key elements on the bus) and M O(N) store
    // folds per bulk add. The coalescer flushes once per tick: the M-key burst
    // below must cost exactly one frame (the tick-final set) and exactly one
    // `readAll()` on the publish path.
    let readAlls = 0;
    const kolu = serveRegistryBacked(undefined, () => {
      readAlls++;
    });
    const { seen, stop } = watchKeys(kolu.handlers);
    const framesAfterConnect = await settled(() => seen.length);
    readAlls = 0; // count only the burst below, not the connect snapshot

    const M = 100;
    for (let k = 1; k <= M; k++) kolu.add(k, `n${k}`);

    expect(await settled(() => seen.length)).toBe(framesAfterConnect + 1);
    expect([...(seen.at(-1) ?? [])].length).toBe(M);
    expect(readAlls).toBe(1);

    await stop();
  });

  it("collapses a same-tick MIX of adds and removes to the tick-final set", async () => {
    // The shape production actually drives — `test__set` (remove-all then
    // upsert-each) and the reactor's derived-collection reconcile (an upsert
    // loop then a remove loop, one synchronous pass). The bulk-add case above
    // would pass even if only adds coalesced.
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");
    kolu.add(2, "b");

    const { seen, stop } = watchKeys(kolu.handlers);
    const framesAfterConnect = await settled(() => seen.length);

    kolu.add(3, "c");
    kolu.drop(1);
    kolu.add(4, "d");
    kolu.drop(2);

    expect(await settled(() => seen.length)).toBe(framesAfterConnect + 1);
    expect([...(seen.at(-1) ?? [])].sort()).toEqual([3, 4]);

    await stop();
  });

  it("publishes NOTHING for a tick whose membership edges cancel out", async () => {
    // A key added and dropped inside one tick leaves the set exactly as it was.
    // Both `broadcastKeys` guards fire (the key really was new, then really was
    // a member), so a coalescer that published whatever it was scheduled for
    // would emit a snapshot identical to the last one — the same redundant
    // full-snapshot those guards exist to prevent, one tick further out. The
    // published set is compared against the last, so the stream keeps its
    // "membership-change only" promise at BOTH time scales.
    const kolu = serveRegistryBacked();
    kolu.add(1, "a");

    const { seen, stop } = watchKeys(kolu.handlers);
    const framesAfterConnect = await settled(() => seen.length);

    kolu.add(2, "b");
    kolu.drop(2);

    expect(await settled(() => seen.length)).toBe(framesAfterConnect);
    expect(seen.at(-1)).toEqual([1]);

    await stop();
  });

  it("does NOT re-broadcast keys for a value-only update on a key PRELOADED before the server was built", async () => {
    // Key 1 is in the backing store at `implementSurface` time — it never went
    // through `ctx.collections.items.upsert`, so the framework's broadcast set
    // only knows it if it seeds from `readAll()` at construction. An empty seed
    // would treat the first value-only upsert on key 1 as a brand-new key and
    // fire a spurious full keys snapshot.
    const kolu = serveRegistryBacked([[1, { name: "a" }]]);

    const { seen, stop } = watchKeys(kolu.handlers);
    await settled(() => seen.length);
    // The connect snapshot still carries the preloaded key.
    expect(seen.at(-1)).toEqual([1]);
    const framesAfterConnect = seen.length;

    // A value-only update on the PRELOADED key: membership is unchanged, so the
    // keys stream must NOT re-yield even though this key never went through upsert.
    kolu.add(1, "a-renamed");
    expect(await settled(() => seen.length)).toBe(framesAfterConnect);

    // A genuinely new key (not preloaded) still fires the membership delta, so the
    // seed suppresses only the redundant snapshot, never a real add.
    kolu.add(2, "b");
    await settled(() => seen.length);
    expect([...(seen.at(-1) ?? [])].sort()).toEqual([1, 2]);

    await stop();
  });
});
