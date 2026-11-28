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
 *   3. a changed entry is MERGED into the one standing there, leaf by leaf, so a
 *      delta that moved one field does not wake the record's other readers — and
 *      the frame object a `fold` consumer may be holding is still never written
 *      through, because the merge ADOPTS the incoming frame rather than mutating
 *      what it replaces.
 */

import { Schema } from "effect";
import { createEffect } from "solid-js";
import { describe, expect, it } from "vitest";
import { collection } from "../index";
import { framesEqual } from "./createSubscription";
import {
  type DeltasHarness,
  driveDeltas,
  type NumberRow as V,
  numberRows,
  settle,
} from "./deltasHarness.testlib";

const drive = (
  body: (ctx: DeltasHarness<string, V>) => Promise<void>,
): Promise<void> => driveDeltas(numberRows, body);

/** An entry with MORE THAN ONE fact in it — the shape the leaf-grain claim needs,
 *  and the shape a real collection's value has. The shared `NumberRow` fixture
 *  carries one number on purpose, so it cannot tell "this field moved" from "this
 *  record moved". Only `name` is read at runtime; the schema types `T` at the call
 *  site. */
interface Row {
  readonly title: string;
  readonly git: { readonly repoRoot: string };
}
const records = collection({
  name: "records",
  keySchema: Schema.String,
  schema: Schema.Any,
});

describe("the deltas store — a frame re-notifies only what it named", () => {
  it("a delta wakes the keys it upserts and nothing else; keys() stays quiet on a values-only tick", async () => {
    await drive(async ({ view, push, observe }) => {
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();

      // One effect per key plus one on the key set. The compute does the tracked
      // read, the effect phase counts its own runs, so a frame's blast radius is a
      // number, not an impression. Built through `observe` — the root's owner is
      // out of scope after the `await` above.
      // The computes read a LEAF, which is what a consumer reads: the store tracks
      // leaves, so a record's reader is woken by the field it reads, not by the
      // arrival of a container.
      const runs = { a: 0, b: 0, keys: 0 };
      observe(() => {
        createEffect(
          () => view.byKey("a")?.()?.n,
          () => {
            runs.a++;
          },
        );
        createEffect(
          () => view.byKey("b")?.()?.n,
          () => {
            runs.b++;
          },
        );
        createEffect(
          () => view.keys(),
          () => {
            runs.keys++;
          },
        );
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
    await drive(async ({ view, push, observe }) => {
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();

      // Built through `observe`: the root's owner is out of scope after the
      // `await` above, and an ownerless effect is never disposed.
      const runs = { a: 0, b: 0, keys: 0 };
      observe(() => {
        createEffect(
          () => view.byKey("a")?.()?.n,
          () => {
            runs.a++;
          },
        );
        createEffect(
          () => view.byKey("b")?.()?.n,
          () => {
            runs.b++;
          },
        );
        createEffect(
          () => view.keys(),
          () => {
            runs.keys++;
          },
        );
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
    await drive(async ({ view, push, observe }) => {
      push({
        kind: "snapshot",
        entries: [
          ["a", { n: 1 }],
          ["b", { n: 2 }],
        ],
      });
      await settle();
      const runs = { a: 0, keys: 0 };
      observe(() => {
        createEffect(
          () => view.byKey("a")?.(),
          () => {
            runs.a++;
          },
        );
        createEffect(
          () => view.keys(),
          () => {
            runs.keys++;
          },
        );
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
  it("a later frame is MERGED over the leaf; the object the store previously adopted is untouched", async () => {
    // The aliasing contract folds lean on: `fold` receives the wire's own frame
    // objects, and the store adopts those SAME objects. The merge the store writes
    // an entry with does not threaten them — `reconcile` adopts the incoming frame
    // by pointer swap at every level it reaches and never writes through what stood
    // there — and this pins that, because a merge that DID write through is how a
    // fold would silently watch its retained value mutate.
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

describe("the deltas store — a changed entry moves its leaves, not the record", () => {
  it("a delta that rewrites one field wakes that field's readers alone, keeps the record's identity, and leaves the frame it replaced untouched", async () => {
    // A real entry carries several facts at once, and its readers read ONE of them:
    // the dock reads a terminal's title while the right panel hangs its repo-keyed
    // queries off `git.repoRoot`. A frame that rewrote the record WHOLE woke both
    // for the one field that moved — the record's reference turned over, every leaf
    // node under it was written, and a consumer keyed on the reference remounted.
    await driveDeltas<string, Row>(records, async ({ view, push, observe }) => {
      const first: Row = { title: "one", git: { repoRoot: "/p" } };
      push({ kind: "snapshot", entries: [["a", first]] });
      await settle();

      const runs = { title: 0, repoRoot: 0, record: 0 };
      let seen: Row | undefined;
      observe(() => {
        createEffect(
          () => view.byKey("a")?.()?.title,
          () => {
            runs.title++;
          },
        );
        createEffect(
          () => view.byKey("a")?.()?.git.repoRoot,
          () => {
            runs.repoRoot++;
          },
        );
        createEffect(
          () => view.byKey("a")?.(),
          (record) => {
            runs.record++;
            seen = record;
          },
        );
      });
      await settle();
      expect(runs).toEqual({ title: 1, repoRoot: 1, record: 1 });
      const recordBefore = seen;

      push({
        kind: "delta",
        upserts: [["a", { title: "two", git: { repoRoot: "/p" } }]],
        removes: [],
      });
      await settle();
      expect(runs).toEqual({ title: 2, repoRoot: 1, record: 1 });
      expect(view.byKey("a")?.()).toEqual({
        title: "two",
        git: { repoRoot: "/p" },
      });
      // The record keeps the proxy it had: a consumer holding the row does not
      // see a new object for a field it does not read.
      expect(view.byKey("a")?.()).toBe(recordBefore);
      // And the frame the store adopted first is not written through.
      expect(first).toEqual({ title: "one", git: { repoRoot: "/p" } });

      // The nested fact moving wakes ITS reader, and only it.
      push({
        kind: "delta",
        upserts: [["a", { title: "two", git: { repoRoot: "/q" } }]],
        removes: [],
      });
      await settle();
      expect(runs).toEqual({ title: 2, repoRoot: 2, record: 1 });
    });
  });
});

describe("the frame comparator — the store leaves no tag, so every symbol is content", () => {
  it("an object the store has wrapped still compares equal to identical fresh content", async () => {
    // The law the value-diff serves: an entry someone is WATCHING must not
    // re-notify on a reconnect that re-serialized the same content. The "reconnect
    // is a no-op" cases above pin that end-to-end; this one names the mechanism,
    // which is that there is no mechanism left to need. The store adopts a value
    // by pointer swap, tracks the wrapping in a private lookup and clones before
    // a draft write, so an object it has wrapped carries exactly the own symbols
    // it arrived with — the comparator has nothing to exempt, and every own
    // symbol it meets is frame content.
    await drive(async ({ view, push }) => {
      const first = { n: 1 };
      push({ kind: "snapshot", entries: [["a", first]] });
      await settle();
      // Force the store to wrap the value — the read a rendered row performs.
      expect(view.byKey("a")?.()).toEqual({ n: 1 });
      expect(Object.getOwnPropertySymbols(first)).toEqual([]);
      expect(framesEqual(first, { n: 1 })).toBe(true);
    });
  });

  it("an own symbol forces inequality — there is no exception to carve out", async () => {
    // Every own symbol is content: the comparator cannot see it through
    // `getOwnPropertyNames`, nothing else compares it, and it refuses to claim an
    // equality it cannot prove.
    const tagged: Record<string, number> = { n: 1 };
    Object.defineProperty(tagged, Symbol("app-tag"), { value: 7 });
    expect(framesEqual(tagged, { n: 1 })).toBe(false);
    expect(framesEqual({ n: 1, [Symbol.for("app")]: 7 }, { n: 1 })).toBe(false);
  });
});
