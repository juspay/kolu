/** A minimal synchronous in-memory `Storage` over a `Map` — enough for `makePersisted`
 *  (and any `persistedPref` call site) to read and write, and to observe removals, without
 *  a DOM. The optional `seed` pre-populates entries (e.g. a remembered pref that survived a
 *  relaunch). One home for the fake so the client's storage tests don't each hand-maintain a
 *  near-duplicate copy. */
export function fakeStorage(seed?: Record<string, string>): Storage {
  const m = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}
