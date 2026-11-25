/**
 * The merge law: **a row in the store never comes to hold a different record.**
 *
 * That is what `reconcile`'s `key` decides, and it is where the defect lived.
 * What a merge can carry across frames is the store's PROXY for a row — the row
 * identity every consumer actually holds (a `<For>` item, a per-row memo, a
 * component that captured a row) — because Solid 2 never mutates a frame: it
 * ADOPTS one as the store's backing, so the raw value is always the newest
 * frame's and `snapshot(store)` can tell you nothing about what survived. Per
 * array slot a merge either hands the standing proxy the incoming element or
 * drops it for a fresh one; a proxy that is handed ANOTHER RECORD's element is
 * the defect, in one sentence, and it is one a consumer feels directly.
 *
 * The identity assertions below FAIL under `reconcile(next, null)` — Solid 2's
 * positional merge — and pass under the undeclared key this package passes
 * instead. The value assertions pass under both, and are kept, and said to be
 * kept, so nobody mistakes them for the reproduction: the two spellings agree
 * on VALUES, and differ only in which proxies survive and therefore which
 * readers notify. Pinning only values would be a vacuous suite for this change.
 *
 * Identity only EXISTS where something is observing: with a key, a merge adopts
 * a child only where a node lives below it (`@solidjs/signals` 2.0.4
 * `dist/dev.js` `descend` :6809), so an unread row is replaced whatever the key
 * says. Every identity test here therefore OBSERVES the rows it then compares,
 * which is also what a rendered list does.
 *
 * The edits are the ones that MOVE records — mid-insert, mid-delete, reorder.
 * End-appends and in-place field rewrites move nothing, so they merge correctly
 * even under a wrong key, which is exactly how a downstream e2e suite made of
 * those two edits stayed green over a live view that was broken for every other
 * kind of edit.
 *
 * The second half of the file is the same law from the other side: what a member
 * that DECLARES its array key gets, and what it costs the member that doesn't.
 * Guessing an identity is the defect; being told one is not, and the difference
 * between them is a spec field with a call site.
 */

import {
  $TRACK,
  createEffect,
  createRoot,
  createStore,
  flush,
  snapshot,
  type StoreSetter,
} from "solid-js";
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

/** A store whose writes happen OUTSIDE its owner — a store write inside a
 *  component body, a memo or `createRoot`'s own body is the owned-scope
 *  violation the dev build throws on, and every write a subscription makes is in
 *  an effect phase or a fiber handler for exactly that reason. `flush()` after
 *  each write because a setter's value lands on the next microtask: these tests
 *  are the imperative boundary that must see the merge before it asserts. */
interface Harness<T> {
  readonly store: { v: T | undefined };
  readonly write: (next: T, arrayKey?: string) => void;
  readonly observe: (register: () => void) => void;
  readonly dispose: () => void;
}

function harness<T>(): Harness<T> {
  const [store, setStore, dispose] = createRoot((d) => {
    const [s, set] = createStore<{ v: T | undefined }>({ v: undefined });
    return [s, set as StoreSetter<{ v: T | undefined }>, d] as const;
  });
  let stopObservers: (() => void) | undefined;
  return {
    store,
    write: (next, arrayKey) => {
      writeWrappedValue(setStore, next, arrayKey);
      flush();
    },
    observe: (register) => {
      stopObservers = createRoot((d) => {
        register();
        return d;
      });
      flush();
    },
    dispose: () => {
      stopObservers?.();
      dispose();
    },
  };
}

/** Observe every row deeply, the way a rendered list does — one effect whose
 *  COMPUTE reads a leaf inside each row, so each row's target carries a node and
 *  its identity is a thing the store preserves rather than a thing nobody can
 *  see. The effect phase does nothing; what the test needs is the subscription. */
function watchEach<R>(
  read: () => readonly R[] | undefined,
  leaf: (row: R) => unknown,
): void {
  createEffect(
    () => (read() ?? []).map(leaf).join("\u0000"),
    () => {},
  );
}

/** What a row LOOKED LIKE at the moment it was observed, paired with the proxy it
 *  was. Recorded eagerly and never re-read, because the whole point is that a
 *  recycled proxy reads the record it was HANDED — reading `r.node.id` later
 *  would report the id the row ended up with, not the one it had, and the test
 *  would quietly assert nothing. */
type Seen = { readonly proxy: Located; readonly idAtTheTime: string };

const observe = (rs: readonly Located[]): Seen[] =>
  rs.map((r) => ({ proxy: r, idAtTheTime: r.node.id }));

/** Write a sequence of full snapshots through the real seam, recording — after
 *  each write, before the next — the row PROXIES and the record each one held.
 *  Proxies, because the law under test is about the identity that survives a
 *  merge, and in Solid 2 the raw is always the newest frame. */
function merge(frames: readonly Located[][]): {
  steps: Seen[][];
  final: Located[];
} {
  const h = harness<Located[]>();
  const first = frames[0];
  if (first === undefined) throw new Error("no first frame");
  h.write(first);
  h.observe(() =>
    watchEach(
      () => h.store.v,
      (r) => r.node.id,
    ),
  );
  const steps: Seen[][] = [observe(h.store.v ?? [])];
  for (const frame of frames.slice(1)) {
    h.write(frame);
    steps.push(observe(h.store.v ?? []));
  }
  const final = (h.store.v ?? []).slice();
  h.dispose();
  return { steps, final };
}

/** Every row that survives a merge must still describe the record it described
 *  before it. A surviving row holding a DIFFERENT record is the defect — and it
 *  is a defect a consumer feels directly, because that row is the one a
 *  component may have captured and may still be reading. */
function assertNoRecycledIdentity(
  before: readonly Seen[],
  after: readonly Located[],
): void {
  const wasById = new Map(before.map((s) => [s.proxy, s.idAtTheTime] as const));
  for (const row of after) {
    const previousId = wasById.get(row);
    if (previousId === undefined) continue; // a fresh row — nothing to recycle
    expect(row.node.id).toBe(previousId);
  }
}

const ids = (rs: readonly Located[]): string[] => rs.map((r) => r.node.id);

describe("the store merge never recycles a row across records", () => {
  it("MID-INSERT: no surviving row changes which record it holds", () => {
    const { steps, final } = merge([
      rows(["a", "b", "c"]),
      rows(["a", "mid", "b", "c"]),
    ]);
    const before = steps[0];
    if (before === undefined) throw new Error("no first frame");
    // The failing assertion under a positional merge: `b`'s proxy survives at
    // index 1 holding `mid`.
    assertNoRecycledIdentity(before, final);
    // …and the value is right either way, stated so the suite reads honestly.
    expect(ids(final)).toEqual(["a", "mid", "b", "c"]);
  });

  it("MID-DELETE: the rows that remain are still their own rows' records", () => {
    const { steps, final } = merge([
      rows(["a", "b", "c", "d"]),
      rows(["a", "c", "d"]),
    ]);
    const before = steps[0];
    if (before === undefined) throw new Error("no first frame");
    assertNoRecycledIdentity(before, final);
    expect(ids(final)).toEqual(["a", "c", "d"]);
  });

  it("REORDER: a title never ends up on another record's row", () => {
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
    // behind is what every later frame merges into. Asserted frame-to-frame, so
    // a merge that only goes wrong on the SECOND edit is caught too.
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
        after.map((s) => s.proxy),
      );
    }
    expect(ids(final)).toEqual(["a", "mid", "b", "c", "end"]);
    expect(new Set(ids(final)).size).toBe(final.length);
  });

  it("REPLACED, not recycled: an undeclared merge keeps no row at all", () => {
    // The mechanism behind the three assertions above, measured rather than
    // implied: the law is kept by replacing every element, so not one of the
    // observed rows is the proxy that stood there before. (A frame that re-sends
    // the SAME object keeps that row — there is no record to carry it onto.)
    const { steps } = merge([rows(["a", "b", "c"]), rows(["a", "b", "c"])]);
    const [before, after] = steps;
    if (before === undefined || after === undefined) throw new Error("frames");
    const previous = new Set(before.map((s) => s.proxy));
    for (const s of after) expect(previous.has(s.proxy)).toBe(false);
  });

  it("a payload that DOES carry a top-level `id` is not keyed by it either", () => {
    // A statement of the rule, not a regression. No member definition declares
    // that a field named `id` is an identity, so the framework does not read it
    // as one — the merge replaces whatever the payload happens to be called.
    interface Row {
      id: string;
      label: string;
    }
    const h = harness<Row[]>();
    h.write([
      { id: "1", label: "one" },
      { id: "2", label: "two" },
    ]);
    h.observe(() =>
      watchEach(
        () => h.store.v,
        (r) => r.id,
      ),
    );
    // Eagerly, for the same reason as `observe` above: a recycled proxy reads the
    // record it was handed, so its `id` must be read now, not after the next write.
    const first = new Map((h.store.v ?? []).map((r) => [r, r.id] as const));
    h.write([
      { id: "0", label: "zero" },
      { id: "1", label: "one" },
      { id: "2", label: "two" },
    ]);
    const second = (h.store.v ?? []).slice();
    h.dispose();
    for (const row of second) {
      const previousId = first.get(row);
      if (previousId !== undefined) expect(row.id).toBe(previousId);
    }
    expect(second.map((r) => r.id)).toEqual(["0", "1", "2"]);
  });

  it("the RAW value is always the newest frame — identity lives on the proxies", () => {
    // Why every assertion in this file reads through the store rather than
    // `snapshot`: a merge ADOPTS the frame (a pointer swap at each level it
    // reaches), so the raw the store holds IS the object that was written and no
    // raw ever survives from one frame to the next. Asserting on raws would make
    // this suite pass under any key at all.
    const h = harness<Located[]>();
    const first = rows(["a", "b"]);
    h.write(first);
    expect(snapshot(h.store).v).toBe(first);
    const second = rows(["a", "b"]);
    h.write(second);
    expect(snapshot(h.store).v).toBe(second);
    h.dispose();
  });

  it("a primitive value is assigned, not merged", () => {
    const h = harness<number>();
    h.write(1);
    expect(h.store.v).toBe(1);
    h.write(2);
    expect(h.store.v).toBe(2);
    h.dispose();
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
 *  membership (`$TRACK` — what a keyed `<For>` re-diffs on) and one leaf
 *  deep inside an element (what every per-row binding reads).
 *
 *  EVERY row is observed, not just the one whose leaf is counted, because that is
 *  what a rendered list is: a row nobody reads is replaced under any key (an
 *  unobserved child is never adopted, `descend` :6837), and its replacement is
 *  itself a membership change — so a measurement that watched one row would be
 *  measuring its own blind spot. */
function replay(
  frames: readonly Reading[],
  arrayKey?: string,
): { track: number; leaf: number } {
  const h = harness<Reading>();
  const first = frames[0];
  if (first === undefined) throw new Error("no first frame");
  h.write(first, arrayKey);
  let track = -1;
  let leaf = -1;
  h.observe(() => {
    watchEach(
      () => h.store.v?.rows,
      (r) => r.node.title,
    );
    watchEach(
      () => h.store.v?.names,
      (n) => n.title,
    );
    // Split effects: the compute does the tracked read, the effect phase counts it.
    // What the counts measure is the store's NOTIFICATIONS — a write the store
    // decided changed nothing never reaches the effect phase at all.
    createEffect(
      () => trackMembership(h.store.v?.rows),
      () => {
        track++;
      },
    );
    createEffect(
      () => h.store.v?.rows[0]?.node.title,
      () => {
        leaf++;
      },
    );
  });
  for (const frame of frames.slice(1)) h.write(frame, arrayKey);
  h.dispose();
  return { track, leaf };
}

/** Write `frames` into one store under `arrayKey` and hand back the row and name
 *  PROXIES as they stood after EACH write — the one scaffold every identity test
 *  in this half needs, since what they all ask is which rows survived from one
 *  frame to the next. Every row is observed for {@link replay}'s reason. */
function steps(
  frames: readonly Reading[],
  arrayKey?: string,
): { rows: Row[][]; names: Reading["names"][] } {
  const h = harness<Reading>();
  const first = frames[0];
  if (first === undefined) throw new Error("no first frame");
  h.write(first, arrayKey);
  h.observe(() => {
    watchEach(
      () => h.store.v?.rows,
      (r) => r.node.title,
    );
    watchEach(
      () => h.store.v?.names,
      (n) => n.title,
    );
  });
  const rows: Row[][] = [[...(h.store.v?.rows ?? [])]];
  const names: Reading["names"][] = [[...(h.store.v?.names ?? [])]];
  for (const frame of frames.slice(1)) {
    h.write(frame, arrayKey);
    rows.push([...(h.store.v?.rows ?? [])]);
    names.push([...(h.store.v?.names ?? [])]);
  }
  h.dispose();
  return { rows, names };
}

/** The rows of one step, by their key — for asserting that a REORDER moved the
 *  rows it already had rather than minting new ones. */
const byKey = (rs: readonly Row[]): Map<string, Row> =>
  new Map(rs.map((r) => [r.key, r] as const));

/** Which record each row held AT THE TIME, paired with the proxy — {@link observe}'s
 *  law for the declared half: a surviving row must still describe the record it
 *  described before, and reading it later would report the id it ended up with. */
const heldIds = (rs: readonly Row[]): Map<Row, string> =>
  new Map(rs.map((r) => [r, r.node.id] as const));

describe("a DECLARED array key recycles by that key instead of replacing", () => {
  const KEYS = ["a", "b", "c"];

  it("UNDECLARED: an identical frame replaces every element and notifies", () => {
    // The red line. This is Fact B of the audit, measured here rather than quoted:
    // with no declaration the merge gives every incoming element a fresh identity,
    // so membership and every leaf fire on a frame that said nothing new.
    const { track, leaf } = replay([readingOf(KEYS), readingOf(KEYS)]);
    expect(track).toBe(1);
    expect(leaf).toBe(1);
  });

  it("DECLARED: an identical frame notifies nothing at all", () => {
    const { track, leaf } = replay([readingOf(KEYS), readingOf(KEYS)], "key");
    expect(track).toBe(0);
    expect(leaf).toBe(0);
  });

  it("DECLARED: a row survives a frame and still holds its own record", () => {
    const { rows } = steps([readingOf(KEYS), readingOf(KEYS)], "key");
    const [before, after] = rows;
    if (before === undefined || after === undefined) throw new Error("frames");
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(after.map((r) => r.node.id)).toEqual(KEYS);
  });

  it("DECLARED: a REORDER moves the rows rather than rewriting them", () => {
    const { rows } = steps(
      [readingOf(["a", "b", "c"]), readingOf(["c", "a", "b"])],
      "key",
    );
    const [before, after] = rows;
    if (before === undefined || after === undefined) throw new Error("frames");
    const was = byKey(before);
    expect(after.map((r) => r.key)).toEqual(["c", "a", "b"]);
    // The same three rows, in a new order — the identity a keyed `<For>` follows.
    expect(after[0]).toBe(was.get("c"));
    expect(after[1]).toBe(was.get("a"));
    expect(after[2]).toBe(was.get("b"));
  });

  it("DECLARED: a mid-insert keeps every surviving row on its own record", () => {
    const { rows } = steps(
      [readingOf(["a", "b", "c"]), readingOf(["a", "mid", "b", "c"])],
      "key",
    );
    const [before, after] = rows;
    if (before === undefined || after === undefined) throw new Error("frames");
    const was = heldIds(before);
    for (const row of after) {
      const previousId = was.get(row);
      if (previousId !== undefined) expect(row.node.id).toBe(previousId);
    }
    expect(after.map((r) => r.key)).toEqual(["a", "mid", "b", "c"]);
    // Every row the frame kept is the row that was already standing for it.
    const survived = byKey(before);
    for (const row of after) {
      if (row.key !== "mid") expect(row).toBe(survived.get(row.key));
    }
  });

  it("DECLARED: an array whose elements DON'T carry the key merges by position", () => {
    // Not a fallback — the stated reach of the declaration. `names` carries no
    // `key`, so this member declared no identity for it; Solid then merges those
    // elements BY POSITION, which is what keeps an identical frame silent for them
    // too. A consumer that needs `names` identity declares `id` instead (one key
    // per member) or reads them by value.
    const { names } = steps(
      [readingOf(["a", "b"]), readingOf(["a", "b"])],
      "key",
    );
    const [before, after] = names;
    if (before === undefined || after === undefined) throw new Error("frames");
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("a primitive value is still assigned, declaration or not", () => {
    const h = harness<number>();
    h.write(1, "key");
    expect(h.store.v).toBe(1);
    h.write(2, "key");
    expect(h.store.v).toBe(2);
    h.dispose();
  });
});

describe("the declared field is identity wherever it appears", () => {
  // Not only inside arrays. The diff applies the key at EVERY property, so a
  // nested object carrying the field is merged while the field reads the same and
  // replaced whole the moment it reads different. Pinned because it is the
  // consequence a consumer meets by surprise: it decides whether a component
  // holding that object across frames keeps it.
  interface Held {
    sel: { key: string; label: string };
    n: number;
  }

  function write(frames: readonly Held[]): Held["sel"][] {
    const h = harness<Held>();
    const first = frames[0];
    if (first === undefined) throw new Error("no first frame");
    h.write(first, "key");
    h.observe(() => {
      createEffect(
        () => h.store.v?.sel.label,
        () => {},
      );
    });
    const seen: Held["sel"][] = [h.store.v!.sel];
    for (const frame of frames.slice(1)) {
      h.write(frame, "key");
      seen.push(h.store.v!.sel);
    }
    h.dispose();
    return seen;
  }

  it("keeps the object while the field reads the same", () => {
    const seen = write([
      { sel: { key: "a", label: "A" }, n: 1 },
      { sel: { key: "a", label: "A again" }, n: 1 },
    ]);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[1]?.label).toBe("A again");
  });

  it("replaces it whole the moment the field reads different", () => {
    const seen = write([
      { sel: { key: "a", label: "A" }, n: 1 },
      { sel: { key: "b", label: "B" }, n: 1 },
    ]);
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[1]?.label).toBe("B");
  });

  it("REPLACES the member's whole value when the ROOT's key reads different", () => {
    // The root is the one place Solid answers a key mismatch with a THROW
    // ("Cannot reconcile states with different identity") rather than a
    // replacement, because at the root there is no parent slot to replace from.
    // A frame-by-frame merge can only mean "this is the value now", so the seam
    // replaces — and a member whose root happens to carry the declared field
    // therefore keeps working instead of taking down the subscription.
    interface Entity {
      key: string;
      label: string;
    }
    const h = harness<Entity>();
    h.write({ key: "a", label: "A" }, "key");
    h.observe(() => {
      createEffect(
        () => h.store.v?.label,
        () => {},
      );
    });
    expect(() => h.write({ key: "b", label: "B" }, "key")).not.toThrow();
    expect(h.store.v).toEqual({ key: "b", label: "B" });
    h.dispose();
  });
});

describe("the declared field must be required and non-nullable", () => {
  /** Why it is a requirement and not a preference, pinned as behaviour: the merge
   *  decides keyed-versus-positional PER ELEMENT, and an element whose key reads
   *  `undefined` takes the POSITIONAL fallback — it adopts whatever row is
   *  standing at its index. Inside an array the declaration was supposed to key,
   *  that row belongs to another record, so an optional field does not merely
   *  cost identity preservation: it hands one record's row to another. A schema
   *  that types the field required and non-nullable makes that unrepresentable,
   *  which is the only place it CAN be made unrepresentable — the merge sees
   *  values, not schemas. */
  interface Loose {
    key?: string;
    n: number;
  }

  function write(frames: readonly Loose[][]): Loose[][] {
    const h = harness<Loose[]>();
    const first = frames[0];
    if (first === undefined) throw new Error("no first frame");
    h.write(first, "key");
    h.observe(() =>
      watchEach(
        () => h.store.v,
        (r) => r.n,
      ),
    );
    const seen: Loose[][] = [[...(h.store.v ?? [])]];
    for (const frame of frames.slice(1)) {
      h.write(frame, "key");
      seen.push([...(h.store.v ?? [])]);
    }
    h.dispose();
    return seen;
  }

  it("a frame whose rows ALL carry the key is merged by it", () => {
    const seen = write([
      [
        { key: "a", n: 1 },
        { key: "b", n: 2 },
      ],
      [
        { key: "b", n: 2 },
        { key: "a", n: 1 },
      ],
    ]);
    const [before, after] = seen;
    if (before === undefined || after === undefined) throw new Error("frames");
    // Keyed: the rows MOVED.
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  it("a row MISSING it takes the position — and the record standing there", () => {
    const seen = write([
      [
        { key: "a", n: 1 },
        { key: "b", n: 2 },
      ],
      [{ n: 2 }, { key: "a", n: 1 }],
    ]);
    const [before, after] = seen;
    if (before === undefined || after === undefined) throw new Error("frames");
    // The keyless row at index 0 adopted the row that was record `a` — the very
    // recycling the undeclared default exists to prevent, reappearing inside a
    // declaration that was supposed to prevent it. `a` itself, matched by key at
    // index 1, cannot have that row too and gets a fresh one.
    expect(after[0]).toBe(before[0]);
    expect(after[0]?.key).toBeUndefined();
    expect(after[1]).not.toBe(before[0]);
    expect(after.map((r) => r.n)).toEqual([2, 1]);
  });
});

describe("a frame a merge cannot reach is replaced, not merged into", () => {
  /** `reconcile` requires a store PROXY at the slot it merges into, and the
   *  store only wraps what Solid calls wrappable: a plain object, a
   *  null-prototype object, an array (`@solidjs/signals` 2.0.4 `dist/dev.js`
   *  `isWrappable` :1969). A `Date`, `Map`, `Set`, typed array or class
   *  instance is served RAW, so a merge aimed at one throws "reconcile target
   *  is not a store proxy" (:6528) — on the SECOND frame, because the first
   *  had nothing to merge into and was written by assignment.
   *
   *  No kolu member's value is such a thing at its root today; the framework
   *  serves arbitrary app payloads, the in-process link passes values through
   *  WITHOUT serialization, and Effect Schema admits `Date`/`Map`/`Set`, so the
   *  next member can be. Both directions are pinned: a non-plain value standing
   *  in the store, and a non-plain value arriving over a plain one. */
  it("a Date member survives its SECOND frame", () => {
    const h = harness<Date>();
    h.write(new Date("2024-01-01T00:00:00.000Z"));
    expect(h.store.v).toEqual(new Date("2024-01-01T00:00:00.000Z"));
    h.write(new Date("2024-06-01T00:00:00.000Z"));
    expect(h.store.v).toEqual(new Date("2024-06-01T00:00:00.000Z"));
    h.dispose();
  });

  it("a Date frame over a plain-object frame REPLACES the backing", () => {
    const h = harness<Date | { at: string }>();
    h.write({ at: "2024-01-01" });
    expect(h.store.v).toEqual({ at: "2024-01-01" });
    h.write(new Date("2024-06-01T00:00:00.000Z"));
    // A `Date`, not a plain object left carrying a Date's enumerable keys (it
    // has none) — the merge replaced rather than adopting it as a container.
    expect(h.store.v).toBeInstanceOf(Date);
    expect(h.store.v).toEqual(new Date("2024-06-01T00:00:00.000Z"));
    // And the member keeps working afterwards: the next plain frame merges into
    // nothing left over from the Date.
    h.write({ at: "2024-07-01" });
    expect(h.store.v).toEqual({ at: "2024-07-01" });
    h.dispose();
  });

  it("a declared arrayKey does not change the answer for a Map member", () => {
    const h = harness<Map<string, number>>();
    h.write(new Map([["a", 1]]), "key");
    h.write(new Map([["a", 2]]), "key");
    expect(h.store.v).toEqual(new Map([["a", 2]]));
    h.dispose();
  });
});
