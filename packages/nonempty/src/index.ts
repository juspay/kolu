/**
 * `NonEmpty<T>` — a list known at the type level to have at least one
 * element. Equivalent to Haskell's `NonEmpty` / Rust's `(T, Vec<T>)`.
 *
 * Smart constructor: `nonEmpty(arr)` returns `NonEmpty<T> | null`. The
 * `null` is the only way to signal "input was empty," forcing the caller
 * to narrow at the type system instead of running a separate `length`
 * check that TS can't see.
 *
 * Once narrowed, positional reads (`xs[0]`) are total without a fallback.
 * Dynamic-index reads still need `xs[i] ?? xs[0]` because TS's
 * `noUncheckedIndexedAccess` widens `xs[number]` to `T | undefined` even
 * on tuples — but `xs[0]` is statically `T`, so the fallback is typed.
 */
export type NonEmpty<T> = readonly [T, ...T[]];

/** Smart constructor: returns the array narrowed to `NonEmpty<T>`, or
 *  `null` when empty. The cast is the entire mechanism — same memory,
 *  refined type. */
export function nonEmpty<T>(arr: readonly T[]): NonEmpty<T> | null {
  return arr.length === 0 ? null : (arr as NonEmpty<T>);
}
