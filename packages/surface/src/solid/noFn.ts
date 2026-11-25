/**
 * Solid 2's VALUE constraint, spelled once for the whole repo.
 *
 * Solid 2 reads a function handed to `createSignal` / `createStore` as a
 * DERIVATION rather than as the value: `createStore(fn)` is the projection form
 * and `createSignal(fn)` the derived form. The signatures say so with a
 * conditional type: `@solidjs/signals` 2.0.3 declares `NoFn<T>` in its store
 * type module (`store/types`) as `T extends Function ? never : T`, which is
 * `Exclude<T, Function>`.
 *
 * It is restated here because `solid-js` does not re-export it: the `solid-js`
 * 2.0.3 type entry forwards `NotWrappable`, `Store`, `StoreSetter` and the rest
 * of the store types from `@solidjs/signals`, but not `NoFn`, and
 * `@solidjs/signals` is not a direct dependency of any kolu package — the whole
 * repo reaches Solid through `solid-js`. solidjs/solid#5199 exports it from
 * `solid-js`; once a release carries it, this alias and its suppression go and
 * the consumers import Solid's own.
 *
 * ONE definition, in the lowest package that both halves of the repo already
 * depend on: `@kolu/surface` (every Solid consumer, `kolu-client` included,
 * already imports from `@kolu/surface/solid`). That is what keeps the
 * `noBannedTypes` suppression a single line — `Function` is the exact type
 * Solid's own conditional excludes, and a narrower `(...args: never[]) => unknown`
 * does not match it, so the rule's suggested replacement would change the
 * meaning of the constraint rather than express it.
 *
 * Use it on any option a caller hands to Solid as a VALUE, so the requirement is
 * visible at the call site instead of being asserted at the handoff.
 */

// biome-ignore lint/complexity/noBannedTypes: the exact type Solid 2's value constraint excludes (`NoFn<T> = T extends Function ? never : T`); a narrower function type does not satisfy it
export type NoFn<T> = Exclude<T, Function>;
