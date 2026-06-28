/**
 * The batched `deltas` collection verb (opt-in): a producer that mutates N keys
 * in one tick publishes ONE coalesced `{upserts, removes}` frame instead of N
 * per-key frames, and the client folds that stream into a per-key store. This
 * pins both halves:
 *
 *   1. SERVER coalescing — N synchronous `upsert`/`remove` calls in a tick
 *      flush as exactly one `deltas` frame, last-op-wins per key.
 *   2. CLIENT fold — `foldCollectionDeltas` rebuilds the keyed set from
 *      snapshot-then-delta, preserving real key TYPES (number keys stay numbers
 *      for `keys()`, even though the value store is keyed by `String(key)`).
 *
 * The per-key `keys`/`get` path is untouched and stays the default; `deltas` is
 * exercised only by a collection that lists the verb.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type CollectionDelta,
  type CollectionDeltasMsg,
  defineSurface,
} from "./define";
import { type Channel, implementSurface, inMemoryChannel } from "./server";
import { foldCollectionDeltas } from "./solid/useCollection";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Drain a bus into `out`, swallowing the AbortError the pending `next()`
 *  rejects with when the test aborts the subscription on teardown. */
function collectFrames<T>(
  bus: Channel<T>,
  ac: AbortController,
  out: T[],
): void {
  void (async () => {
    try {
      for await (const f of bus.subscribe(ac.signal)) out.push(f);
    } catch {
      /* aborted on teardown — expected */
    }
  })();
}

function buildDeltasFragment() {
  const surface = defineSurface({
    collections: {
      items: {
        keySchema: z.number(),
        schema: z.object({ name: z.string() }),
        // Opt into the batched stream alongside the default verbs.
        verbs: ["keys", "get", "upsert", "delete", "deltas"],
      },
    },
  });
  const items = new Map<number, { name: string }>();
  // One shared channel registry so the test can subscribe to the SAME
  // `items:deltas` bus the surface publishes to.
  const channels = new Map<string, Channel<unknown>>();
  const channel = <T>(name: string): Channel<T> => {
    let c = channels.get(name);
    if (!c) {
      c = inMemoryChannel<T>() as Channel<unknown>;
      channels.set(name, c);
    }
    return c as Channel<T>;
  };
  const fragment = implementSurface(surface, {
    channel,
    collections: {
      items: {
        readAll: () => items,
        upsert: (k, v) => {
          items.set(k, v);
        },
        remove: (k) => {
          items.delete(k);
        },
      },
    },
  });
  return { fragment, channel };
}

describe("collection deltas — server coalescing", () => {
  it("flushes a tick of N upserts as ONE frame", async () => {
    const { fragment, channel } = buildDeltasFragment();
    const bus =
      channel<CollectionDelta<number, { name: string }>>("items:deltas");
    const frames: CollectionDelta<number, { name: string }>[] = [];
    const ac = new AbortController();
    collectFrames(bus, ac, frames);

    // Three synchronous upserts in one tick (the agent's poll-loop pattern).
    fragment.ctx.collections.items.upsert(1, { name: "a" });
    fragment.ctx.collections.items.upsert(2, { name: "b" });
    fragment.ctx.collections.items.upsert(3, { name: "c" });

    await tick();

    expect(frames.length).toBe(1);
    expect(frames[0]!.upserts.length).toBe(3);
    expect(frames[0]!.removes).toEqual([]);
    ac.abort();
  });

  it("coalesces last-op-wins per key (upsert then remove → remove)", async () => {
    const { fragment, channel } = buildDeltasFragment();
    const bus =
      channel<CollectionDelta<number, { name: string }>>("items:deltas");
    const frames: CollectionDelta<number, { name: string }>[] = [];
    const ac = new AbortController();
    collectFrames(bus, ac, frames);

    fragment.ctx.collections.items.upsert(1, { name: "a" });
    fragment.ctx.collections.items.upsert(2, { name: "b" });
    fragment.ctx.collections.items.remove(1);

    await tick();

    expect(frames.length).toBe(1);
    expect(frames[0]!.upserts).toEqual([[2, { name: "b" }]]);
    expect(frames[0]!.removes).toEqual([1]);
    ac.abort();
  });

  it("coalesces a resurrection (remove then re-upsert → upsert wins)", async () => {
    const { fragment, channel } = buildDeltasFragment();
    const bus =
      channel<CollectionDelta<number, { name: string }>>("items:deltas");
    const frames: CollectionDelta<number, { name: string }>[] = [];
    const ac = new AbortController();
    collectFrames(bus, ac, frames);

    fragment.ctx.collections.items.upsert(1, { name: "a" });
    fragment.ctx.collections.items.remove(1);
    fragment.ctx.collections.items.upsert(1, { name: "a2" });

    await tick();

    expect(frames.length).toBe(1);
    expect(frames[0]!.upserts).toEqual([[1, { name: "a2" }]]);
    expect(frames[0]!.removes).toEqual([]);
    ac.abort();
  });

  it("separate ticks publish separate frames", async () => {
    const { fragment, channel } = buildDeltasFragment();
    const bus =
      channel<CollectionDelta<number, { name: string }>>("items:deltas");
    const frames: CollectionDelta<number, { name: string }>[] = [];
    const ac = new AbortController();
    collectFrames(bus, ac, frames);

    fragment.ctx.collections.items.upsert(1, { name: "a" });
    await tick();
    fragment.ctx.collections.items.upsert(2, { name: "b" });
    await tick();

    expect(frames.length).toBe(2);
    expect(frames[0]!.upserts).toEqual([[1, { name: "a" }]]);
    expect(frames[1]!.upserts).toEqual([[2, { name: "b" }]]);
    ac.abort();
  });
});

describe("foldCollectionDeltas — client fold", () => {
  type V = { name: string };
  const empty = { byKey: {} as Record<string, V>, order: [] as number[] };

  it("a snapshot replaces the whole set and keeps key types", () => {
    const out = foldCollectionDeltas<number, V>(empty, {
      kind: "snapshot",
      entries: [
        [1, { name: "a" }],
        [2, { name: "b" }],
      ],
    });
    expect(out.order).toEqual([1, 2]); // numbers, not "1"/"2"
    expect(out.byKey["1"]).toEqual({ name: "a" });
    expect(out.byKey["2"]).toEqual({ name: "b" });
  });

  it("a delta applies upserts and removes onto the prior set", () => {
    const base = foldCollectionDeltas<number, V>(empty, {
      kind: "snapshot",
      entries: [
        [1, { name: "a" }],
        [2, { name: "b" }],
      ],
    });
    const out = foldCollectionDeltas<number, V>(base, {
      kind: "delta",
      upserts: [
        [2, { name: "B" }],
        [3, { name: "c" }],
      ],
      removes: [1],
    });
    expect(out.order).toEqual([2, 3]); // 1 dropped, 3 appended, still numbers
    expect(out.byKey["1"]).toBeUndefined();
    expect(out.byKey["2"]).toEqual({ name: "B" });
    expect(out.byKey["3"]).toEqual({ name: "c" });
  });

  it("the snapshot→delta fold survives a resubscribe replay", () => {
    // A re-subscribe yields a fresh snapshot; folding it from any prior state
    // must converge to exactly the snapshot (no stale keys linger).
    const stale = foldCollectionDeltas<number, V>(empty, {
      kind: "snapshot",
      entries: [[9, { name: "gone" }]],
    });
    const out = foldCollectionDeltas<number, V>(stale, {
      kind: "snapshot",
      entries: [[1, { name: "a" }]],
    });
    expect(out.order).toEqual([1]);
    expect(out.byKey["9"]).toBeUndefined();
  });
});

// Type-level: the discriminated union is exported and well-formed.
const _msg: CollectionDeltasMsg<number, { name: string }> = {
  kind: "delta",
  upserts: [[1, { name: "a" }]],
  removes: [],
};
void _msg;
