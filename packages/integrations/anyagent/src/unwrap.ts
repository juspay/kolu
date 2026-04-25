/**
 * `unwrap` — narrow a `T | undefined | null` to `T` or throw with a
 * descriptive message. The Haskell `fromJust` analogue, but forced to
 * carry a `message` so the throw site is debuggable instead of giving
 * the bare "Cannot read properties of undefined".
 *
 * Use at boundaries where TypeScript can't see the invariant:
 *   - `Map.get(key)` when the caller has externally established that
 *     `key` is in the map (`unwrap(map.get(k), \`no entry for ${k}\`)`)
 *   - regex match groups that the pattern guarantees but TS types as
 *     `string | undefined` (`unwrap(match[1], "regex shape changed")`)
 *   - DOM lookups where the consumer has just verified existence
 *
 * Don't use it as a quieter `!`. If the value's non-nullness is provable
 * by control flow (a preceding `if (x === undefined) return`), narrow
 * locally instead — TypeScript will track that and the call is gone.
 *
 * Introduced in #710 / #721 alongside the `noNonNullAssertion` rule
 * flip: every load-bearing `!` either narrowed via control flow or
 * routed through this helper, so the throw site is the documentation.
 */
export function unwrap<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(`unwrap: ${message}`);
  }
  return value;
}
