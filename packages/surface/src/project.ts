/**
 * `projectSurface` — derive a surface B from a live client of surface A.
 *
 * The wire links (`websocketLink`, `stdioLink`, `directLink`) move a surface
 * *across* a boundary. `projectSurface` does something orthogonal: it builds a
 * *new* surface (B) whose handlers are implemented by *consuming* an existing
 * surface (A) through a client. B is "a server that's a client" — its cells,
 * streams, and procedures are projections of A's, mapped on the fly.
 *
 * The canonical use is an adapter: A is the app's native reactive surface, B
 * is a foreign protocol's surface (an MCP server, a public read-only mirror, a
 * narrowed view for a less-trusted peer). B's handlers don't reimplement A's
 * state — they subscribe to A through an in-process `directLink` client and map
 * each frame. One source of truth (A), N projected faces (B…).
 *
 * Three derive helpers do the mapping, each preserving the matching primitive's
 * wire contract:
 *
 *   - `deriveCell`    — track an upstream A-cell (snapshot-then-deltas) and
 *                       republish `map(frame)` as B's own cell. Plugs into
 *                       `implementSurface`'s `cells.<key>` slot.
 *   - `deriveStream`  — subscribe an upstream async-iterable and map each
 *                       frame, preserving snapshot-then-deltas. Plugs into the
 *                       `streams.<key>` slot's `{ source }`.
 *   - `deriveEvent`   — same as `deriveStream` but with no snapshot obligation,
 *                       for the `events.<key>` slot.
 *
 * Teardown is the load-bearing detail: every helper threads B's abort signal
 * into A's client call and wraps the upstream iterator with `iterateUntilAborted`
 * so an abort-time rejection from A's iterator (the publisher rejects pending
 * pulls with `signal.reason` on shutdown) is swallowed rather than surfaced as
 * an unhandled rejection. Aborting a B subscription thus tears down the
 * matching A subscription with no leak and no noise.
 */

import type { ContractRouterClient } from "@orpc/contract";
import { createRouterClient } from "@orpc/server";
import {
  defineSurface,
  type Surface,
  type SurfaceContractFor,
  type SurfaceSpec,
} from "./define";
import {
  type EventHandlerDeps,
  type ImplementSurfaceDeps,
  implementSurface,
  inMemoryCell,
  isAbortReason,
  iterateUntilAborted,
  type StreamHandlerDeps,
} from "./server";

// ── A client of a surface ───────────────────────────────────────────────

/** A `ContractRouterClient` of a surface — the same shape `directLink` /
 *  `websocketLink` yield. Reach for `client.surface.<cellKey>.get(...)` and
 *  `client.surface.<ns>.<verb>(...)`. The type parameter is the source
 *  surface's *spec*, so a projection's `deps` callback names the source
 *  surface once and gets a fully-typed client. */
export type SurfaceClientOf<S extends SurfaceSpec> = ContractRouterClient<
  SurfaceContractFor<S>
>;

/** A structural, spec-agnostic view of *any* surface client — just the
 *  top-level `surface` namespace. Every `SurfaceClientOf<S>` is assignable to
 *  it. Used only where a precise per-spec client type would force a second
 *  materialization of the (large) client union in the same type-check pass and
 *  overflow TS's union budget — see `projectSurface`'s `implement` parameter.
 *  Not a substitute for `SurfaceClientOf<S>` where precision is cheap. */
export type SurfaceClientLike = { surface: Record<string, unknown> };

/** Build an in-process client of a *sibling* surface from its served router —
 *  a thin, surface-typed wrapper over `directLink<typeof source.contract>`.
 *
 *  This is how surface B's handlers obtain a client of surface A inside the
 *  same process: A is implemented (`implementSurface` → `{ router }`), then B's
 *  projection calls `surfaceClientRef(A, router)` to subscribe to A's cells /
 *  streams and map them.
 *
 *  The `router` arg is typed loosely (the same `Parameters<typeof
 *  createRouterClient>[0]` `directLink` takes), because `implementSurface`'s
 *  router is typed loosely — its surface walk is dynamic. The *return* type is
 *  pinned precisely off `S`, so call sites get full inference even though the
 *  router itself is opaque. */
export function surfaceClientRef<S extends SurfaceSpec>(
  _source: Surface<S>,
  router: Parameters<typeof createRouterClient>[0],
): SurfaceClientOf<S> {
  // Build the client exactly as `directLink` does — `createRouterClient(router)`
  // — but cast the *result* to `SurfaceClientOf<S>` rather than instantiating
  // `directLink<C>`'s own `ContractRouterClient<C>` over an abstract spec.
  // Feeding `directLink` a generic `SurfaceContractFor<S>` makes TS materialize
  // the client union type twice (once here, once at the caller's own
  // annotation), which overflows the union budget; one cast off the opaque
  // router avoids the second materialization. The `_source` arg is for
  // inference + call-site readability (it pins `S`); the runtime client comes
  // entirely from `router`. */
  return createRouterClient(router) as unknown as SurfaceClientOf<S>;
}

// ── deriveStream / deriveEvent — map an upstream iterable ────────────────

/** The shape of an upstream streaming call as a client exposes it:
 *  `(input, { signal }) => Promise<AsyncIterable<F>>` — exactly
 *  `client.surface.<key>.get`. Narrower than `StreamingProcedure` (we only
 *  need the signal) so a projection can pass `client.surface.x.get` directly. */
export type UpstreamSource<I, F> = (
  input: I,
  opts: { signal?: AbortSignal },
) => Promise<AsyncIterable<F>>;

/** Iterate an upstream async-iterable and yield each mapped frame, ending
 *  cleanly if the iterator rejects with the abort signal's reason. The
 *  downstream (`streamHandlers` / `eventHandlers`) drives this generator; when
 *  it returns early (abort), `for await … of` calls the upstream iterator's
 *  `return()`, tearing down A's subscription.
 *
 *  The abort-time swallow contract has one home for both phases. The per-frame
 *  swallow is the server's `iterateUntilAborted`, which we compose on top of:
 *  A's publisher may reject a pending pull with `signal.reason` on shutdown,
 *  expected end-of-life noise that ends the iteration cleanly rather than
 *  bubbling as an unhandled rejection. The *pre-iteration* `upstream()`
 *  rejection is handled here only because A's iterable is obtained before
 *  there's an iterator for `iterateUntilAborted` to drive — but it decides
 *  "is this the shutdown rejection?" through the same `isAbortReason`
 *  predicate `iterateUntilAborted` uses, so a fix to the abort behaviour (the
 *  kind `kill.feature` pins) lands in that one predicate, not two copies. */
async function* mapUpstream<I, F, T>(
  upstream: UpstreamSource<I, F>,
  input: I,
  map: (frame: F) => T,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  let iterable: AsyncIterable<F>;
  try {
    iterable = await upstream(input, { signal });
  } catch (err) {
    if (isAbortReason(err, signal)) return;
    throw err;
  }
  for await (const frame of iterateUntilAborted(iterable, signal)) {
    yield map(frame);
  }
}

/** Derive a stream's server source by mapping an upstream A stream/cell.
 *
 *  Preserves snapshot-then-deltas: A's source yields a snapshot first, so the
 *  first mapped frame is B's snapshot. Returns the `{ source }` shape
 *  `implementSurface`'s `streams.<key>` slot (and `StreamHandlerDeps`) expects.
 *
 *      streams: {
 *        quad: deriveStream(
 *          (input, opts) => client.surface.doubled.get(input, opts),
 *          (n) => n * 2,
 *        ),
 *      }
 *
 *  Teardown is handled for you (see `mapUpstream`): B's abort signal threads
 *  into A's call and an abort-time upstream rejection is swallowed. */
export function deriveStream<I, F, T>(
  upstream: UpstreamSource<I, F>,
  map: (frame: F) => T,
): StreamHandlerDeps<I, T> {
  return {
    source: (input, signal) => mapUpstream(upstream, input, map, signal),
  };
}

/** Derive an event's server source by mapping an upstream A event/stream.
 *
 *  Identical wiring to `deriveStream`, but typed as `EventHandlerDeps` — events
 *  carry **no snapshot obligation**, so the upstream may yield zero frames and
 *  need not lead with a current-state snapshot. The split mirrors the
 *  framework's own `streamHandlers` / `eventHandlers` split: it stops a
 *  projection from accidentally feeding a snapshot-free event source into a
 *  stream slot that promises snapshot-then-deltas. */
export function deriveEvent<I, F, T>(
  upstream: UpstreamSource<I, F>,
  map: (frame: F) => T,
): EventHandlerDeps<I, T> {
  return {
    source: (input, signal) => mapUpstream(upstream, input, map, signal),
  };
}

// ── deriveCell — track + map an upstream cell ────────────────────────────

/** The `cells.<key>` impl deps a derived (no-patch) cell needs: an
 *  `inMemoryCell` store and a `connect` hook that subscribes upstream. Matches
 *  the no-patch branch of `CellImplDeps`. */
export interface DerivedCellDeps<T> {
  store: { get(): T; set(value: T): void };
  connect: (cell: { set: (next: T) => void }) => void;
}

/** Derive a cell that tracks an upstream A cell and republishes `map(frame)`.
 *
 *  An A cell's `get` yields snapshot-then-deltas; this subscribes to it and
 *  pushes `map(frame)` into B's cell on every frame, so B's cell snapshot
 *  reflects A's *current* value and B's deltas mirror A's. Returns deps for the
 *  no-patch `cells.<key>` slot — an `inMemoryCell`-backed store plus the
 *  `connect` hook `implementSurface` fires once after wiring:
 *
 *      cells: {
 *        count1: deriveCell(
 *          (opts) => client.surface.count.get(undefined, opts),
 *          (n) => n + 1,
 *          0,            // initial, until A's first snapshot lands
 *        ),
 *      }
 *
 *  `initial` is B's value before A's snapshot arrives (the connect subscription
 *  is async). Once A's first frame lands it's overwritten with the mapped
 *  snapshot through the same equals/onWrite/store.set/bus.publish path.
 *
 *  Teardown: `connect` owns its own `AbortController`. The framework has no
 *  "disconnect" hook for a cell (a cell is process-lifetime), so the upstream
 *  subscription lives as long as B's implementation does — which is correct: B's
 *  cell must keep tracking A for B's whole life. The returned `dispose` lets a
 *  caller that *does* own a teardown point (a test, a scoped adapter) abort the
 *  upstream explicitly.
 *
 *  Error policy: the subscribe loop is fire-and-forget (the framework calls
 *  `connect` and never awaits it), so a non-abort upstream failure cannot
 *  propagate to a caller — left to throw it would become an *unhandled
 *  rejection* and the derived cell would silently stop tracking. Instead a
 *  non-abort error is routed to `opts.onError` and the loop ends; the cell
 *  keeps its last value. `onError` defaults to a stderr log so a failure is
 *  never invisible — pass `() => {}` to opt into silent-stop deliberately, or
 *  supply a handler that re-arms the subscription if you need retry/backoff.
 *  (Abort-time rejections — `dispose()` / shutdown — are end-of-life noise and
 *  are always swallowed.) */
export function deriveCell<F, T>(
  upstream: (opts: { signal?: AbortSignal }) => Promise<AsyncIterable<F>>,
  map: (frame: F) => T,
  initial: T,
  opts?: { onError?: (err: unknown) => void },
): DerivedCellDeps<T> & { dispose: () => void } {
  const store = inMemoryCell<T>(initial);
  const controller = new AbortController();
  const onError =
    opts?.onError ??
    ((err: unknown) => {
      console.error("deriveCell: upstream subscription failed", err);
    });
  const isAbort = (err: unknown): boolean =>
    isAbortReason(err, controller.signal);
  return {
    // `inMemoryCell` satisfies the `{ get, set }` store shape via
    // `current()` / `set()`; adapt the names the cell store interface uses.
    store: {
      get: () => store.current(),
      set: (v) => store.set(v),
    },
    connect: (cell) => {
      // Fire-and-forget subscribe loop. The framework calls `connect` once,
      // after the cell ctx is wired, handing us its setter — every mapped
      // frame flows through the surface's equals/onWrite/store.set/bus.publish
      // path (we do NOT touch `store` directly, or the wire side wouldn't see
      // the publish). The per-frame abort-time swallow lives in the shared
      // `iterateUntilAborted`; this catch handles only the pre-iteration
      // `upstream()` rejection (abort-shaped → swallow, else → `onError`) and
      // any non-abort iteration failure, routed to `onError` rather than
      // rethrown into the void.
      void (async () => {
        try {
          const iterable = await upstream({ signal: controller.signal });
          for await (const frame of iterateUntilAborted(
            iterable,
            controller.signal,
          )) {
            cell.set(map(frame));
          }
        } catch (err) {
          if (isAbort(err)) return;
          onError(err);
        }
      })();
    },
    dispose: () => controller.abort(),
  };
}

// ── projectSurface — the headline primitive ──────────────────────────────

/** A projection of surface A onto a *declared* surface B: B's spec plus a
 *  `deps` factory that, given a live A-client, returns B's server impl deps.
 *
 *  B's spec is declared (not computed from A) on purpose — computing it would
 *  push a second mapped type through TS's union budget for no ergonomic gain.
 *  The ergonomics live in the derive helpers (`deriveCell` / `deriveStream` /
 *  `deriveEvent`) the author reaches for *inside* `deps`. */
export interface SurfaceProjection<
  A extends SurfaceSpec,
  B extends SurfaceSpec,
> {
  /** B's declared spec. */
  spec: B;
  /** Given a live client of A, build B's server implementation deps. Called
   *  by `implement` once per implementation, with the A-client the caller
   *  supplies (typically `surfaceClientRef(A, aRouter)`).
   *
   *  `A` is wrapped in `NoInfer` so it's inferred *only* from `projectSurface`'s
   *  `source` argument — never from this contravariant client position. */
  deps: (client: SurfaceClientOf<NoInfer<A>>) => ImplementSurfaceDeps<B>;
}

/** Project surface A onto a new surface B whose handlers consume A via a
 *  client. Returns B's `surface` value (its contract + descriptors, ready for
 *  the contract side) and an `implement` fn that, given an A-client, wires B's
 *  server router + ctx by feeding `projection.deps(client)` to
 *  `implementSurface`.
 *
 *      const projected = projectSurface(appSurface, {
 *        spec: { cells: { … }, streams: { … }, procedures: { … } },
 *        deps: (a) => ({
 *          channel: inMemoryChannelByName(),
 *          cells:   { mirror: deriveCell((o) => a.surface.x.get(undefined, o), map, 0) },
 *          streams: { view:   deriveStream((i, o) => a.surface.s.get(i, o), map) },
 *          procedures: { ns: { run: ({ input }) => a.surface.ns.run(input) } },
 *        }),
 *      });
 *
 *      // A is already implemented elsewhere → its router:
 *      const aClient = surfaceClientRef(appSurface, aRouter);
 *      const { router, ctx } = projected.implement(aClient);
 *      const bClient = directLink<typeof projected.surface.contract>(router);
 *
 *  The return type of `implement` is left as `implementSurface`'s own (the
 *  loosely-typed `router` + precisely-typed `ctx`) — see `implementSurface`.
 *
 *  One subtlety on the public types: the *fully-typed* A-client
 *  (`SurfaceClientOf<A>`) is materialized exactly once — for the `deps`
 *  callback, where it earns its keep (autocomplete + checked frame types inside
 *  the derive helpers). `implement`'s `client` parameter is typed loosely
 *  (`SurfaceClientLike` — the structural `{ surface: … }` shape every client
 *  has) rather than re-spelling `SurfaceClientOf<A>`: re-materializing the large
 *  client union a second time in the same call check overflows TS's union
 *  budget for a realistically-sized source surface. Callers always pass the
 *  result of `surfaceClientRef(source, router)` (already `SurfaceClientOf<A>`,
 *  assignable to the loose shape), so no safety is lost — `deps` still sees the
 *  precise type. */
export function projectSurface<A extends SurfaceSpec, B extends SurfaceSpec>(
  _source: Surface<A>,
  projection: SurfaceProjection<A, B>,
): {
  surface: Surface<B>;
  implement: (
    client: SurfaceClientLike,
  ) => ReturnType<typeof implementSurface<B>>;
} {
  const surface = defineSurface(projection.spec);
  // Inside the body, view `deps` through its loose client shape so the heavy
  // `SurfaceClientOf<A>` union is never re-materialized here (it's already paid
  // for once at `deps`' public annotation). Runtime is identical — `deps` only
  // reads `client.surface.*`, which `SurfaceClientLike` covers.
  const deps = projection.deps as unknown as (
    client: SurfaceClientLike,
  ) => ImplementSurfaceDeps<B>;
  return {
    surface,
    implement: (client) => implementSurface(surface, deps(client)),
  };
}
