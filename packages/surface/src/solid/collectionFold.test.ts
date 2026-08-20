/**
 * `fold` — the frame socket on a batched `deltas` collection.
 *
 * The keyed store is the right answer for a consumer whose accumulator IS a keyed
 * map. For everyone else — an index, a patched document set, a running total — the
 * framework used to digest the wire's `{upserts, removes}` into a dictionary and
 * hand over only the dictionary, so the consumer reconstructed "what changed" by
 * diffing revisions it had asked the server to carry for that purpose alone. `fold`
 * hands the frame through instead.
 *
 * What this pins is the contract a consumer writes `init`/`step` against:
 *
 *   - a full-set frame ANSWERS with `init`, and every reconnect snapshot
 *     re-initializes — one honest rebuild per reconnect, which is what the wire
 *     actually delivered;
 *   - a delta frame reaches `step` VERBATIM, including a remove of a key nobody ever
 *     upserted (the server's tick coalescer produces exactly that), because
 *     filtering it here would be the framework swallowing part of the frame again;
 *   - folds run AFTER the store write, in the same tick;
 *   - registering mid-stream is indistinguishable from a reconnect, and both are
 *     seeded with the CLIENT STORE's own objects — what a fold holds never depends
 *     on when it registered;
 *   - a fold is owned: ownerless registration throws, and an owner's disposal drops
 *     it;
 *   - a throwing consumer callback is contained to its own fold.
 */

import { createEffect, createRoot } from "solid-js";
import { unwrap } from "solid-js/store";
import { describe, expect, it, vi } from "vitest";
import type { CollectionDelta, CollectionDeltasMsg } from "../define";
import {
  type DeltasHarness,
  driveDeltas,
  type NumberRow as V,
  numberRows,
  settle,
} from "./deltasHarness.testlib";
import {
  type UseCollectionDeltasResult,
  useCollectionDeltas,
} from "./useCollection";
import { controllableStream } from "./controllableStream.testlib";

type Frame = CollectionDeltasMsg<string, V>;

const drive = (
  body: (ctx: DeltasHarness<string, V>) => Promise<void>,
): Promise<void> => driveDeltas(numberRows, body);

/** The frames a fold was handed, as the consumer saw them. */
function recordingFold(view: UseCollectionDeltasResult<string, V>) {
  const seen: (
    | { kind: "init"; entries: [string, V][] }
    | { kind: "step"; delta: CollectionDelta<string, V> }
  )[] = [];
  const acc = view.fold<number>({
    init: (entries) => {
      seen.push({ kind: "init", entries: entries.map(([k, v]) => [k, v]) });
      return entries.length;
    },
    step: (n, delta) => {
      seen.push({ kind: "step", delta });
      return n + delta.upserts.length - delta.removes.length;
    },
  });
  return { seen, acc };
}

describe("fold — the frame is the unit of update", () => {
  it("a snapshot answers with init; each delta reaches step verbatim", async () => {
    await drive(async ({ view, push }) => {
      const { seen, acc } = recordingFold(view);
      expect(acc()).toBeUndefined(); // nothing has landed yet

      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();
      expect(seen).toEqual([
        {
          kind: "init",
          entries: [
            ["a", { n: 1 }],
            ["b", { n: 2 }],
          ],
        },
      ]);
      expect(acc()).toBe(2);

      push({ kind: "delta", upserts: [["c", { n: 3 }]], removes: ["a"] });
      await settle();
      expect(seen[1]).toEqual({
        kind: "step",
        delta: { kind: "delta", upserts: [["c", { n: 3 }]], removes: ["a"] },
      });
      expect(acc()).toBe(2);
    });
  });

  it("a remove of a key nobody upserted reaches step UNFILTERED", async () => {
    // The tick coalescer resolves an upsert-then-remove within one producer tick to
    // a bare remove, so this frame is produced for real — and the contract obliges
    // `step` to be total over it rather than the framework quietly dropping it.
    await drive(async ({ view, push }) => {
      const { seen } = recordingFold(view);
      push({ kind: "snapshot", entries: [] });
      await settle();
      push({ kind: "delta", upserts: [], removes: ["never-seen"] });
      await settle();
      expect(seen[1]).toEqual({
        kind: "step",
        delta: { kind: "delta", upserts: [], removes: ["never-seen"] },
      });
    });
  });

  it("a reconnect snapshot RE-INITIALIZES rather than stepping", async () => {
    await drive(async ({ view, push }) => {
      const { seen, acc } = recordingFold(view);
      push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
      await settle();
      push({ kind: "delta", upserts: [["b", { n: 2 }]], removes: [] });
      await settle();
      expect(acc()).toBe(2);

      // The retry fence turns a transport drop into a fresh snapshot. The fold sees
      // "here is the whole set" and rebuilds — it never has to classify the frame.
      push({ kind: "snapshot", entries: [["z", { n: 9 }]] });
      await settle();
      expect(seen.map((s) => s.kind)).toEqual(["init", "step", "init"]);
      expect(acc()).toBe(1);
    });
  });

  it("folds run AFTER the store write, so step sees the frame already applied", async () => {
    await drive(async ({ view, push }) => {
      const observed: (V | undefined)[] = [];
      view.fold<number>({
        init: () => 0,
        step: (n) => {
          observed.push(view.byKey("a")?.());
          return n + 1;
        },
      });
      push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
      await settle();
      push({ kind: "delta", upserts: [["a", { n: 2 }]], removes: [] });
      await settle();
      expect(observed).toEqual([{ n: 2 }]);
    });
  });

  it("two folds over one collection both run, independently", async () => {
    await drive(async ({ view, push }) => {
      const count = view.fold<number>({
        init: (e) => e.length,
        step: (n, d) => n + d.upserts.length - d.removes.length,
      });
      const total = view.fold<number>({
        init: (e) => e.reduce((s, [, v]) => s + v.n, 0),
        step: (s, d) => s + d.upserts.reduce((x, [, v]) => x + v.n, 0),
      });
      push({ kind: "snapshot", entries: [["a", { n: 5 }]] });
      await settle();
      push({ kind: "delta", upserts: [["b", { n: 7 }]], removes: [] });
      await settle();
      expect(count()).toBe(2);
      expect(total()).toBe(12);
    });
  });

  it("the accumulator is a reactive read — a frame wakes its readers once", async () => {
    await drive(async ({ view, push }) => {
      const count = view.fold<number>({
        init: (e) => e.length,
        step: (n, d) => n + d.upserts.length,
      });
      let runs = 0;
      createEffect(() => {
        count();
        runs++;
      });
      await settle();
      expect(runs).toBe(1);
      push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
      await settle();
      expect(runs).toBe(2);
      push({ kind: "delta", upserts: [["b", { n: 2 }]], removes: [] });
      await settle();
      expect(runs).toBe(3);
    });
  });
});

describe("fold — arriving late is indistinguishable from a reconnect", () => {
  it("registering after a snapshot has landed seeds SYNCHRONOUSLY from the held store", async () => {
    await drive(async ({ view, push }) => {
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();
      push({ kind: "delta", upserts: [["c", { n: 3 }]], removes: ["a"] });
      await settle();

      // The keyed cache shares ONE slot per collection, so a late fold cannot be
      // handed the wire's snapshot back — it is handed the state that snapshot
      // produced, in arrival order, and reads it without waiting for a frame.
      const seen: [string, V][][] = [];
      // Its OWN root, and not cosmetically: this call runs after an `await` inside
      // the outer async `createRoot`, and Solid does not preserve an ambient owner
      // across one — a bare inline call here would be the ownerless registration the
      // suite below pins as a throw.
      let acc!: ReturnType<typeof view.fold<number>>;
      const disposeConsumer = createRoot((d) => {
        acc = view.fold<number>({
          init: (entries) => {
            seen.push(entries.map(([k, v]) => [k, v]));
            return entries.length;
          },
          step: (n, dd) => n + dd.upserts.length,
        });
        return d;
      });
      expect(seen).toEqual([
        [
          ["b", { n: 2 }],
          ["c", { n: 3 }],
        ],
      ]);
      expect(acc()).toBe(2);
      disposeConsumer();
    });
  });

  it("registering while pending reads undefined until the real snapshot lands", async () => {
    await drive(async ({ view, push }) => {
      const acc = view.fold<number>({
        init: (e) => e.length,
        step: (n) => n,
      });
      expect(acc()).toBeUndefined();
      await settle();
      expect(acc()).toBeUndefined();
      push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
      await settle();
      expect(acc()).toBe(1);
    });
  });
});

describe("fold — a fold is owned", () => {
  it("an OWNERLESS fold() throws rather than minting an accumulator nothing can drop", async () => {
    const { source } = controllableStream<Frame>();
    let view!: UseCollectionDeltasResult<string, V>;
    const dispose = createRoot((d) => {
      view = useCollectionDeltas(numberRows, { source });
      return d;
    });
    // Called with no reactive scope: the `onCleanup` that drops the registration
    // would warn-and-no-op, so the fold would accumulate for the life of the shared
    // collection slot. Crash instead of leaking.
    expect(() => view.fold({ init: () => 0, step: (n) => n })).toThrow(
      /reactive owner/,
    );
    dispose();
  });

  it("disposing the consumer's owner drops the fold; the collection keeps streaming", async () => {
    await drive(async ({ view, push }) => {
      let steps = 0;
      let disposeConsumer = (): void => {};
      createRoot((d) => {
        disposeConsumer = d;
        view.fold<number>({
          init: () => 0,
          step: (n) => {
            steps++;
            return n + 1;
          },
        });
      });
      push({ kind: "snapshot", entries: [] });
      await settle();
      push({ kind: "delta", upserts: [["a", { n: 1 }]], removes: [] });
      await settle();
      expect(steps).toBe(1);

      disposeConsumer();
      push({ kind: "delta", upserts: [["b", { n: 2 }]], removes: [] });
      await settle();
      expect(steps).toBe(1); // the dropped fold saw nothing more
      expect(view.byKey("b")?.()).toEqual({ n: 2 }); // the slot streams on
    });
  });
});

describe("fold — a throwing consumer callback is contained", () => {
  it("a throwing step kills neither the stream, nor the store, nor another fold", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await drive(async ({ view, push }) => {
        const healthy = view.fold<number>({
          init: (e) => e.length,
          step: (n, d) => n + d.upserts.length,
        });
        const poisoned = view.fold<number>({
          init: () => 0,
          step: () => {
            throw new Error("consumer step blew up");
          },
        });
        push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
        await settle();
        expect(poisoned()).toBe(0);

        push({ kind: "delta", upserts: [["b", { n: 2 }]], removes: [] });
        await settle();
        // The healthy fold and the store are untouched. The poisoned fold's
        // accumulator is INVALIDATED and its accessor says so — `undefined`, the one
        // state meaning "no valid accumulator" — rather than keeping a value that
        // reads live but can never advance. The throw was reported loudly.
        expect(healthy()).toBe(2);
        expect(view.byKey("b")?.()).toEqual({ n: 2 });
        expect(poisoned()).toBeUndefined();
        expect(errors).toHaveBeenCalledOnce();

        // Its accumulator was INVALIDATED, so later deltas do not land on a base
        // that failed to build — but the next snapshot re-seeds it.
        push({ kind: "delta", upserts: [["c", { n: 3 }]], removes: [] });
        await settle();
        expect(errors).toHaveBeenCalledOnce(); // step was not called again
        expect(poisoned()).toBeUndefined();
        push({ kind: "snapshot", entries: [["z", { n: 9 }]] });
        await settle();
        expect(poisoned()).toBe(0); // re-seeded by init, which does not throw
        expect(healthy()).toBe(1);
      });
    } finally {
      errors.mockRestore();
    }
  });

  it("a throwing init returns the accessor to undefined; the store applies the frame anyway", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await drive(async ({ view, push }) => {
        let allowed = true;
        const acc = view.fold<number>({
          init: (e) => {
            if (!allowed) throw new Error("consumer init blew up");
            return e.length;
          },
          step: (n) => n,
        });
        push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
        await settle();
        expect(acc()).toBe(1);

        allowed = false;
        push({
          kind: "snapshot",
          entries: [
            ["a", { n: 1 }],
            ["b", { n: 2 }],
          ],
        });
        await settle();
        expect(acc()).toBeUndefined(); // no valid accumulator, and it says so
        expect(errors).toHaveBeenCalledOnce();
        expect(view.keys()).toEqual(["a", "b"]); // the store applied it regardless

        // And it recovers: the next snapshot whose `init` succeeds re-seeds it.
        allowed = true;
        push({ kind: "snapshot", entries: [["c", { n: 3 }]] });
        await settle();
        expect(acc()).toBe(1);
      });
    } finally {
      errors.mockRestore();
    }
  });
});

describe("fold — a dead stream freezes the accumulator", () => {
  it("an upstream failure leaves the last fold value standing, like byKey", async () => {
    await drive(async ({ view, push, fail }) => {
      const acc = view.fold<number>({
        init: (e) => e.length,
        step: (n) => n,
      });
      push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
      await settle();
      fail(new Error("upstream gone"));
      await settle();
      expect(acc()).toBe(1);
      expect(view.byKey("a")?.error()?.message).toMatch(/upstream gone/);
    });
  });
});

describe("the batched stream's own health — the un-enrolled reach's only channel", () => {
  it("`stream` carries the SAME error/pending/complete every byKey accessor does", async () => {
    await drive(async ({ view, push, fail }) => {
      // Reachable BEFORE any key exists, which is the point: a consumer with no
      // `client.health()` fact to join has to be able to ask "is this feed alive"
      // without first having a present key to ask through.
      expect(view.stream.pending()).toBe(true);
      expect(view.stream.error()).toBeUndefined();
      expect(view.stream.complete()).toBe(false);

      push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
      await settle();
      expect(view.stream.pending()).toBe(false);
      const perKey = view.byKey("a");
      expect(perKey?.error).toBe(view.stream.error);
      expect(perKey?.pending).toBe(view.stream.pending);
      expect(perKey?.complete).toBe(view.stream.complete);

      fail(new Error("feed gone"));
      await settle();
      expect(view.stream.error()?.message).toMatch(/feed gone/);
    });
  });
});

describe("fold — a fold is seeded with the STORE's objects, whenever it registered", () => {
  /** A fold that keeps the entries of every full-set frame it was handed, by
   *  reference — the identity is the whole assertion here, so nothing is copied. */
  function seedRecordingFold(view: UseCollectionDeltasResult<string, V>) {
    const seeds: ReadonlyArray<readonly [string, V]>[] = [];
    view.fold<number>({
      init: (entries) => {
        seeds.push(entries);
        return entries.length;
      },
      step: (n) => n,
    });
    return seeds;
  }

  /** What `byKey` reads, past the store's read proxy — the object the store HOLDS,
   *  which is what a fold is handed and what the proxy is a view of. */
  const heldValue = (
    view: UseCollectionDeltasResult<string, V>,
    key: string,
  ): V => unwrap(view.byKey(key)?.() as V);

  it("a wire snapshot seeds init with the values byKey reads, not the wire's own", async () => {
    await drive(async ({ view, push }) => {
      const seeds = seedRecordingFold(view);
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();
      expect(seeds[0]?.map(([k]) => k)).toEqual(["a", "b"]);
      for (const [k, v] of seeds[0] ?? []) expect(v).toBe(heldValue(view, k));
    });
  });

  it("a reconnect that re-serializes an equal value seeds the object already HELD", async () => {
    // The sharp arm. `applySnapshot` is value-diffed, so an entry the wire re-sent
    // unchanged keeps the object the store already had and the wire's fresh copy is
    // dropped. Seeding folds from `msg.entries` handed them that dropped copy —
    // objects `byKey` would never return, and a second set of them per link flap.
    await drive(async ({ view, push }) => {
      const seeds = seedRecordingFold(view);
      push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
      await settle();
      const firstConnect = heldValue(view, "a");

      // A link flap: the same content, freshly decoded into a different object.
      const reSerialized = { n: 1 };
      push({
        kind: "snapshot",
        entries: [
          ["a", reSerialized],
          ["b", { n: 2 }],
        ],
      });
      await settle();

      expect(seeds).toHaveLength(2);
      const [aKey, aValue] = seeds[1]?.[0] as readonly [string, V];
      expect(aKey).toBe("a");
      expect(aValue).toBe(firstConnect); // the store's object, kept across the flap
      expect(aValue).not.toBe(reSerialized); // NOT the copy the store discarded
      // The entry the flap really did change is the wire's new object — because the
      // store adopted it. Same rule, not an exception to it.
      for (const [k, v] of seeds[1] ?? []) expect(v).toBe(heldValue(view, k));
    });
  });

  it("registering mid-stream hands over the SAME objects a fold alive across the snapshot got", async () => {
    await drive(async ({ view, push }) => {
      const early = seedRecordingFold(view);
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();

      // Its OWN root: this runs after an `await`, and Solid does not carry an
      // ambient owner across one (see the mid-stream suite above).
      let late: ReadonlyArray<readonly [string, V]>[] = [];
      const disposeConsumer = createRoot((d) => {
        late = seedRecordingFold(view);
        return d;
      });
      expect(late[0]).toEqual(early[0]);
      expect(late[0]?.map(([, v]) => v)).toEqual(early[0]?.map(([, v]) => v));
      for (const [i, [, v]] of (late[0] ?? []).entries()) {
        expect(v).toBe(early[0]?.[i]?.[1]); // identical objects, not merely equal
      }
      disposeConsumer();
    });
  });
});
