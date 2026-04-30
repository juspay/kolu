/**
 * `useCell` — Solid hook bridging a server cell to a reactive accessor.
 *
 * Two authority modes:
 *
 *   - `"server"` (default): the server is canonical. Every server push
 *     reconciles into the local view. Mutations call the server; the
 *     resulting echo updates the view.
 *
 *   - `"local"`: the client store is canonical after init. The first
 *     server yield seeds the local store; subsequent server pushes are
 *     ignored. `set` / `patch` apply locally synchronously (instant UI
 *     response), then send to the server. The server's echo is intentionally
 *     ignored to avoid stomping a just-made client write whose RPC hasn't
 *     round-tripped yet.
 *
 * Local authority is for state where instant UI response gates re-render
 * timing — preferences are the canonical example. Without it, every
 * preference flip introduces a single-frame lag while the round-trip
 * completes. Local authority requires T to be an object/array shape so
 * Solid's createStore can reconcile field-level changes.
 */

import { type Accessor, createEffect, createRoot, on } from "solid-js";
import { createStore, reconcile, type SetStoreFunction } from "solid-js/store";
import type { Cell } from "../index";
import { createSubscription, type Subscription } from "./createSubscription";

export type Authority = "server" | "local";

export interface UseCellServerOptions<T, P = T> {
  source: () => Promise<AsyncIterable<T>>;
  authority?: "server";
  mutate?: (patch: P) => Promise<void> | void;
  onError?: (err: Error) => void;
}

export interface UseCellLocalOptions<T extends object, P = T> {
  source: () => Promise<AsyncIterable<T>>;
  authority: "local";
  /** Default value for the local store; used until the first server yield. */
  initial: T;
  mutate: (patch: P) => Promise<void> | void;
  /** Pure merge: returns the next value. Used when the patch shape `P`
   *  differs from `T` (otherwise `set` semantics suffice). */
  applyPatch?: (current: T, patch: P) => T;
  /** Escape hatch for non-shallow merges (discriminated-union nested fields).
   *  Receives Solid's `setStore` directly so callers can do nested path-form
   *  writes that `applyPatch` + reconcile can't express cleanly.
   *
   *  When using this, document at the call site (1) why `applyPatch` is
   *  insufficient and (2) the specific nested mutation required. The hatch
   *  couples the caller to Solid's store mutation API across the framework
   *  boundary, so the cost should be visible to future readers. The
   *  preferences `rightPanel.tab` discriminated-union reconcile is the
   *  canonical example. */
  mergeIntoStore?: (setStore: SetStoreFunction<T>, patch: P) => void;
  onError?: (err: Error) => void;
}

export type UseCellOptions<T, P = T> =
  | UseCellServerOptions<T, P>
  | (T extends object ? UseCellLocalOptions<T, P> : never);

export interface UseCellResult<T, P> {
  value: Accessor<T | undefined>;
  pending: Accessor<boolean>;
  error: Accessor<Error | undefined>;
  set: (next: T) => Promise<void>;
  patch: (p: P) => Promise<void>;
  sub: Subscription<T>;
}

export function useCell<Name extends string, T, P = T>(
  cell: Cell<Name, T>,
  options: UseCellOptions<T, P>,
): UseCellResult<T, P> {
  if (options.authority === "local") {
    return useCellLocal(
      cell as Cell<Name, T & object>,
      options as unknown as UseCellLocalOptions<T & object, P>,
    ) as unknown as UseCellResult<T, P>;
  }
  return useCellServer(cell, options as UseCellServerOptions<T, P>);
}

function useCellServer<Name extends string, T, P>(
  _cell: Cell<Name, T>,
  options: UseCellServerOptions<T, P>,
): UseCellResult<T, P> {
  const sub = createRoot(() =>
    createSubscription(options.source, {
      onError: options.onError,
    }),
  );

  async function callMutate(p: P): Promise<void> {
    if (!options.mutate) {
      throw new Error("useCell: no mutate handler provided");
    }
    await options.mutate(p);
  }

  return {
    value: () => sub(),
    pending: sub.pending,
    error: sub.error,
    set: (next) => callMutate(next as unknown as P),
    patch: callMutate,
    sub,
  };
}

function useCellLocal<Name extends string, T extends object, P>(
  _cell: Cell<Name, T>,
  options: UseCellLocalOptions<T, P>,
): UseCellResult<T, P> {
  const [store, setStore] = createStore<T>(options.initial);
  // Mutable guard: once any server value arrives, seed the local store
  // from it and never overwrite again. Server echoes after init must not
  // stomp local mutations whose RPC hasn't round-tripped — the local
  // store is authoritative thereafter. A reactive signal would fire
  // unnecessary effects for a one-time transition.
  let initialized = false;

  const sub = createRoot(() => {
    const s = createSubscription(options.source, {
      onError: options.onError,
    });
    createEffect(
      on(
        () => s(),
        (server) => {
          if (server !== undefined && !initialized) {
            initialized = true;
            setStore(reconcile(server as T));
          }
        },
      ),
    );
    return s;
  });

  function applyLocal(p: P): void {
    if (options.mergeIntoStore) {
      options.mergeIntoStore(setStore, p);
      return;
    }
    if (options.applyPatch) {
      const next = options.applyPatch(store as T, p);
      setStore(reconcile(next));
      return;
    }
    // No patch helpers — treat P as T (full replacement).
    setStore(reconcile(p as unknown as T));
  }

  return {
    // Always read the seeded store — `options.initial` is visible to
    // consumers before the first server yield (matching the existing
    // usePreferences pattern: instant UI from defaults, reconcile in
    // place when the server arrives). The `initialized` flag is only
    // load-bearing inside `createEffect` to gate echo absorption.
    value: () => store as T,
    pending: sub.pending,
    error: sub.error,
    set: async (next) => {
      applyLocal(next as unknown as P);
      await options.mutate(next as unknown as P);
    },
    patch: async (p) => {
      applyLocal(p);
      await options.mutate(p);
    },
    sub,
  };
}
