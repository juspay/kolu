/**
 * Collection channel-name suffixes — the ONE source of truth for the FIXED
 * (non-per-key) channels a keyed collection mints.
 *
 * A collection named `<name>` publishes its membership on `<name>:keys`, its
 * batched deltas on `<name>:deltas`, and each member value on `<name>:<key>`
 * (see `implementCollection` in `./server.ts`). Because the in-memory channel
 * registry dedups topics BY NAME, a member/map KEY equal to one of the fixed
 * suffixes would alias that reserved channel and cross-wire the membership and
 * per-key streams. `serveSurfaceMap`'s membership `entries` collection is keyed
 * by user-supplied host keys, so the branded map-key schema imports
 * `COLLECTION_RESERVED_CHANNEL_SUFFIXES` and rejects a key equal to one of them
 * at the SOLE key producer — sealing every path (env seed, `hosts.add`, a
 * persisted active key) by construction rather than by a downstream guard.
 *
 * These constants are the literals `./server.ts` mints its channels from, so the
 * guard's reserved list and the channel names can never drift.
 */

/** The keyset (membership) channel suffix: `<collection>:keys`. */
export const COLLECTION_KEYSET_CHANNEL_SUFFIX = "keys";

/** The batched-deltas channel suffix: `<collection>:deltas`. */
export const COLLECTION_DELTAS_CHANNEL_SUFFIX = "deltas";

/** The FIXED per-collection channel suffixes. A per-key channel is
 *  `<collection>:<key>`, so a key equal to one of these aliases the collection's
 *  own reserved channel — the map-key schema rejects them. */
export const COLLECTION_RESERVED_CHANNEL_SUFFIXES: readonly string[] = [
  COLLECTION_KEYSET_CHANNEL_SUFFIX,
  COLLECTION_DELTAS_CHANNEL_SUFFIX,
];
