/**
 * The keyed-root swap + the connection-scoped subscription primitive it powers. Kept in
 * their own module (not the `/solid` barrel) so the active-connection manager can compose
 * `connectionScoped` without importing the barrel that re-exports the manager — no import
 * cycle. Both are re-exported from `./index`, so consumers still reach them there.
 */

import {
  type Accessor,
  createMemo,
  createRenderEffect,
  createRoot,
  getOwner,
  onCleanup,
  untrack,
} from "solid-js";

/** A reactive value re-derived under a FRESH `createRoot` each time `key` changes,
 *  disposing the prior root on the swap. The factory's subscriptions/effects are OWNED
 *  by that per-`key` root, so a swap tears the old one down synchronously — no stream
 *  leaks across the change (the #1687 gray-chip class). Eager: it opens at creation and
 *  stays a standing observer (`createRenderEffect`), so the old root is disposed the
 *  INSTANT `key` changes, not lazily on the next read. `createRoot` here is a nested
 *  child of the caller's owner (unlike `@kolu/surface`'s detached root whose disposer is
 *  discarded), so we can and do dispose it. Two hand-rolled copies collapse into this:
 *  the host-scoped client subscriptions (kolu's `bindingScoped`) and the surface-app
 *  provider's own per-control-plane buildInfo cell. Must run under a reactive owner. */
export function createKeyedRoot<K, T>(
  key: Accessor<K>,
  factory: (key: K) => T,
): Accessor<T> {
  let disposePrev: (() => void) | undefined;
  if (getOwner()) onCleanup(() => disposePrev?.());
  const cell = createMemo(() => {
    const k = key(); // TRACKED — a change re-runs the memo (disposes + rebuilds)
    return untrack(() => {
      // `untrack` fences the factory's OWN reactive reads out of the memo, so only a
      // `key` change — never a value the factory's subscription yields — re-runs it.
      disposePrev?.();
      let result!: T;
      disposePrev = createRoot((dispose) => {
        result = factory(k);
        return dispose;
      });
      return result;
    });
  });
  // Keep the memo EAGER — a render effect is a synchronous standing observer, so the old
  // root is disposed + the new one built the INSTANT `key` changes (not lazily on the
  // next read), and the value is live on the first read (never one tick late).
  if (getOwner()) createRenderEffect(() => void cell());
  return cell;
}

/** A subscription factory keyed to a SWAPPABLE connection — the client-side
 *  "connection-scoped" primitive. `factory(connection())` re-runs whenever the active
 *  connection changes (`connectionKey` flips), the prior root disposed synchronously
 *  first (no stale sub leaks across the swap — the #1687 gray-chip class), the value
 *  populated on the first read. Rides {@link createKeyedRoot}, inheriting its
 *  sync-populate, owner-safety, and dispose-then-rebuild fence.
 *
 *  TWO accessors, deliberately: `connectionKey` is the STABLE identity of the active
 *  connection (a host name, a socket id); `connection` is the current connection VALUE —
 *  often a FRESH object each swap (a retired binding is rebuilt), so keying on the value
 *  would re-run on every incidental rebuild. Key on identity; read the value inside.
 *
 *  This is the framework endpoint kolu's app-lifetime singleton subscriptions re-key
 *  through when a tab live-switches which host it views — without a per-consumer
 *  scope-through-context port (ledger L11): they call
 *  `connectionScoped(activeKey, activeConnection, factory)` and the framework owns the
 *  swap. Must run under a reactive owner. */
export function connectionScoped<K, C, T>(
  connectionKey: Accessor<K>,
  connection: Accessor<C>,
  factory: (connection: C) => T,
): Accessor<T> {
  return createKeyedRoot(connectionKey, () => factory(connection()));
}
