/** A file read whose result is kept while the file has not moved.
 *
 *  Agent detection re-reads the SAME small files on a hot loop: padi's sensor
 *  reconcile runs per terminal per adapter, several times a second during a
 *  settle window, and each pass re-reads and re-parses a claude session file or
 *  an omp breadcrumb that changed minutes ago, if ever. A 90 s CPU profile of a
 *  16-terminal padi (juspay/kolu#2286) put the reconcile path at 16% of the
 *  daemon's busy time, almost all of it re-deriving answers it already had.
 *
 *  The stamp is `(mtimeMs, size)` — the pair every build tool uses for the same
 *  judgement, and a strictly cheaper syscall than the read it replaces. It is
 *  not a content hash and does not pretend to be: a write that lands in the
 *  same millisecond AND keeps the byte length is invisible to it. That is
 *  acceptable here because both consumers' files are replace-in-place records
 *  whose size moves with every real change, and because the alternative — read
 *  and parse everything, every pass — is the cost being removed.
 *
 *  **ABSENCE IS NEVER CACHED.** A missing file has no stamp to invalidate
 *  against, so "not there" would be sticky forever. The reader is still called
 *  (with `undefined` for the stat), so it decides what absence means — and it
 *  can answer without a read at all, which makes the miss cheaper than the
 *  bare `readFileSync` it replaced rather than more expensive.
 *
 *  The reader is passed PER CALL rather than baked in at construction, so it
 *  can close over the caller's logger and arguments. The cache holds values,
 *  never readers.
 *
 *  Domain-agnostic, so it lives here beside `readProcessSnapshot` rather than
 *  in either agent integration: `claude-code` and `omp` both need it and
 *  neither may depend on the other.
 */

import fs from "node:fs";

/** A per-path `(mtimeMs, size)`-stamped value cache. */
export interface StampedCache<T> {
  /** `read(stat)`'s result for `file`, re-derived only when the stamp moved.
   *  `stat` is `undefined` when the file is absent or unstatable. */
  read(file: string, read: (stat: fs.Stats | undefined) => T): T;
  /** Entries currently held — the bound's observable face. */
  readonly size: number;
}

/** A stamped cache of at most `max` entries, evicted least-recently-USED first
 *  (a `Map` keeps insertion order, and a hit re-inserts). The bound is what
 *  keeps a long-uptime padi from holding an entry for every file every terminal
 *  it ever ran resolved. */
export function stampedCache<T>(max: number): StampedCache<T> {
  const held = new Map<string, { stamp: string; value: T }>();
  return {
    get size() {
      return held.size;
    },
    read(file, read) {
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (stat === undefined) {
        // Gone (or unstatable). Drop any held answer — it describes a file that
        // no longer exists — and let the reader produce its own absence fact.
        held.delete(file);
        return read(undefined);
      }
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      const hit = held.get(file);
      if (hit !== undefined && hit.stamp === stamp) {
        // Re-insert so the LRU order reflects use, not first sight.
        held.delete(file);
        held.set(file, hit);
        return hit.value;
      }
      const value = read(stat);
      held.delete(file);
      held.set(file, { stamp, value });
      if (held.size > max) {
        const oldest = held.keys().next();
        if (!oldest.done) held.delete(oldest.value);
      }
      return value;
    },
  };
}
