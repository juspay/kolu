/**
 * The batched `deltas` collection verb (opt-in): a producer that mutates N keys
 * in one tick publishes ONE coalesced `{upserts, removes}` frame instead of N
 * per-key frames, and the client folds that stream into a per-key store. This
 * pins both halves:
 *
 *   1. SERVER coalescing — N synchronous `upsert`/`remove` calls in a tick
 *      flush as exactly one `deltas` frame, last-op-wins per key.
 *   2. CLIENT store — `useCollectionDeltas` applies snapshot-then-delta to the
 *      store it owns, preserving real key TYPES (number keys stay numbers for
 *      `keys()`, even though the value store is keyed by `String(key)`).
 *
 * The per-key `keys`/`get` path is untouched and stays the default; `deltas` is
 * exercised only by a collection that lists the verb.
 */

import { Effect, Fiber, Schema, Stream } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
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
  implementSurfaceOnPublisher,
  inMemoryChannel,
} from "./server";
import type { Collection } from "./index";
import { collection } from "./index";
import { controllableStream } from "./solid/controllableStream.testlib";
import {
  type UseCollectionDeltasResult,
  useCollectionDeltas,
} from "./solid/useCollection";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Drain a bus into `out`, swallowing the AbortError the pending `next()`
 *  rejects with when the test aborts the subscription on teardown. */
function collectFrames<T>(
  bus: Channel<T>,
  ac: AbortController,
  out: T[],
): void {
  watchFrames(bus, ac, (f) => out.push(f));
}

/** The same drain, handing each frame to a callback — for the one case that
 *  needs the ARRIVAL ORDER across two buses rather than each bus's own list. */
function watchFrames<T>(
  bus: Channel<T>,
  ac: AbortController,
  onFrame: (frame: T) => void,
): void {
  void (async () => {
    try {
      for await (const f of bus.subscribe(ac.signal)) onFrame(f);
    } catch {
      /* aborted on teardown — expected */
    }
  })();
}

function buildDeltasFragment() {
  const surface = defineSurface({
    collections: {
      items: {
        keySchema: Schema.Number,
        schema: Schema.Struct({ name: Schema.String }),
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
  const fragment = implementSurfaceOnPublisher(
    surface,
    {
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
    },
    channel,
  );
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
    // One tick per mutation, so each membership edge flushes its own frame and
    // the value-only gap is visible as "no frame for that tick".
    const { fragment, channel } = buildDeltasFragment();
    const keysBus = channel<number[]>(collectionKeysetChannel("items"));
    const sets: number[][] = [];
    const ac = new AbortController();
    collectFrames(keysBus, ac, sets);

    fragment.ctx.collections.items.upsert(1, { name: "a" }); // ADD → publishes
    await tick();
    fragment.ctx.collections.items.upsert(1, { name: "a2" }); // value-only → no publish
    await tick();
    fragment.ctx.collections.items.upsert(2, { name: "b" }); // ADD → publishes
    await tick();
    fragment.ctx.collections.items.remove(2); // REMOVE → publishes
    await tick();

    expect(sets).toEqual([[1], [1, 2], [1]]);
    ac.abort();
  });

  it("a burst flushes ONE keys frame and ONE deltas frame, keys first", async () => {
    // Both streams coalesce on the same microtask window, which is what keeps
    // their relative order stable within a tick: `wrappedUpsert` schedules the
    // keys broadcast before it hands the mutation to the deltas coalescer, so
    // the membership frame lands first — the order the eager (synchronous)
    // keys publish always produced. A collection serving both verbs is the only
    // place the two windows meet, so it is the only place that order is
    // observable at all.
    //
    // (The keys stream's own O(M·N) coalescing is pinned against the real
    // `keys` handler, with its `readAll()` count, in
    // `collectionKeysMembership.test.ts` — this case is about the interleave.)
    const { fragment, channel } = buildDeltasFragment();
    const keysBus = channel<number[]>(collectionKeysetChannel("items"));
    const deltasBus = channel<CollectionDelta<number, { name: string }>>(
      collectionDeltasChannel("items"),
    );
    // One arrival log for both buses, so the interleave is a fact the test can
    // read rather than an inference from two separate lists.
    const arrivals: { bus: "keys" | "deltas"; frame: unknown }[] = [];
    const ac = new AbortController();
    watchFrames(keysBus, ac, (frame) => arrivals.push({ bus: "keys", frame }));
    watchFrames(deltasBus, ac, (frame) =>
      arrivals.push({ bus: "deltas", frame }),
    );

    const M = 100;
    for (let k = 1; k <= M; k++) {
      fragment.ctx.collections.items.upsert(k, { name: `n${k}` });
    }
    await tick();

    expect(arrivals.map((a) => a.bus)).toEqual(["keys", "deltas"]);
    expect((arrivals[0]?.frame as number[]).length).toBe(M);
    expect(
      (arrivals[1]?.frame as CollectionDelta<number, { name: string }>).upserts
        .length,
    ).toBe(M);
    ac.abort();
  });
});

describe("collection deltas — handler subscribe-before-snapshot", () => {
  type V = { name: string };

  it("delivers a delta published DURING the snapshot read (no lost-update gap)", async () => {
    // The sharpest probe of "subscribe strictly precedes snapshot": publish from
    // INSIDE the snapshot read. If the subscription were opened after the
    // snapshot, this frame would publish to zero subscribers and be lost — and
    // `Stream.take(2)` would hang forever waiting for a second frame.
    const store = new Map<number, V>([[1, { name: "a" }]]);
    const deltasBus = inMemoryChannel<CollectionDelta<number, V>>();
    let subscribersDuringSnapshot = -1;
    let publishedInGap = false;
    const handlers = collectionHandlers(
      // The descriptor is only read for `_coll.name` in error messages.
      { name: "items" } as never,
      {
        readAll: () => {
          if (!publishedInGap) {
            publishedInGap = true;
            subscribersDuringSnapshot = deltasBus.subscriberCount();
            deltasBus.publish({
              kind: "delta",
              upserts: [[2, { name: "b" }]],
              removes: [],
            });
          }
          return store;
        },
        perKeyBus: () => inMemoryChannel<V>(),
        keysBus: inMemoryChannel<number[]>(),
        deltasBus,
        upsert: () => {},
        remove: () => {},
      },
    );

    const frames = await Effect.runPromise(
      Stream.runCollect(Stream.take(handlers.deltas!(), 2)),
    );
    // The subscriber was ALREADY live while the snapshot was being read.
    expect(subscribersDuringSnapshot).toBe(1);
    expect(frames).toEqual([
      { kind: "snapshot", entries: [[1, { name: "a" }]] },
      { kind: "delta", upserts: [[2, { name: "b" }]], removes: [] },
    ]);
    // …and the subscription is released once the stream ends.
    expect(deltasBus.subscriberCount()).toBe(0);
  });

  it("drops the subscriber when the consumer stops right after the snapshot (no lifecycle leak)", async () => {
    // Subscribe-before-snapshot opens the `deltasBus` subscription BEFORE the
    // snapshot frame. If the consumer takes the snapshot and stops, the delta
    // relay below it never runs even once — so cleanup cannot ride the relay. It
    // rides the SCOPE: the subscription is a scoped resource of the stream, so
    // ending the stream releases it. Without that, the sub would sit live in the
    // channel forever, its queue growing on every publish.
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

    const frames = await Effect.runPromise(
      Stream.runCollect(Stream.take(handlers.deltas!(), 1)),
    );
    expect(frames).toEqual([
      { kind: "snapshot", entries: [[1, { name: "a" }]] },
    ]);
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
// must be a HELD-OPEN subscription (emit nothing, wait for the key), NOT a failure.
// The old handler threw "key not found at first snapshot", which reached a browser
// as a non-retriable application error that KILLED its standing subscription — so a
// key born after the subscription opened (kolu-server booting with an empty re-serve
// mirror) never reached the consumer until a full page reload.
describe("collection get — held-open on an absent key (#1681)", () => {
  type V = { name: string };

  const makeHandlers = (readAll: () => Map<string, V>, perKey: Channel<V>) =>
    collectionHandlers(
      { name: "daemonStatus" } as never,
      {
        readAll: readAll as unknown as () => Map<unknown, unknown>,
        perKeyBus: () => perKey as unknown as Channel<unknown>,
        keysBus: inMemoryChannel<unknown[]>() as unknown as Channel<unknown[]>,
        upsert: () => {},
        remove: () => {},
      } as never,
    );

  it("holds open for an absent key, then DELIVERS it the moment it is upserted", async () => {
    const store = new Map<string, V>(); // empty — "local" is ABSENT at subscribe
    const perKey = inMemoryChannel<V>();
    const seen: V[] = [];
    const fiber = Effect.runFork(
      Stream.runForEach(
        makeHandlers(() => store, perKey).get({ key: "local" } as never),
        (v) =>
          Effect.sync(() => {
            seen.push(v as V);
          }),
      ),
    );
    await tick();
    // The key is absent, so nothing has been emitted — but the subscription is
    // live and WAITING (it did not fail).
    expect(seen).toEqual([]);
    expect(perKey.subscriberCount()).toBe(1);

    // The key is born now — its first upsert publishes to that same channel.
    perKey.publish({ name: "connected" });
    await tick();
    expect(seen).toEqual([{ name: "connected" }]);

    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  it("delivers a value published DURING the snapshot read without loss (subscribe-before-snapshot)", async () => {
    // The key is PRESENT at subscribe. The handler subscribes to the per-key
    // channel BEFORE reading the snapshot, so a value published while the snapshot
    // is being read is BUFFERED and delivered — never lost. Reordering to
    // snapshot-BEFORE-subscribe would drop it (published to zero subscribers) and
    // `Stream.take(2)` would hang. (A same-window value equal to the snapshot may
    // be delivered twice — benign under fold semantics; see the handler docstring.)
    const store = new Map<string, V>([["local", { name: "a" }]]);
    const perKey = inMemoryChannel<V>();
    let published = false;
    const frames = await Effect.runPromise(
      Stream.runCollect(
        Stream.take(
          makeHandlers(() => {
            if (!published) {
              published = true;
              perKey.publish({ name: "b" });
            }
            return store;
          }, perKey).get({ key: "local" } as never),
          2,
        ),
      ),
    );
    expect(frames).toEqual([{ name: "a" }, { name: "b" }]);
  });

  it("a key that NEVER appears leaves the stream OPEN emitting nothing (waiting, not errored), and drops cleanly on interrupt", async () => {
    const store = new Map<string, V>(); // empty forever
    const perKey = inMemoryChannel<V>();
    // Teardown is fiber INTERRUPTION — how a real consumer ends a held-open
    // subscription now that there is no signal to abort (D10).
    let ended = false;
    const fiber = Effect.runFork(
      Stream.runForEach(
        makeHandlers(() => store, perKey).get({ key: "local" } as never),
        () => Effect.void,
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            ended = true;
          }),
        ),
      ),
    );
    await tick();
    // The subscription is live and waiting — it did NOT fail.
    expect(perKey.subscriberCount()).toBe(1);
    // No frame, no error — the honest "absent/waiting" state a consumer renders
    // (the gray chip is a recoverable truth, not a corpse).
    await new Promise((r) => setTimeout(r, 30));
    expect(ended).toBe(false);
    expect(perKey.subscriberCount()).toBe(1);

    // Interrupting drops the subscriber — no lifecycle leak.
    await Effect.runPromise(Fiber.interrupt(fiber));
    await tick();
    expect(perKey.subscriberCount()).toBe(0);
  });
});

// ── The CLIENT half: the store the frame is applied to ─────────────────────
//
// `useCollectionDeltas` owns its store and applies each frame by NAMED-KEY writes,
// so these cases are driven end-to-end through the hook (there is no standalone
// pure fold left to call — that was the copying accumulator this replaced). What
// they pin is the observable contract: what `keys()` and `byKey()` read after each
// frame, and that a key the CONSTRAINT forbids never enters the set.

/** Descriptors for the hook's first argument. Only `name` is read at runtime; the
 *  schemas are what type `K` and `T` at the call site. */
const numericKeyed = collection({
  name: "numericKeyed",
  keySchema: Schema.Number,
  schema: Schema.Struct({ name: Schema.String }),
});
const stringKeyed = collection({
  name: "stringKeyed",
  keySchema: Schema.String,
  schema: Schema.Struct({ name: Schema.String }),
});

/** Two microtask turns — enough for one pushed frame to cross the stream fiber and
 *  land in the store. */
const settle = async (): Promise<void> => {
  await tick();
  await tick();
};

/** Drive `useCollectionDeltas` over a hand-pushed source inside a reactive root,
 *  handing the body the view, a pusher, and the errors the hook reported. */
async function drive<K, T>(
  descriptor: Collection<string, K, T>,
  body: (ctx: {
    view: UseCollectionDeltasResult<K, T>;
    push: (frame: CollectionDeltasMsg<K, T>) => void;
    errors: Error[];
  }) => Promise<void>,
): Promise<void> {
  await createRoot(async (dispose) => {
    const { source, push } = controllableStream<CollectionDeltasMsg<K, T>>();
    const errors: Error[] = [];
    const view = useCollectionDeltas(descriptor, {
      source,
      onError: (err) => errors.push(err),
    });
    try {
      await body({ view, push, errors });
    } finally {
      dispose();
    }
  });
}

describe("collection deltas — the client store", () => {
  it("a snapshot establishes the whole set and keeps key TYPES", async () => {
    await drive(numericKeyed, async ({ view, push }) => {
      push({
        kind: "snapshot",
        entries: [
          [1, { name: "a" }],
          [2, { name: "b" }],
        ],
      });
      await settle();
      expect(view.keys()).toEqual([1, 2]); // numbers, not "1"/"2"
      expect(view.byKey(1)?.()).toEqual({ name: "a" });
      expect(view.byKey(2)?.()).toEqual({ name: "b" });
    });
  });

  it("a delta applies upserts and removes onto the standing set", async () => {
    await drive(numericKeyed, async ({ view, push }) => {
      push({
        kind: "snapshot",
        entries: [
          [1, { name: "a" }],
          [2, { name: "b" }],
        ],
      });
      await settle();
      push({
        kind: "delta",
        upserts: [
          [2, { name: "B" }],
          [3, { name: "c" }],
        ],
        removes: [1],
      });
      await settle();
      expect(view.keys()).toEqual([2, 3]); // 1 dropped, 3 appended, still numbers
      expect(view.byKey(1)).toBeUndefined();
      expect(view.byKey(2)?.()).toEqual({ name: "B" });
      expect(view.byKey(3)?.()).toEqual({ name: "c" });
    });
  });

  it("a remove of a key the store never saw is a no-op, not a crash", async () => {
    // The tick coalescer resolves upsert-then-remove within one producer tick to a
    // BARE remove, so this frame is produced for real.
    await drive(numericKeyed, async ({ view, push, errors }) => {
      push({ kind: "snapshot", entries: [[1, { name: "a" }]] });
      await settle();
      push({ kind: "delta", upserts: [], removes: [99] });
      await settle();
      expect(errors).toEqual([]);
      expect(view.keys()).toEqual([1]);
    });
  });

  it("a resubscribe snapshot converges to exactly that snapshot — no stale keys", async () => {
    await drive(numericKeyed, async ({ view, push }) => {
      push({ kind: "snapshot", entries: [[9, { name: "gone" }]] });
      await settle();
      push({ kind: "snapshot", entries: [[1, { name: "a" }]] });
      await settle();
      expect(view.keys()).toEqual([1]);
      expect(view.byKey(9)).toBeUndefined();
      expect(view.byKey(1)?.()).toEqual({ name: "a" });
    });
  });

  it("a non-primitive key is refused — fail fast, no silent collapse", async () => {
    // A SINGLE object key collapses nothing, so a length-injectivity compare alone
    // would pass and serve `"[object Object]"`; the per-key guard rejects it. The
    // frame loop runs on the subscription's own fiber, so the refusal surfaces as
    // that ONE subscription's error rather than an unhandled throw.
    await drive(
      collection({
        name: "objectKeyed",
        keySchema: Schema.Struct({ id: Schema.Number }),
        schema: Schema.Struct({ name: Schema.String }),
      }),
      async ({ view, push, errors }) => {
        push({ kind: "snapshot", entries: [[{ id: 1 }, { name: "a" }]] });
        await settle();
        expect(errors[0]?.message).toMatch(/primitive number or string/);
        expect(view.keys()).toEqual([]);
      },
    );
  });

  it('a number/string key collision (1 vs "1") is refused', async () => {
    await drive(
      collection({
        name: "mixedKeyed",
        keySchema: Schema.Union([Schema.Number, Schema.String]),
        schema: Schema.Struct({ name: Schema.String }),
      }),
      async ({ push, errors }) => {
        push({
          kind: "snapshot",
          entries: [
            [1, { name: "a" }],
            ["1", { name: "b" }],
          ],
        });
        await settle();
        expect(errors[0]?.message).toMatch(/String\(\)-injective/);
      },
    );
  });

  it('a "__proto__" key is refused — the reactive store reserves that name', async () => {
    await drive(stringKeyed, async ({ push, errors }) => {
      push({ kind: "snapshot", entries: [["__proto__", { name: "x" }]] });
      await settle();
      expect(errors[0]?.message).toMatch(/__proto__/);
    });
  });

  it('a legit "toString" key is a normal member, not an inherited shadow', async () => {
    await drive(stringKeyed, async ({ view, push }) => {
      push({ kind: "snapshot", entries: [["toString", { name: "ts" }]] });
      await settle();
      // null-prototype dict: "toString" is an OWN member; absent inherited names
      // ("valueOf", "hasOwnProperty") do NOT read as present.
      expect(view.byKey("toString")?.()).toEqual({ name: "ts" });
      expect(view.byKey("valueOf")).toBeUndefined();
      expect(view.byKey("hasOwnProperty")).toBeUndefined();
    });
  });
});

// Type-level: the discriminated union is exported and well-formed.
const _msg: CollectionDeltasMsg<number, { name: string }> = {
  kind: "delta",
  upserts: [[1, { name: "a" }]],
  removes: [],
};
void _msg;
