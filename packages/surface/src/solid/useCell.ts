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
 * `source` and `mutate` are typed member refs off the surface face (e.g.
 * `client.cells.preferences`'s bound `get` / `patch`). The hook applies the
 * framework's retry fence to `source` internally, so a transport drop re-subscribes
 * and the next frame is a fresh snapshot; mutations fail fast (a unary call is not
 * retried — retrying a write would repeat it).
 */

import { debounce } from "@solid-primitives/scheduled";
import { Effect } from "effect";
import { type Accessor, createEffect, on } from "solid-js";
import { createStore, reconcile, type SetStoreFunction } from "solid-js/store";
import {
  type StreamingProcedure,
  type UnaryEffect,
  unenrolledStreamCall,
} from "../client";
import type { Cell } from "../index";
import { runDetached } from "../runStream";
import { createSubscription, type Subscription } from "./createSubscription";

export type Authority = "server" | "local";

/** How a cell WRITES: the member ref off the face (a {@link UnaryEffect}), or any
 *  function of the patch that describes the write.
 *
 *  Either way it is a DESCRIPTION, never a running call. `set` / `patch` hand the
 *  description back to the caller, which runs it at its own UI edge; the coalesced
 *  flush runs it on a detached fiber, because by then no caller is left to. */
export type CellMutate<P> = (patch: P) => Effect.Effect<void, unknown>;

export interface UseCellServerOptions<T, P = T> {
  source: StreamingProcedure<undefined, T>;
  authority?: "server";
  mutate?: CellMutate<P>;
  onError?: (err: Error) => void;
  /** Fired when the cell's stream ends NORMALLY (typed end) — the surface client
   *  threads the keyed cache's slot eviction here so a re-served cell rebuilds. */
  onComplete?: () => void;
}

export interface UseCellLocalOptions<T extends object, P = T> {
  source: StreamingProcedure<undefined, T>;
  authority: "local";
  /** Default value for the local store; used until the first server yield. */
  initial: T;
  mutate: CellMutate<P>;
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
  /** Trailing-debounce window (ms) for writes that opt in via
   *  `patch(p, { coalesce: true })`. Such a write applies to the local store
   *  synchronously (the instant-UI guarantee local authority exists for) but
   *  defers the server `mutate` — opted-in writes within `coalesceMs` of each
   *  other collapse into one server round-trip. The motivating case is a resize
   *  splitter whose `onSizesChange` fires dozens of times/sec during a drag: the
   *  local store must update every frame (a sibling reads it to track the
   *  handle), but only the settled value needs to reach the server.
   *
   *  Coalescing is per-write, not per-cell: a plain `patch(p)` still flushes
   *  immediately. This matters when one cell mixes volatilities — preferences
   *  holds both continuous panel sizes (coalesce) and discrete toggles like
   *  `colorScheme` (must persist immediately, or a quick reload loses them).
   *
   *  Pending patches accumulate via `applyPatch` (the same merge the cell runs
   *  locally), so heterogeneous keys written inside one window both land in the
   *  single flush; the payload stays a real patch `P`, never a full-value
   *  snapshot. This requires `applyPatch` to be a pure spread-merge (missing
   *  keys absent, not defaulted) — enforced at construction.
   *
   *  CONTRACT: a coalesced `patch`'s effect completes after the *local* apply, not
   *  the server ack; callers needing acknowledgement must gate on the server echo.
   *  Flush failures surface via `onError`, not on the returned effect's channel —
   *  by the time the flush runs, the fiber that queued it is long gone. */
  coalesceMs?: number;
  onError?: (err: Error) => void;
  /** Fired when the cell's stream ends NORMALLY (typed end) — the surface client
   *  threads the keyed cache's slot eviction here so a re-served cell rebuilds. */
  onComplete?: () => void;
}

export type UseCellOptions<T, P = T> =
  | UseCellServerOptions<T, P>
  | (T extends object ? UseCellLocalOptions<T, P> : never);

/** Per-write options for `patch`. `coalesce` opts an individual write into the
 *  cell's trailing-debounced server flush (requires `coalesceMs` configured);
 *  it is the per-write half of the cadence decision — see `coalesceMs`. */
export interface PatchOptions {
  coalesce?: boolean;
}

export interface UseCellResult<T, P> {
  value: Accessor<T | undefined>;
  pending: Accessor<boolean>;
  error: Accessor<Error | undefined>;
  set: (next: T) => Effect.Effect<void, unknown>;
  patch: (p: P, opts?: PatchOptions) => Effect.Effect<void, unknown>;
  sub: Subscription<T>;
}

/** The local-authority result: `value` is `Accessor<T>`, never `undefined` —
 *  `useCellLocal`'s store is seeded synchronously from the required `initial`
 *  (`UseCellLocalOptions.initial: T`), so there is no pre-first-value gap a
 *  local-authority consumer could observe. `T | undefined` is a SERVER-authority
 *  fact only (no first frame yet); widening it onto local authority invited dead
 *  `value() ?? fallback` / `<Show when={value()}>` branches a local cell can
 *  never take. Structurally assignable to {@link UseCellResult} (`Accessor<T>` is
 *  a narrower `Accessor<T | undefined>`), so nothing that already accepts the
 *  server-shaped result breaks. */
export interface UseCellLocalResult<T, P>
  extends Omit<UseCellResult<T, P>, "value"> {
  value: Accessor<T>;
}

export function useCell<Name extends string, T extends object, P = T>(
  cell: Cell<Name, T>,
  options: UseCellLocalOptions<T, P>,
): UseCellLocalResult<T, P>;
export function useCell<Name extends string, T, P = T>(
  cell: Cell<Name, T>,
  options: UseCellServerOptions<T, P>,
): UseCellResult<T, P>;
export function useCell<Name extends string, T, P = T>(
  cell: Cell<Name, T>,
  options: UseCellOptions<T, P>,
): UseCellResult<T, P> | UseCellLocalResult<T, P> {
  if (options.authority === "local") {
    return useCellLocal(
      cell as Cell<Name, T & object>,
      options as unknown as UseCellLocalOptions<T & object, P>,
    ) as unknown as UseCellLocalResult<T, P>;
  }
  return useCellServer(cell, options as UseCellServerOptions<T, P>);
}

/** The cell's own key is the subscription's LABEL in the liveness registry
 *  (`../subscriptions`) — the same spelling `client.health()` enrols it under, so
 *  the two records name one subscription one way. It is the first runtime read of
 *  the descriptor these hooks used to take purely as a type discriminator; a
 *  descriptor is always present (`surfaceClient` passes the spec's own), and an
 *  absent one throwing here is the honest fail-fast rather than a subscription
 *  that quietly reports as `(unlabeled)`.
 *
 *  The cell's fenced stream: the member's own `get`, wrapped in the framework's
 *  per-subscription retry fence so a transport drop re-subscribes transparently and
 *  the next frame is a fresh snapshot. Disposing the cell (the last consumer of a
 *  shared dedup slot leaving) interrupts the subscription's fiber, which tears the
 *  wire stream down through the stream's own finalizers. */
function cellStream<T>(
  source: StreamingProcedure<undefined, T>,
  label: string | undefined,
) {
  return unenrolledStreamCall(source, undefined, { label });
}

function useCellServer<Name extends string, T, P>(
  cellDescriptor: Cell<Name, T>,
  options: UseCellServerOptions<T, P>,
): UseCellResult<T, P> {
  // No wrapping `createRoot`: the subscription runs under the CALLER's owner — the
  // keyed-cache slot when the surface client shares it, else the consumer's own
  // owner — so it aborts when that owner disposes instead of leaking app-lifetime.
  const sub = createSubscription(
    cellStream(options.source, cellDescriptor.name),
    {
      onError: options.onError,
      onComplete: options.onComplete,
    },
  );

  /** Suspended, so a cell with no mutate verb fails when the write is RUN rather
   *  than throwing at the moment a handler merely builds it. */
  function callMutate(p: P): Effect.Effect<void, unknown> {
    return Effect.suspend(() =>
      options.mutate
        ? options.mutate(p)
        : Effect.fail(new Error("useCell: no mutate handler provided")),
    );
  }

  return {
    value: () => sub(),
    pending: sub.pending,
    error: sub.error,
    set: (next) => callMutate(next as unknown as P),
    // Server authority has no local store to coalesce against — every write is
    // a round-trip; the `opts` arg is accepted for signature parity and ignored.
    patch: (p) => callMutate(p),
    sub,
  };
}

function useCellLocal<Name extends string, T extends object, P>(
  cellDescriptor: Cell<Name, T>,
  options: UseCellLocalOptions<T, P>,
): UseCellLocalResult<T, P> {
  const [store, setStore] = createStore<T>(options.initial);
  // Mutable guard: once any server value arrives, seed the local store
  // from it and never overwrite again. Server echoes after init must not
  // stomp local mutations whose RPC hasn't round-tripped — the local
  // store is authoritative thereafter. A reactive signal would fire
  // unnecessary effects for a one-time transition.
  let initialized = false;

  // No wrapping `createRoot`: the subscription + its seed effect run under the
  // CALLER's owner (the keyed-cache slot when shared, else the consumer's own owner),
  // so they dispose with that owner instead of leaking app-lifetime.
  const sub = createSubscription(
    cellStream(options.source, cellDescriptor.name),
    {
      onError: options.onError,
      onComplete: options.onComplete,
    },
  );
  createEffect(
    on(
      () => sub(),
      (server) => {
        if (server !== undefined && !initialized) {
          initialized = true;
          setStore(reconcile(server as T));
        }
      },
    ),
  );

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
    // DETACHED, deliberately: the window this flush waited out is exactly the
    // window in which the owner that queued it may have gone away, and dropping a
    // user's edit because their component unmounted is the bug coalescing exists to
    // avoid. `runDetached` is this package's one write edge; the failure has no
    // caller left to reach, so it goes to `onError` like every other cell fault.
    runDetached(options.mutate(p), (err) => options.onError?.(err));
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
    // The local apply is INSIDE the suspend, so it happens when the caller runs the
    // write — not when it builds it. That keeps "apply locally, then send" one
    // ordering rather than two, and an unrun write changes nothing at all.
    set: (next) =>
      Effect.suspend(() => {
        applyLocal(next as unknown as P);
        return options.mutate(next as unknown as P);
      }),
    patch: (p, opts) =>
      Effect.suspend(() => {
        applyLocal(p);
        if (opts?.coalesce && scheduleFlush) {
          enqueue(p);
          return Effect.void;
        }
        return options.mutate(p);
      }),
    sub,
  };
}
