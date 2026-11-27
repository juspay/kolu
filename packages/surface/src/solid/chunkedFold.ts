/** ONE LIST OUT OF MANY ROWS, with no memo reading more than a chunk of them.
 *
 *  A fold that reads one accessor per item subscribes to every item it reads.
 *  Past 200 sources Solid's development build judges the memo
 *  `WIDE_SCOPE_DEPS`, and an enrolled-subscription roster, a map's membership,
 *  a host's terminals, a repo's files and a person's works all grow past 200 in
 *  ordinary use. So the fold is two levels deep:
 *
 *   - a CHUNK memo per {@link CHUNK} consecutive positions, holding the values
 *     its range reads. It reads the length and its own range, so it carries at
 *     most `1 + CHUNK` sources — or `1 + 2·CHUNK` where a row costs two
 *     accessors, which is what a smaller `chunk` is for;
 *   - the JOIN, which reads the chunk list and every chunk. That is
 *     `1 + ⌈N / CHUNK⌉` sources, under 200 below 25,000 rows.
 *
 *  Chunks are keyed by POSITION. A value moving re-runs its one chunk and the
 *  join. Adding or removing a row shifts the rows after it, so their chunks
 *  re-run too. Each chunk and the join hold their previous list when their
 *  members did not change ({@link sameMembers}, or a caller's own `equals`), so
 *  a reader wakes only for a list that changed.
 *
 *  Three entries, one kernel:
 *
 *   - {@link joinChunks} is the kernel — a LENGTH and a range reading, for a
 *     source that is already indexable (a store-proxy key array, a roster
 *     slice);
 *   - {@link joinRows} takes rows that already exist as accessors;
 *   - {@link foldEach} is the usual entry: a row memo per key, then that join.
 *
 *  THE ONE OTHER COPY IN THIS REPO is `@kolu/solid-dockrow`'s
 *  `src/prTooltipFold.ts`, deliberately: `solid-dockrow` is a leaf row package
 *  and must not depend on `@kolu/surface`, which brings `effect` with it. Every
 *  other consumer — this package's own `health()` fold, `@kolu/surface-map`'s
 *  membership keyset, and the client's folds — imports this module. */

import { type Accessor, createMemo, mapArray } from "solid-js";

/** Rows per chunk: one chunk memo stays well under the 200-source judge. */
export const CHUNK = 128;

/** Two lists holding the SAME members in the same order — the default gate a
 *  chunk and the join close themselves with, for values that carry their own
 *  identity (rows, keys, strings, numbers). A fold whose reading MINTS a fresh
 *  record per member passes its own `equals` instead, so an unchanged reading
 *  is not published as a new list. */
export const sameMembers = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a === b || (a.length === b.length && a.every((one, at) => one === b[at]));

/** How a {@link joinChunks} fold is sized and gated. */
export interface JoinChunksOptions<T> {
  /** Positions per chunk memo. Defaults to {@link CHUNK}; a reading that costs
   *  more than one source per row takes a smaller one. */
  chunk?: number;
  /** When two readings of one chunk — and two readings of the whole join — are
   *  the same list. Defaults to {@link sameMembers}. */
  equals?: (a: readonly T[], b: readonly T[]) => boolean;
}

/** Join a RANGE-readable source into one list, a chunk at a time. `length` is
 *  the number of positions; `readRange(start, end)` is one chunk's reading of
 *  the half-open range, and whatever it tracks is that chunk's sources alone. */
export const joinChunks = <T>(
  /** The join's name in dev diagnostics. Its chunks are `<name>.chunk`. */
  name: string,
  length: Accessor<number>,
  readRange: (start: number, end: number) => readonly T[],
  options?: JoinChunksOptions<T>,
): Accessor<ReadonlyArray<T>> => {
  const size = options?.chunk ?? CHUNK;
  const equals = options?.equals ?? sameMembers;
  const starts = createMemo(
    () =>
      Array.from({ length: Math.ceil(length() / size) }, (_, at) => at * size),
    { name: `${name}.chunks`, equals: sameMembers },
  );
  const chunks = mapArray(
    starts,
    (start) =>
      createMemo(() => readRange(start, Math.min(start + size, length())), {
        name: `${name}.chunk`,
        equals,
      }),
    { name: `${name}.byChunk` },
  );
  return createMemo(
    () => {
      const out: T[] = [];
      for (const chunk of chunks()) out.push(...chunk());
      return out;
    },
    { name, equals },
  );
};

/** Join per-item rows into one list of the present values, in row order.
 *  A row reading `undefined` is dropped. */
export const joinRows = <T>(
  /** The join's name in dev diagnostics. Its chunks are `<name>.chunk`. */
  name: string,
  rows: Accessor<ReadonlyArray<Accessor<T | undefined>>>,
): Accessor<ReadonlyArray<T>> =>
  joinChunks<T>(
    name,
    () => rows().length,
    (start, end) => {
      const all = rows();
      const out: T[] = [];
      for (let at = start; at < end; at++) {
        const one = all[at]?.();
        if (one !== undefined) out.push(one);
      }
      return out;
    },
  );

/** One row memo per key, joined in key order through {@link joinRows}.
 *  `read` is ONE item's reading: whatever it tracks is that row's sources
 *  alone. `equals` is when two readings of one item are the same thing, for
 *  a `read` that builds a fresh value per run. */
export const foldEach = <K, T>(
  /** The fold's name in dev diagnostics. Its rows are `<name>.row`. */
  name: string,
  keys: Accessor<ReadonlyArray<K>>,
  read: (key: K) => T | undefined,
  equals?: (a: T, b: T) => boolean,
): Accessor<ReadonlyArray<T>> => {
  const same =
    equals === undefined
      ? undefined
      : (a: T | undefined, b: T | undefined): boolean =>
          a === undefined || b === undefined ? a === b : equals(a, b);
  const rows = mapArray(
    keys,
    (key) => createMemo(() => read(key), { name: `${name}.row`, equals: same }),
    { name: `${name}.byKey` },
  );
  return joinRows(name, rows);
};
