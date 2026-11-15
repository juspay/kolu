# nonempty

A list the type system knows has at least one element, like Haskell's
`NonEmpty` or Rust's `(T, Vec<T>)`. Zero dependencies.

- `NonEmpty<T>` is `readonly [T, ...T[]]`.
- `nonEmpty(arr)` returns the same array narrowed to `NonEmpty<T>`, or `null`
  when it is empty. The cast is the whole mechanism: same memory, refined type.

The `null` is the only signal for "input was empty", so a caller narrows at the
type level instead of running a `length` check the compiler cannot see. Once
narrowed, `xs[0]` is statically `T` and needs no fallback. A dynamic index still
needs `xs[i] ?? xs[0]`, because `noUncheckedIndexedAccess` widens `xs[number]`
to `T | undefined` even on a tuple.

The single entry is `.`, which is `src/index.ts`. Depended on by `kolu-client`,
`memorable-names`, `terminal-themes` and the `anyagent` integration.

## What not to break

- `nonEmpty` must stay a cast, not a copy. Callers pass large arrays and rely on
  the result being the same object.
- The empty case returns `null`, not an empty array or a throw.
