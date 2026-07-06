/**
 * The keyed-root swap + the connection-scoped subscription primitive it powers. Pure
 * solid-generic (only `solid-js`), so it lives in the base `@kolu/surface/solid` layer —
 * `@kolu/surface-app` re-exports both for compat, and its active-connection manager
 * composes `connectionScoped` from here with no import cycle through the surface-app
 * barrel.
 */

import {
  type Accessor,
  createMemo,
  createRenderEffect,
  getOwner,
  mapArray,
} from "solid-js";

/** A reactive value re-derived under a FRESH root each time `key` changes, disposing the
 *  prior root on the swap. A thin alias over solid-js's own `mapArray`: `factory` runs
 *  per key under a per-item owner that `mapArray` disposes when the key leaves the
 *  single-element list (a change) or the caller's owner tears down — exactly the
 *  dispose-old-then-build-new swap this needs, so no hand-rolled `disposePrev` / `untrack`
 *  fence / manual dispose ordering (mapArray keys by value-identity, which is the same
 *  fence). Two hand-rolled copies collapse into this: kolu's host-scoped client subs
 *  (`bindingScoped`) and surface-app's provider per-control-plane buildInfo cell.
 *
 *  EAGER: a `createRenderEffect` standing observer re-runs the memo SYNCHRONOUSLY the
 *  instant `key` changes (not lazily on the next read), so the old root — and any
 *  subscription it owns — is disposed BEFORE the caller retires the swapped-away resource
 *  (the #1687 gray-chip class / the switch-toast abort ordering). MUST run under a
 *  reactive owner — it throws otherwise (it would silently degrade to a leaked final root
 *  and lazy dispose). */
export function createKeyedRoot<K, T>(
  key: Accessor<K>,
  factory: (key: K) => T,
): Accessor<T> {
  if (!getOwner()) {
    throw new Error(
      "createKeyedRoot must run under a reactive owner (a component, createRoot, or a createSharedRoot factory).",
    );
  }
  const cells = createMemo(mapArray(() => [key()], factory));
  createRenderEffect(() => void cells());
  return () => cells()[0] as T;
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
