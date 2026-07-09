/**
 * Prune the per-host re-serve-mirror cache to the pool's live membership.
 *
 * The `reServes` map in `index.ts` memoizes one `reServeSurface` mirror per host, keyed by
 * host only. A mirror is pinned to the session it was built over; when the pool destroys
 * that session (host removal), the mirror's pump exits and it can NEVER adopt a later
 * session for the same key. So a guest remove→re-add of the SAME key must build a FRESH
 * mirror over the new session — otherwise the re-add is handed the DEAD mirror (a green
 * chip over a frozen/empty canvas: the #1708 stale-reserve-on-flap defect, which relocated
 * out of the map layer into kolu-server's own mirror cache).
 *
 * Wired to `pool.subscribe`, this drops any cache entry whose host has left the pool. It
 * mirrors `serveHostMap`'s own `links.delete(k)` on detach, tying eviction to the ONE
 * membership authority (the pool). The mirror's pump tears down on session-destroy, so
 * dropping the map reference is enough for it to GC — no explicit dispose is needed.
 */

/** Delete every cache entry whose host is no longer a pool member. Generic over the
 *  cache's own key type — `index.ts` keys `reServes` by the pool's CANONICAL STRING
 *  (`encodeHostKey`), never the `HostKey` object itself (a `Map`/`===` compares an
 *  object by reference, so two logically-equal `HostKey`s from independent decodes
 *  would never collide — string keys sidestep that entirely). */
export function pruneToMembers<K, V>(
  cache: Map<K, V>,
  isMember: (host: K) => boolean,
): void {
  for (const host of [...cache.keys()]) {
    if (!isMember(host)) cache.delete(host);
  }
}
