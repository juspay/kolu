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
 *
 * `source` and `mutate` are typed oRPC procedure refs (e.g.
 * `client.preferences.get` / `client.preferences.update`). The hook
 * threads `STREAM_RETRY` context onto `source` internally; mutations
 * fail fast (no retry) per the plugin default.
 */

import { debounce } from "@solid-primitives/scheduled";
import { type Accessor, createEffect, createRoot, on } from "solid-js";
import { createStore, reconcile, type SetStoreFunction } from "solid-js/store";
import { STREAM_RETRY, type StreamingProcedure } from "../client";
import type { Cell } from "../index";
import { createSubscription, type Subscription } from "./createSubscription";

export type Authority = "server" | "local";

/** A unary procedure ref (mutation/query — non-streaming). */
export type UnaryProcedure<I, O> = (input: I) => Promise<O>;

export interface UseCellServerOptions<T, P = T> {
  source: StreamingProcedure<undefined, T>;
  authority?: "server";
  mutate?: UnaryProcedure<P, unknown> | ((patch: P) => Promise<void> | void);
  onError?: (err: Error) => void;
}

export interface UseCellLocalOptions<T extends object, P = T> {
  source: StreamingProcedure<undefined, T>;
  authority: "local";
  /** Default value for the local store; used until the first server yield. */
  initial: T;
  mutate: UnaryProcedure<P, unknown> | ((patch: P) => Promise<void> | void);
  /** Pure merge: returns the next value. Used when the patch shape `P`
   *  differs from `T` (otherwise `set` semantics suffice). */
  applyPatch?: (current: T, patch: P) => T;
  /** Escape hatch for non-shallow merges (discriminated-union nested fields).
   *  Receives Solid's `setStore` directly so callers can do nested path-form
   *  writes that `applyPatch` + reconcile can't express cleanly.
   *
   *  Prefer flattening the storage shape so this hatch isn't needed — Solid's
   *  setStore deep-merge can't preserve DU variant invariants without a
   *  per-path `reconcile`, and the consumer-side cost is exporting Solid's
   *  store API across the framework boundary. When you must use it, document
   *  at the call site (1) why `applyPatch` is insufficient and (2) the
   *  specific nested mutation required. */
  mergeIntoStore?: (setStore: SetStoreFunction<T>, patch: P) => void;
  /** When set, `patch` / `set` apply to the local store synchronously (the
   *  instant-UI guarantee local authority exists for) but defer the server
   *  `mutate` to a trailing-debounced flush — rapid writes within `coalesceMs`
   *  of each other collapse into one server round-trip. The motivating case is
   *  a resize splitter whose `onSizesChange` fires dozens of times/sec during a
   *  drag: the local store must update every frame (a sibling reads it to track
   *  the handle), but only the settled value needs to reach the server.
   *
   *  Pending patches accumulate via `applyPatch` (the same merge the cell runs
   *  locally), so heterogeneous keys written inside one window — e.g. a panel
   *  `size` followed by a `collapsed` toggle — both land in the single flush;
   *  the payload stays a real patch `P`, never a full-value snapshot. This
   *  requires `applyPatch` to be a pure spread-merge (missing keys absent, not
   *  defaulted); cells with a non-spread merge must not set `coalesceMs`.
   *
   *  CONTRACT CHANGE: with `coalesceMs` set, the promise `patch` / `set` returns
   *  resolves after the *local* apply, not after the server ack. A caller that
   *  must observe server acknowledgement has to gate on the server echo, not on
   *  this promise. Flush failures surface via `onError`, not the returned
   *  promise. */
  coalesceMs?: number;
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

/** Wrap a streaming procedure ref into the thunk shape `createSubscription`
 *  expects, threading `STREAM_RETRY` context so transport drops re-subscribe
 *  transparently. */
function streamingThunk<T>(
  source: StreamingProcedure<undefined, T>,
): () => Promise<AsyncIterable<T>> {
  return () => source(undefined, { context: STREAM_RETRY });
}

function useCellServer<Name extends string, T, P>(
  _cell: Cell<Name, T>,
  options: UseCellServerOptions<T, P>,
): UseCellResult<T, P> {
  const sub = createRoot(() =>
    createSubscription(streamingThunk(options.source), {
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
    const s = createSubscription(streamingThunk(options.source), {
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

  // Coalesced server flush (opt-in via `coalesceMs`). `applyLocal` has already
  // run by the time we enqueue, so the store is current; we defer only the
  // server round-trip. Patches merge through `applyPatch` so a flush carries
  // every key touched in the window, not just the last write.
  let pendingPatch: P | undefined;
  function flushPending(): void {
    const p = pendingPatch;
    if (p === undefined) return;
    pendingPatch = undefined;
    void Promise.resolve(options.mutate(p)).catch((err: unknown) => {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  }
  // Coalescing merges queued patches through `applyPatch`; without it, two
  // patches in one window would collapse to last-write-wins and silently drop
  // the earlier keys. Enforce the documented precondition at construction so a
  // misconfigured cell fails loudly here, not as missing data at runtime.
  if (options.coalesceMs !== undefined && options.applyPatch === undefined) {
    throw new Error(
      "useCell: coalesceMs requires applyPatch — coalescing merges queued " +
        "patches through it, so without it interleaved writes would be lost.",
    );
  }
  const scheduleFlush =
    options.coalesceMs !== undefined
      ? debounce(flushPending, options.coalesceMs)
      : undefined;
  function enqueue(p: P): void {
    const merge = options.applyPatch;
    // `merge === undefined` can't happen once `scheduleFlush` is set (the guard
    // above threw); the check is here only to narrow the optional for TS.
    pendingPatch =
      pendingPatch === undefined || merge === undefined
        ? p
        : (merge(pendingPatch as unknown as T, p) as unknown as P);
    scheduleFlush?.();
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
      if (scheduleFlush) enqueue(next as unknown as P);
      else await options.mutate(next as unknown as P);
    },
    patch: async (p) => {
      applyLocal(p);
      if (scheduleFlush) enqueue(p);
      else await options.mutate(p);
    },
    sub,
  };
}
