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
  collectionDeltasChannel,
  collectionKeysetChannel,
} from "./channelNames";
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
    const bus = channel<CollectionDelta<number, { name: string }>>(
      collectionDeltasChannel("items"),
    );
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
    const bus = channel<CollectionDelta<number, { name: string }>>(
      collectionDeltasChannel("items"),
    );
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
    const bus = channel<CollectionDelta<number, { name: string }>>(
      collectionDeltasChannel("items"),
    );
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
    const bus = channel<CollectionDelta<number, { name: string }>>(
      collectionDeltasChannel("items"),
    );
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
    const keysBus = channel<number[]>(collectionKeysetChannel("items"));
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

  it("drops the subscriber when the consumer closes the generator right after the snapshot (no lifecycle leak)", async () => {
    // Subscribe-before-snapshot opens the `deltasBus` subscription BEFORE the
    // snapshot `yield`. If the consumer takes the snapshot and then closes the
    // generator before pulling again, the generator's `.return()` resumes as a
    // `return` AT that suspended `yield` and skips the delta loop below it — so
    // the subscription's own `iterator.return()` never runs from the loop. The
    // handler's `try/finally` is what guarantees cleanup; without it the `sub`
    // would sit live in the channel forever, its queue growing on every publish.
    const store = new Map<number, V>([[1, { name: "a" }]]);
    const deltasBus = inMemoryChannel<CollectionDelta<number, V>>();
    const handlers = collectionHandlers({ name: "items" } as never, {
      readAll: () => store,
      perKeyBus: () => inMemoryChannel<V>(),
      keysBus: inMemoryChannel<number[]>(),
      deltasBus,
      upsert: () => {},
      remove: () => {},
    });
    const gen = handlers.deltas!({});

    const first = await gen.next();
    expect(first.value).toEqual({
      kind: "snapshot",
      entries: [[1, { name: "a" }]],
    });
    // The subscription is live the instant we hold the snapshot.
    expect(deltasBus.subscriberCount()).toBe(1);

    // Close the generator while it is suspended at the snapshot `yield`, before
    // the delta loop has run even once. The `finally` must still return the
    // pre-opened iterator and drop the subscriber.
    await gen.return?.(undefined);
    expect(deltasBus.subscriberCount()).toBe(0);

    // A later publish lands on nobody — no leaked queue accumulating frames.
    deltasBus.publish({
      kind: "delta",
      upserts: [[2, { name: "b" }]],
      removes: [],
    });
    expect(deltasBus.subscriberCount()).toBe(0);
  });
});

// #1681 — the gray Kaval chip. A per-key `get` for a key that DOESN'T EXIST YET
// must be a HELD-OPEN subscription (yield nothing, wait for the key), NOT a throw.
// The old handler threw "key not found at first snapshot", which reached a browser
// as a non-retriable ORPCError that KILLED its standing subscription — so a key
// born after the subscription opened (kolu-server booting with an empty re-serve
// mirror) never reached the consumer until a full page reload.
describe("collection get — held-open on an absent key (#1681)", () => {
  type V = { name: string };

  const makeHandlers = (store: Map<string, V>, perKey: Channel<V>) =>
    collectionHandlers(
      { name: "daemonStatus" } as never,
      {
        readAll: () => store as unknown as Map<unknown, unknown>,
        perKeyBus: () => perKey as unknown as Channel<unknown>,
        keysBus: inMemoryChannel<unknown[]>() as unknown as Channel<unknown[]>,
        upsert: () => {},
        remove: () => {},
      } as never,
    );

  it("holds open for an absent key, then DELIVERS it the moment it is upserted", async () => {
    const store = new Map<string, V>(); // empty — "local" is ABSENT at subscribe
    const perKey = inMemoryChannel<V>();
    const gen = makeHandlers(store, perKey).get({
      input: { key: "local" } as never,
    });

    // First pull: the key is absent, so the handler yields NOTHING yet — a live,
    // held-open subscription WAITING for the key (the pull is pending). Subscribe-
    // before-snapshot means it is already subscribed to the per-key channel.
    const pull = gen.next();
    // The key is born now — its first upsert publishes to that same channel.
    perKey.publish({ name: "connected" });
    const frame = await pull;

    expect(frame.done).toBe(false);
    expect(frame.value).toEqual({ name: "connected" });
    await gen.return?.(undefined);
  });

  it("delivers a value published in the post-snapshot gap without loss (subscribe-before-snapshot)", async () => {
    // The key is PRESENT at subscribe. The handler subscribes to the per-key
    // channel BEFORE reading the snapshot, so a value published in the window
    // between the snapshot `yield` and the consumer's next pull is BUFFERED and
    // delivered — never lost. Reordering to snapshot-BEFORE-subscribe would drop it
    // (published to zero subscribers): this test guards the ordering that the
    // held-open change preserves. (A same-window value equal to the snapshot may be
    // delivered twice — benign under fold semantics; see the handler docstring.)
    const store = new Map<string, V>([["local", { name: "a" }]]);
    const perKey = inMemoryChannel<V>();
    const gen = makeHandlers(store, perKey).get({
      input: { key: "local" } as never,
    });

    const first = await gen.next(); // snapshot
    expect(first.value).toEqual({ name: "a" });

    // A producer ticks a new value NOW — in the gap before we resume.
    perKey.publish({ name: "b" });
    const second = await gen.next();
    expect(second.value).toEqual({ name: "b" });

    await gen.return?.(undefined);
  });

  it("a key that NEVER appears leaves the stream OPEN yielding nothing (waiting, not errored), and drops cleanly on abort", async () => {
    const store = new Map<string, V>(); // empty forever
    const perKey = inMemoryChannel<V>();
    // Teardown is via the consumer's abort SIGNAL — how a real consumer ends a
    // held-open subscription (the reactive owner disposing / STREAM_RETRY abort).
    const ac = new AbortController();
    const gen = makeHandlers(store, perKey).get({
      input: { key: "local" } as never,
      signal: ac.signal,
    });

    const pull = gen.next();
    // The subscription is live and waiting — it did NOT throw.
    expect(perKey.subscriberCount()).toBe(1);
    // The pull stays PENDING: no frame, no error — the honest "absent/waiting"
    // state a consumer renders (the gray chip is a recoverable truth, not a corpse).
    const settled = await Promise.race([
      pull.then(() => "settled" as const),
      new Promise<"pending">((r) => setTimeout(() => r("pending"), 30)),
    ]);
    expect(settled).toBe("pending");

    // Aborting drops the subscriber — no lifecycle leak. The pending pull rejects
    // with the AbortError (drained here), exactly as `keys` on an empty collection.
    ac.abort();
    await pull.catch(() => {});
    await tick();
    expect(perKey.subscriberCount()).toBe(0);
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
