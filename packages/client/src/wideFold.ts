/** ONE LIST OUT OF MANY ROWS, with no memo reading more than a chunk of them.
 *
 *  A fold that reads one accessor per item subscribes to every item it
 *  reads. Past 200 sources Solid's development build judges the memo
 *  `WIDE_SCOPE_DEPS`, and a host's terminals, a repo's files and a person's
 *  works all grow past 200 in ordinary use. So the fold is two levels deep:
 *
 *   - a CHUNK memo per {@link CHUNK} consecutive rows, holding the values of
 *     its rows that are present. It reads the row list and its own rows, so
 *     it carries at most `CHUNK + 1` sources;
 *   - the JOIN, which reads the chunk list and every chunk. That is
 *     `1 + ⌈N / CHUNK⌉` sources, under 200 below 25,000 rows.
 *
 *  Chunks are keyed by POSITION in the row list. A row's value moving
 *  re-runs its one chunk and the join. Adding or removing a row shifts the
 *  rows after it, so their chunks re-run too. Each chunk and the join hold
 *  their previous list when their members did not change ({@link sameItems}),
 *  so a reader wakes only for a list that changed.
 *
 *  {@link foldEach} is the usual entry: a row memo per key, then this join.
 *  {@link joinRows} takes rows that already exist, such as `perWork`'s. */

import { type Accessor, createMemo, mapArray } from "solid-js";
import { sameItems } from "./conductor/sameItems";

/** Rows per chunk: one chunk memo stays well under the 200-source judge. */
export const CHUNK = 128;

/** Join per-item rows into one list of the present values, in row order.
 *  A row reading `undefined` is dropped. */
export const joinRows = <T>(
  /** The join's name in dev diagnostics. Its chunks are `<name>.chunk`. */
  name: string,
  rows: Accessor<ReadonlyArray<Accessor<T | undefined>>>,
): Accessor<ReadonlyArray<T>> => {
  const starts = createMemo(
    () =>
      Array.from(
        { length: Math.ceil(rows().length / CHUNK) },
        (_, at) => at * CHUNK,
      ),
    { name: `${name}.chunks`, equals: sameItems },
  );
  const chunks = mapArray(
    starts,
    (start) =>
      createMemo(
        () => {
          const all = rows();
          const out: T[] = [];
          const end = Math.min(start + CHUNK, all.length);
          for (let at = start; at < end; at++) {
            const one = all[at]?.();
            if (one !== undefined) out.push(one);
          }
          return out;
        },
        { name: `${name}.chunk`, equals: sameItems },
      ),
    { name: `${name}.byChunk` },
  );
  return createMemo(
    () => {
      const out: T[] = [];
      for (const chunk of chunks()) out.push(...chunk());
      return out;
    },
    { name, equals: sameItems },
  );
};

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
