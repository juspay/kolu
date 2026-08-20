/**
 * The merge law: **a row object in the store never comes to hold a different
 * record.**
 *
 * That is what `reconcile`'s `key` decides, and it is where the defect lived.
 * With Solid's default (`key: "id"`) every element of a payload that has no
 * top-level `id` reads its key as `undefined`, so the diff treats them all as one
 * key and RECYCLES the previous row objects positionally — mutating a new
 * record's fields into the object that used to be a different record. A reader
 * that goes by position never notices; a reader that goes by identity (a `<For>`
 * keyed by reference, a per-row memo, a component holding a row across frames)
 * sees a row whose identity and whose fields disagree.
 *
 * The identity assertions below FAIL on `reconcile(next)` and pass on
 * `reconcile(next, { key: null })`. The value assertions pass on both — and are
 * kept, and said to be kept, so nobody mistakes them for the reproduction: on
 * Solid 1.9 the two spellings agree on VALUES (checked across 4,000 randomised
 * shape × edit pairs while writing this). Pinning only values would be a vacuous
 * suite for this change.
 *
 * The edits are the ones that MOVE records — mid-insert, mid-delete, reorder.
 * End-appends and in-place field rewrites move nothing, so they recycle correctly
 * even under a wrong key, which is exactly how a downstream e2e suite made of
 * those two edits stayed green over a live view that was broken for every other
 * kind of edit.
 *
 * The second half of the file is the same law from the other side: what a member
 * that DECLARES its array key gets, and what it costs the member that doesn't.
 * Guessing an identity is the defect; being told one is not, and the difference
 * between them is a spec field with a call site.
 */

import { $TRACK, createComputed, createRoot } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { describe, expect, it } from "vitest";
import { writeWrappedValue } from "./writeValue";

/** The reported shape: an ordered record whose identity is NOT a top-level `id`.
 *  Nothing about it is unusual — it is what a payload looks like whenever the app
 *  didn't happen to name a field `id`. */
interface Located {
  file: string;
  line: number;
  node: { id: string; title: string };
}

const rows = (ids: readonly string[]): Located[] =>
  ids.map((id, i) => ({
    file: "roadmap.jsonl",
    line: i + 1,
    node: { id, title: `title of ${id}` },
  }));

/** What a row LOOKED LIKE at the moment it was observed, paired with the object
 *  it was. Recorded eagerly and never re-read, because the whole point is that a
 *  recycled object is MUTATED IN PLACE by the next merge — reading `r.node.id`
 *  later would report the id the row ended up with, not the one it had, and the
 *  test would quietly assert nothing. */
type Seen = { readonly ref: Located; readonly idAtTheTime: string };

const observe = (rs: readonly Located[]): Seen[] =>
  rs.map((r) => ({ ref: r, idAtTheTime: r.node.id }));

/** Write a sequence of full snapshots through the real seam, recording — after
 *  each write, before the next — the raw (unwrapped) rows and the record each one
 *  held. Raw, because the law under test is about OBJECT IDENTITY, which a store
 *  proxy would hide. */
function merge(frames: readonly Located[][]): {
  steps: Seen[][];
  final: Located[];
} {
  return createRoot((dispose) => {
    const [store, setStore] = createStore<{ v: Located[] | undefined }>({
      v: undefined,
    });
    const steps: Seen[][] = [];
    for (const frame of frames) {
      writeWrappedValue(setStore, frame);
      steps.push(observe((unwrap(store).v ?? []) as Located[]));
    }
    const final = ((unwrap(store).v ?? []) as Located[]).slice();
    dispose();
    return { steps, final };
  });
}

/** Every object that survives a merge must still describe the record it described
 *  before it. A surviving object holding a DIFFERENT record is the defect, in one
 *  sentence — and it is a defect a consumer feels directly, because that object
 *  is the row a component may have captured and may still be reading. */
function assertNoRecycledIdentity(
  before: readonly Seen[],
  after: readonly Located[],
): void {
  const wasById = new Map(before.map((s) => [s.ref, s.idAtTheTime] as const));
  for (const row of after) {
    const previousId = wasById.get(row);
    if (previousId === undefined) continue; // a fresh object — nothing to recycle
    expect(row.node.id).toBe(previousId);
  }
}

const ids = (rs: readonly Located[]): string[] => rs.map((r) => r.node.id);

describe("the store merge never recycles a row object across records", () => {
  it("MID-INSERT: no surviving object changes which record it holds", () => {
    const { steps, final } = merge([
      rows(["a", "b", "c"]),
      rows(["a", "mid", "b", "c"]),
    ]);
    const before = steps[0];
    if (before === undefined) throw new Error("no first frame");
    // The failing assertion under the default key: `b`'s object survives at
    // index 1 holding `mid`.
    assertNoRecycledIdentity(before, final);
    // …and the value is right either way, stated so the suite reads honestly.
    expect(ids(final)).toEqual(["a", "mid", "b", "c"]);
  });

  it("MID-DELETE: the rows that remain are still their own objects' records", () => {
    const { steps, final } = merge([
      rows(["a", "b", "c", "d"]),
      rows(["a", "c", "d"]),
    ]);
    const before = steps[0];
    if (before === undefined) throw new Error("no first frame");
    assertNoRecycledIdentity(before, final);
    expect(ids(final)).toEqual(["a", "c", "d"]);
  });

  it("REORDER: a title never ends up on another record's object", () => {
    const { steps, final } = merge([
      rows(["a", "b", "c", "d"]),
      rows(["d", "c", "b", "a"]),
    ]);
    const before = steps[0];
    if (before === undefined) throw new Error("no first frame");
    assertNoRecycledIdentity(before, final);
    expect(ids(final)).toEqual(["d", "c", "b", "a"]);
    for (const row of final) {
      expect(row.node.title).toBe(`title of ${row.node.id}`);
    }
  });

  it("holds across successive frames — a mid-insert then an end-append", () => {
    // The "live until the first hard edit" case: whatever a bad merge leaves
    // behind is what every later frame merges into.
    const { steps, final } = merge([
      rows(["a", "b", "c"]),
      rows(["a", "mid", "b", "c"]),
      rows(["a", "mid", "b", "c", "end"]),
    ]);
    for (let i = 1; i < steps.length; i++) {
      const before = steps[i - 1];
      const after = steps[i];
      if (before === undefined || after === undefined) throw new Error("frame");
      assertNoRecycledIdentity(
        before,
        after.map((s) => s.ref),
      );
    }
    expect(ids(final)).toEqual(["a", "mid", "b", "c", "end"]);
    expect(new Set(ids(final)).size).toBe(final.length);
  });

  it("a payload that DOES carry a top-level `id` is not keyed by it either", () => {
    // A statement of the rule, not a regression. No member definition declares
    // that a field named `id` is an identity, so the framework does not read it
    // as one — the merge is positional whatever the payload happens to be called.
    const before = [
      { id: "1", label: "one" },
      { id: "2", label: "two" },
    ];
    const after = [
      { id: "0", label: "zero" },
      { id: "1", label: "one" },
      { id: "2", label: "two" },
    ];
    type Row = { id: string; label: string };
    const got = createRoot((dispose) => {
      const [store, setStore] = createStore<{ v: Row[] | undefined }>({
        v: undefined,
      });
      writeWrappedValue(setStore, before);
      // Eagerly, for the same reason as `observe` above: a recycled object is
      // mutated in place, so its `id` must be read now, not after the next write.
      const first = ((unwrap(store).v ?? []) as Row[]).map(
        (r) => [r, r.id] as const,
      );
      writeWrappedValue(setStore, after);
      const second = ((unwrap(store).v ?? []) as Row[]).slice();
      dispose();
      return { first: new Map(first), second };
    });
    for (const row of got.second) {
      const previousId = got.first.get(row);
      if (previousId !== undefined) expect(row.id).toBe(previousId);
    }
    expect(got.second.map((r) => r.id)).toEqual(["0", "1", "2"]);
  });

  it("a primitive value is assigned, not merged", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{ v: number | undefined }>({
        v: undefined,
      });
      writeWrappedValue(setStore, 1);
      expect(store.v).toBe(1);
      writeWrappedValue(setStore, 2);
      expect(store.v).toBe(2);
      dispose();
    });
  });
});

/**
 * The DECLARED half of the same law: when a member says what identifies an
 * element of an array in its value, a frame that says the same thing must be a
 * no-op — nothing replaced, nothing notified.
 *
 * These are the `@olai/format` shapes from the downstream audit, because they are
 * what forced the declaration: one value carrying `rows` (identified by `key`) and
 * `names` (carrying no such field at all). The counts below are the audit's §6
 * replay, run through this seam: an identical frame notifies `rows[$TRACK]` and
 * `rows[0].node.title` ONCE EACH with no declaration, and ZERO times with one.
 */

interface Row {
  key: string;
  node: { id: string; title: string };
}
interface Reading {
  rows: Row[];
  names: { id: string; title: string }[];
}

const readingOf = (keys: readonly string[]): Reading => ({
  rows: keys.map((k) => ({ key: k, node: { id: k, title: `title of ${k}` } })),
  names: keys.map((k) => ({ id: k, title: `title of ${k}` })),
});

/** The MEMBERSHIP read a keyed list makes: `$TRACK` is the store's own "which
 *  elements are these" signal, and it is exactly what `<For>` / `mapArray`
 *  subscribe to — so counting its notifications counts list rebuilds. Reached
 *  through a cast because `$TRACK` is a symbol key the array TYPE has no member
 *  for; the store proxy is what answers it. */
const trackMembership = (arr: unknown): void => {
  void (arr as Record<symbol, unknown> | undefined)?.[$TRACK];
};

/** Replay `frames` through the seam under `arrayKey`, counting how many times each
 *  of two reads NOTIFIES after the first frame has been observed: the array's
 *  membership (`$TRACK` — what a keyed `<For>`/`<Key>` re-diffs on) and one leaf
 *  deep inside an element (what every per-row binding reads). */
function replay(
  frames: readonly Reading[],
  arrayKey?: string,
): { track: number; leaf: number; rowsAfter: Row[] } {
  return createRoot((dispose) => {
    const [store, setStore] = createStore<{ v: Reading | undefined }>({
      v: undefined,
    });
    const first = frames[0];
    if (first === undefined) throw new Error("no first frame");
    writeWrappedValue(setStore, first, arrayKey);
    let track = -1;
    let leaf = -1;
    // `createComputed`, not `createEffect`: it runs synchronously on write, so the
    // counts are the store's own notifications and not a scheduler's coalescing.
    createComputed(() => {
      trackMembership(store.v?.rows);
      track++;
    });
    createComputed(() => {
      void store.v?.rows[0]?.node.title;
      leaf++;
    });
    for (const frame of frames.slice(1))
      writeWrappedValue(setStore, frame, arrayKey);
    const rowsAfter = ((unwrap(store).v?.rows ?? []) as Row[]).slice();
    dispose();
    return { track, leaf, rowsAfter };
  });
}

describe("a DECLARED array key recycles by that key instead of replacing", () => {
  const KEYS = ["a", "b", "c"];

  it("UNDECLARED: an identical frame replaces every element and notifies", () => {
    // The red line. This is Fact B of the audit, measured here rather than quoted:
    // with no declaration the merge diffs arrays BY REFERENCE, nothing off the wire
    // is `===` what came before, so membership and every leaf fire on a frame that
    // said nothing new.
    const { track, leaf } = replay([readingOf(KEYS), readingOf(KEYS)]);
    expect(track).toBe(1);
    expect(leaf).toBe(1);
  });

  it("DECLARED: an identical frame notifies nothing at all", () => {
    const { track, leaf } = replay([readingOf(KEYS), readingOf(KEYS)], "key");
    expect(track).toBe(0);
    expect(leaf).toBe(0);
  });

  it("DECLARED: a row object survives a frame and still holds its own record", () => {
    const before = createRoot((dispose) => {
      const [store, setStore] = createStore<{ v: Reading | undefined }>({
        v: undefined,
      });
      writeWrappedValue(setStore, readingOf(KEYS), "key");
      const kept = (unwrap(store).v as Reading).rows.slice();
      writeWrappedValue(setStore, readingOf(KEYS), "key");
      const after = (unwrap(store).v as Reading).rows.slice();
      dispose();
      return { kept, after };
    });
    expect(before.after[0]).toBe(before.kept[0]);
    expect(before.after[1]).toBe(before.kept[1]);
    expect(before.after[2]).toBe(before.kept[2]);
    expect(before.after.map((r) => r.node.id)).toEqual(KEYS);
  });

  it("DECLARED: a REORDER moves the objects rather than rewriting them", () => {
    const kept = createRoot((dispose) => {
      const [store, setStore] = createStore<{ v: Reading | undefined }>({
        v: undefined,
      });
      writeWrappedValue(setStore, readingOf(["a", "b", "c"]), "key");
      const byKey = new Map(
        (unwrap(store).v as Reading).rows.map((r) => [r.key, r] as const),
      );
      writeWrappedValue(setStore, readingOf(["c", "a", "b"]), "key");
      const after = (unwrap(store).v as Reading).rows.slice();
      dispose();
      return { byKey, after };
    });
    expect(kept.after.map((r) => r.key)).toEqual(["c", "a", "b"]);
    // The same three objects, in a new order — the identity a keyed `<For>` follows.
    expect(kept.after[0]).toBe(kept.byKey.get("c"));
    expect(kept.after[1]).toBe(kept.byKey.get("a"));
    expect(kept.after[2]).toBe(kept.byKey.get("b"));
  });

  it("DECLARED: a mid-insert keeps every surviving row on its own record", () => {
    const seen = createRoot((dispose) => {
      const [store, setStore] = createStore<{ v: Reading | undefined }>({
        v: undefined,
      });
      writeWrappedValue(setStore, readingOf(["a", "b", "c"]), "key");
      const was = (unwrap(store).v as Reading).rows.map(
        (r) => [r, r.node.id] as const,
      );
      writeWrappedValue(setStore, readingOf(["a", "mid", "b", "c"]), "key");
      const after = (unwrap(store).v as Reading).rows.slice();
      dispose();
      return { was: new Map(was), after };
    });
    for (const row of seen.after) {
      const previousId = seen.was.get(row);
      if (previousId !== undefined) expect(row.node.id).toBe(previousId);
    }
    expect(seen.after.map((r) => r.key)).toEqual(["a", "mid", "b", "c"]);
  });

  it("DECLARED: an array whose elements DON'T carry the key merges by position", () => {
    // Not a fallback — the stated reach of the declaration. `names` carries no
    // `key`, so this member declared no identity for it; Solid then merges those
    // elements BY POSITION, which is what keeps an identical frame silent for them
    // too. A consumer that needs `names` identity declares `id` instead (one key
    // per member) or reads them by value.
    const kept = createRoot((dispose) => {
      const [store, setStore] = createStore<{ v: Reading | undefined }>({
        v: undefined,
      });
      writeWrappedValue(setStore, readingOf(["a", "b"]), "key");
      const was = (unwrap(store).v as Reading).names.slice();
      writeWrappedValue(setStore, readingOf(["a", "b"]), "key");
      const after = (unwrap(store).v as Reading).names.slice();
      dispose();
      return { was, after };
    });
    expect(kept.after[0]).toBe(kept.was[0]);
    expect(kept.after[1]).toBe(kept.was[1]);
    expect(kept.after.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("a primitive value is still assigned, declaration or not", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{ v: number | undefined }>({
        v: undefined,
      });
      writeWrappedValue(setStore, 1, "key");
      expect(store.v).toBe(1);
      writeWrappedValue(setStore, 2, "key");
      expect(store.v).toBe(2);
      dispose();
    });
  });
});
