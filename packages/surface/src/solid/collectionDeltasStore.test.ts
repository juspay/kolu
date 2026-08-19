/**
 * The batched `deltas` store's REACTIVE contract — what a frame costs the readers
 * that were not named in it.
 *
 * `useCollectionDeltas` used to route every frame through `createSubscription`'s
 * generic reduce: a fold that copied the whole `byKey` dictionary per delta and
 * returned a fresh accumulator, which `reconcile` then walked in full to rediscover
 * the keys the frame had already named. Two O(N) passes per O(|frame|) update. The
 * hook owns its store now and writes exactly the keys the frame names.
 *
 * That is only a real win if the OBSERVABLE behaviour holds, so this file pins the
 * three facts the rewrite could plausibly have broken — counted in re-notifications,
 * not in microseconds:
 *
 *   1. a delta re-notifies ONLY the keys it named (and `keys()` only when membership
 *      actually moved);
 *   2. a reconnect snapshot whose entries are unchanged is a VISUAL NO-OP — the
 *      retry fence deliberately turns a transport drop into a fresh snapshot rather
 *      than an error, and a link flap must not repaint the screen;
 *   3. a changed entry is REPLACED, never merged into the object standing there —
 *      that object is the same one a `fold` consumer may be holding.
 */

import { Schema } from "effect";
import { createEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import type { CollectionDeltasMsg } from "../define";
import { collection } from "../index";
import { controllableStream } from "./controllableStream.testlib";
import { useCollectionDeltas } from "./useCollection";

interface V {
  readonly n: number;
}

const rows = collection({
  name: "rows",
  keySchema: Schema.String,
  schema: Schema.Struct({ n: Schema.Number }),
});

/** Two microtask turns — enough for one pushed frame to cross the stream fiber and
 *  land in the store, plus the effect flush that follows it. */
const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

async function drive(
  body: (ctx: {
    view: ReturnType<typeof useCollectionDeltas<"rows", string, V>>;
    push: (frame: CollectionDeltasMsg<string, V>) => void;
  }) => Promise<void>,
): Promise<void> {
  await createRoot(async (dispose) => {
    const { source, push } =
      controllableStream<CollectionDeltasMsg<string, V>>();
    const view = useCollectionDeltas(rows, { source });
    try {
      await body({ view, push });
    } finally {
      dispose();
    }
  });
}

describe("the deltas store — a frame re-notifies only what it named", () => {
  it("a delta wakes the keys it upserts and nothing else; keys() stays quiet on a values-only tick", async () => {
    await drive(async ({ view, push }) => {
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();

      // One effect per key plus one on the key set. Each counts its own runs, so a
      // frame's blast radius is a number, not an impression.
      const runs = { a: 0, b: 0, keys: 0 };
      createEffect(() => {
        view.byKey("a")?.();
        runs.a++;
      });
      createEffect(() => {
        view.byKey("b")?.();
        runs.b++;
      });
      createEffect(() => {
        view.keys();
        runs.keys++;
      });
      await settle();
      expect(runs).toEqual({ a: 1, b: 1, keys: 1 });

      // A delta naming ONLY "a": "b"'s reader must not wake, and the key set did
      // not move, so `keys()` must not wake either.
      push({ kind: "delta", upserts: [["a", { n: 9 }]], removes: [] });
      await settle();
      expect(runs).toEqual({ a: 2, b: 1, keys: 1 });
      expect(view.byKey("a")?.()).toEqual({ n: 9 });

      // A delta that MOVES membership wakes `keys()` — and the new key's arrival
      // still does not wake the untouched "b".
      push({ kind: "delta", upserts: [["c", { n: 3 }]], removes: [] });
      await settle();
      expect(runs).toEqual({ a: 2, b: 1, keys: 2 });
      expect(view.keys()).toEqual(["a", "b", "c"]);
    });
  });
});

describe("the deltas store — a reconnect snapshot is a visual no-op", () => {
  it("re-serialized-but-equal entries do not re-notify; only the entry that actually changed does", async () => {
    await drive(async ({ view, push }) => {
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();

      const runs = { a: 0, b: 0, keys: 0 };
      createEffect(() => {
        view.byKey("a")?.();
        runs.a++;
      });
      createEffect(() => {
        view.byKey("b")?.();
        runs.b++;
      });
      createEffect(() => {
        view.keys();
        runs.keys++;
      });
      await settle();
      expect(runs).toEqual({ a: 1, b: 1, keys: 1 });

      // The retry fence's reconnect: the SAME content, freshly decoded into new
      // objects. Reference equality would read every entry as changed; the store
      // diffs by VALUE, so nothing repaints.
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();
      expect(runs).toEqual({ a: 1, b: 1, keys: 1 });

      // A snapshot that genuinely differs in ONE entry wakes exactly that reader.
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 7 }],
        ],
      });
      await settle();
      expect(runs).toEqual({ a: 1, b: 2, keys: 1 });
      expect(view.byKey("b")?.()).toEqual({ n: 7 });
    });
  });

  it("a snapshot that drops a key removes it and wakes keys(), leaving survivors alone", async () => {
    await drive(async ({ view, push }) => {
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();
      const runs = { a: 0, keys: 0 };
      createEffect(() => {
        view.byKey("a")?.();
        runs.a++;
      });
      createEffect(() => {
        view.keys();
        runs.keys++;
      });
      await settle();

      push({ kind: "snapshot", entries: [["a", { n: 1 }]] });
      await settle();
      expect(view.byKey("b")).toBeUndefined();
      expect(view.keys()).toEqual(["a"]);
      expect(runs).toEqual({ a: 1, keys: 2 });
    });
  });
});

describe("the deltas store — an adopted frame object is frozen, not recycled", () => {
  it("a later frame REPLACES the leaf; the object the store previously adopted is untouched", async () => {
    // The aliasing contract folds lean on: `fold` receives the wire's own frame
    // objects, and the store adopts those SAME objects. If the store merged a later
    // value into the object standing there — Solid's own default for a nested store
    // write — a fold holding it would silently watch its retained value mutate.
    await drive(async ({ view, push }) => {
      const first = { n: 1 };
      push({ kind: "snapshot", entries: [["a", first]] });
      await settle();
      push({ kind: "delta", upserts: [["a", { n: 2 }]], removes: [] });
      await settle();
      expect(view.byKey("a")?.()).toEqual({ n: 2 });
      expect(first).toEqual({ n: 1 });

      // Same law across a snapshot boundary.
      const second = { n: 2 };
      push({ kind: "snapshot", entries: [["a", second]] });
      await settle();
      push({ kind: "delta", upserts: [["a", { n: 3 }]], removes: [] });
      await settle();
      expect(view.byKey("a")?.()).toEqual({ n: 3 });
      expect(second).toEqual({ n: 2 });
    });
  });
});
