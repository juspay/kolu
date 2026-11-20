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
  type Entry = { stamp: string; value: T };
  const held = new Map<string, Entry>();

  const touch = (file: string, entry: Entry): void => {
    held.delete(file);
    held.set(file, entry);
  };
  const forgetAbsent = (file: string): void => {
    held.delete(file);
  };
  const evictOverflow = (): void => {
    if (held.size <= max) return;
    const oldest = held.keys().next();
    if (!oldest.done) held.delete(oldest.value);
  };

  return {
    get size() {
      return held.size;
    },
    read(file, read) {
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (stat === undefined) {
        forgetAbsent(file);
        return read(undefined);
      }
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      const hit = held.get(file);
      if (hit !== undefined && hit.stamp === stamp) {
        touch(file, hit);
        return hit.value;
      }
      const value = read(stat);
      touch(file, { stamp, value });
      evictOverflow();
      return value;
    },
  };
}
