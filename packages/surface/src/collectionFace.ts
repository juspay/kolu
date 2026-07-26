/**
 * A collection's client face, LOOSELY typed — the one place that widening is
 * spelled.
 *
 * A consumer that needs only `keys` and `get` (a server-side reader over a
 * mirrored collection, a diagnostic, a policy that walks members) cannot depend
 * on the precise per-spec client type without materializing a large union a
 * second time. So it hand-shapes a structural interface and forces the real
 * client through `as unknown as` to satisfy it — which is a cast that would
 * survive this framework renaming `keys` or changing `get`'s options bag.
 *
 * That workaround appeared twice, independently, which is what makes the pattern
 * the artifact rather than either instance. The widening belongs to the package
 * that owns the client shape, so it is checked ONCE here and a framework rename
 * is a compile error in this file and nowhere else.
 *
 * The two verbs are declared as METHODS on purpose: method parameters are
 * bivariant, so a precisely-typed collection narrows to this face by ordinary
 * assignment. Written as function-typed PROPERTIES they would be contravariant
 * and every consumer would be back to a cast — which is exactly how the two
 * hand-rolled copies came to carry one.
 */

/** What a consumer that only enumerates and reads may depend on. */
export interface CollectionFace<K = unknown, V = unknown> {
  keys(
    input: Record<string, never>,
    opts: { signal?: AbortSignal },
  ): Promise<AsyncIterable<K[]>>;
  get(
    input: { key: K },
    opts: { signal?: AbortSignal },
  ): Promise<AsyncIterable<V>>;
}

/** Narrow a typed collection to the loose face. Identity at runtime; the point
 *  is that the widening is CHECKED, here, instead of asserted at each caller. */
export function collectionFace<K, V>(
  collection: CollectionFace<K, V>,
): CollectionFace<K, V> {
  return collection;
}
