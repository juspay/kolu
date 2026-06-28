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
import {
  type Channel,
  collectionHandlers,
  implementSurface,
  inMemoryChannel,
} from "./server";
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

  it("keysBus fires on add/remove only — a value-only upsert leaves the key set untouched", async () => {
    // The `keys` stream tracks the key SET; a value update on an existing key
    // doesn't change membership, so re-publishing the whole key array would be a
    // redundant snapshot (and a spurious re-render). Membership-gating keeps the
    // producer honest to the `keysBus` doc contract ("broadcasts on add/remove").
    const { fragment, channel } = buildDeltasFragment();
    const keysBus = channel<number[]>("items:keys");
    const sets: number[][] = [];
    const ac = new AbortController();
    collectFrames(keysBus, ac, sets);

    fragment.ctx.collections.items.upsert(1, { name: "a" }); // ADD → publishes
    fragment.ctx.collections.items.upsert(1, { name: "a2" }); // value-only → no publish
    fragment.ctx.collections.items.upsert(2, { name: "b" }); // ADD → publishes
    fragment.ctx.collections.items.remove(2); // REMOVE → publishes

    await tick();

    expect(sets).toEqual([[1], [1, 2], [1]]);
    ac.abort();
  });
});

describe("collection deltas — handler subscribe-before-snapshot", () => {
  type V = { name: string };

  it("delivers a delta published AFTER the snapshot read but BEFORE the consumer resumes (no lost-update gap)", async () => {
    const store = new Map<number, V>([[1, { name: "a" }]]);
    const deltasBus = inMemoryChannel<CollectionDelta<number, V>>();
    const handlers = collectionHandlers(
      // The descriptor is only read for `_coll.name` in error messages.
      { name: "items" } as never,
      {
        readAll: () => store,
        perKeyBus: () => inMemoryChannel<V>(),
        keysBus: inMemoryChannel<number[]>(),
        deltasBus,
        upsert: () => {},
        remove: () => {},
      },
    );
    const gen = handlers.deltas!({});

    // First pull → the snapshot. The handler subscribes to `deltasBus` BEFORE it
    // yields this frame, so the subscriber is already live the moment we hold it.
    const first = await gen.next();
    expect(first.value).toEqual({
      kind: "snapshot",
      entries: [[1, { name: "a" }]],
    });

    // A producer ticks a delta NOW — in the window between the snapshot pull and
    // the next resume. Subscribe-before-snapshot buffers it; the pre-fix
    // subscribe-AFTER-yield ordering would have dropped it (no subscriber yet)
    // and the next pull would hang waiting for a fresh publish that never comes.
    deltasBus.publish({
      kind: "delta",
      upserts: [[2, { name: "b" }]],
      removes: [],
    });

    const second = await gen.next();
    expect(second.value).toEqual({
      kind: "delta",
      upserts: [[2, { name: "b" }]],
      removes: [],
    });

    await gen.return?.(undefined);
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

  it("crashes on a non-primitive key — fail fast, no silent collapse", () => {
    // A SINGLE object key collapses nothing, so the length-injectivity compare
    // alone would pass and serve `"[object Object]"`; the per-key guard rejects it.
    expect(() =>
      foldCollectionDeltas<object, V>(
        { byKey: {}, order: [] },
        {
          kind: "snapshot",
          entries: [[{ id: 1 }, { name: "a" }]],
        },
      ),
    ).toThrow(/primitive number or string/);
  });

  it('crashes on a number/string key collision (1 vs "1")', () => {
    expect(() =>
      foldCollectionDeltas<number | string, V>(
        { byKey: {}, order: [] },
        {
          kind: "snapshot",
          entries: [
            [1, { name: "a" }],
            ["1", { name: "b" }],
          ],
        },
      ),
    ).toThrow(/String\(\)-injective/);
  });

  it('crashes on a "__proto__" key — the reactive store reserves that name', () => {
    expect(() =>
      foldCollectionDeltas<string, V>(
        { byKey: {}, order: [] },
        {
          kind: "snapshot",
          entries: [["__proto__", { name: "x" }]],
        },
      ),
    ).toThrow(/__proto__/);
  });

  it('a legit string key "toString" is a normal member, not an inherited shadow', () => {
    const out = foldCollectionDeltas<string, V>(
      { byKey: {}, order: [] },
      {
        kind: "snapshot",
        entries: [["toString", { name: "ts" }]],
      },
    );
    // null-prototype dict: "toString" is an OWN member; absent inherited names
    // ("valueOf", "hasOwnProperty") do NOT read as present.
    expect("toString" in out.byKey).toBe(true);
    expect("valueOf" in out.byKey).toBe(false);
    expect(out.byKey.toString).toEqual({ name: "ts" });
  });
});

// Type-level: the discriminated union is exported and well-formed.
const _msg: CollectionDeltasMsg<number, { name: string }> = {
  kind: "delta",
  upserts: [[1, { name: "a" }]],
  removes: [],
};
void _msg;
