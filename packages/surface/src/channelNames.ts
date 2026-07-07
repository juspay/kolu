/**
 * Collection channel-name helpers — the ONE source of truth for every channel
 * name a keyed collection mints, on BOTH the server (mint) and the framework's
 * own consumers that need to name the same channel a second time (e.g.
 * `serveSurfaceMap`'s hand-wired `entries` membership collection).
 *
 * A collection named `<name>` publishes its membership on `<name>:keys`, its
 * batched deltas on `<name>:deltas`, and each member value on `<name>:key:<k>`
 * (see `walkSurface` in `./server.ts`). Because the in-memory channel registry
 * dedups topics BY NAME, the per-key channel carries a `key:` segment neither
 * fixed channel has — so for ANY key string `k`, `<name>:key:<k>` can never
 * equal `<name>:keys` or `<name>:deltas`. The collision this module used to
 * guard against reactively (a member key literally `"keys"` or `"deltas"`
 * aliasing the reserved channel) is now STRUCTURALLY IMPOSSIBLE: there is no
 * reject list left to maintain, because there is nothing left to reject.
 */

/** The keyset (membership) channel suffix: `<collection>:keys`. */
export const COLLECTION_KEYSET_CHANNEL_SUFFIX = "keys";

/** The batched-deltas channel suffix: `<collection>:deltas`. */
export const COLLECTION_DELTAS_CHANNEL_SUFFIX = "deltas";

/** The per-key channel's infix segment: `<collection>:key:<k>`. Present in
 *  EVERY per-key channel and absent from both fixed channels above — the
 *  segment that makes the collision structurally impossible, whatever the
 *  key string is. */
const COLLECTION_KEY_CHANNEL_INFIX = "key";

/** The collection's membership (keyset) channel name: `<name>:keys`. */
export function collectionKeysetChannel(name: string): string {
  return `${name}:${COLLECTION_KEYSET_CHANNEL_SUFFIX}`;
}

/** The collection's batched-deltas channel name: `<name>:deltas`. */
export function collectionDeltasChannel(name: string): string {
  return `${name}:${COLLECTION_DELTAS_CHANNEL_SUFFIX}`;
}

/** One member's per-key value channel name: `<name>:key:<key>`. Namespaced
 *  with the `key:` infix so a member key literally equal to `"keys"` or
 *  `"deltas"` (or anything else) can never alias one of the collection's
 *  fixed channels — `<name>:key:keys` and `<name>:key:deltas` are both
 *  distinct from `<name>:keys` and `<name>:deltas`. */
export function collectionKeyChannel(name: string, key: string): string {
  return `${name}:${COLLECTION_KEY_CHANNEL_INFIX}:${key}`;
}
