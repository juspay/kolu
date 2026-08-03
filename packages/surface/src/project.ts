/**
 * `projectSurface` — derive a surface B from a live client of surface A.
 *
 * The links (`websocketLink`, `stdioLink`, `directDispatch`) move a surface
 * *across* a boundary. `projectSurface` does something orthogonal: it builds a
 * *new* surface (B) whose handlers are implemented by *consuming* an existing
 * surface (A) through a client. B is "a server that's a client" — its cells,
 * streams, and procedures are projections of A's, mapped on the fly.
 *
 * The canonical use is an adapter: A is the app's native reactive surface, B
 * is a foreign protocol's surface (an MCP server, a public read-only mirror, a
 * narrowed view for a less-trusted peer). B's handlers don't reimplement A's
 * state — they subscribe to A through an in-process client and map each frame.
 * One source of truth (A), N projected faces (B…).
 *
 * Three derive helpers do the mapping, each preserving the matching primitive's
 * wire contract:
 *
 *   - `deriveCell`    — track an upstream A-cell (snapshot-then-deltas) and
 *                       republish `map(frame)` as B's own cell. Plugs into
 *                       `implementSurface`'s `cells.<key>` slot.
 *   - `deriveStream`  — subscribe an upstream stream and map each frame,
 *                       preserving snapshot-then-deltas. Plugs into the
 *                       `streams.<key>` slot's `{ source }`.
 *   - `deriveEvent`   — same as `deriveStream` but with no snapshot obligation,
 *                       for the `events.<key>` slot.
 *
 * **Teardown got simpler, not more subtle (D10).** The upstream is a `Stream` and
 * the downstream slot wants a `Stream`, so `deriveStream`/`deriveEvent` are a
 * `Stream.map` and nothing else: B's consumer interrupting its fiber interrupts
 * the mapped stream, which interrupts A's subscription through the stream's own
 * finalizers. There is no abort signal to thread, no abort-time rejection to
 * swallow, and no `iterateUntilAborted` wrapper — the whole class of "was that
 * failure just our own teardown?" question disappears with the AbortSignal that
 * raised it. Only `deriveCell` still holds a controller, because a cell CONNECTOR
 * is still AbortSignal-shaped (a `reactor.ts` coupling S2 recorded, not a choice
 * here).
 */

import { Cause, Effect, Fiber, Stream } from "effect";
import {
  buildSurfaceFace,
  type StreamingProcedure,
  type SurfaceFace,
} from "./client";
import {
  type CellSpec,
  defineSurface,
  type EventSpec,
  type ProcedureSpec,
  type StreamSpec,
  type Surface,
  type SurfaceSpec,
  type WireSchemaAny,
} from "./define";
import { directDispatch } from "./links/direct";
import {
  type CellStore,
  type Disposer,
  type EventHandlerDeps,
  type ImplementSurfaceDeps,
  implementSurface,
  inMemoryCell,
  type StreamHandlerDeps,
  type SurfaceHandlers,
} from "./server";

// ── A client of a surface ───────────────────────────────────────────────

/** The READ face of a surface's members — what a projection's `deps` callback
 *  reaches for. One `get` per cell / stream / event plus the declared procedures:
 *  deliberately NARROWER than the full bound client (`@kolu/surface/solid`'s
 *  `surfaceClient`), because a projection CONSUMES A — it never mutates it, and a
 *  mapped type that also spelled `set`/`patch`/`upsert`/`delete` would cost union
 *  budget for members no projection can use.
 *
 *  Inputs follow the face's own rule (D2/#13): a stream's or event's input is a
 *  pure argument, so it is the ENCODED side and the face decodes it; outputs are
 *  the DECODED domain values a `map` operates on. */
export type SurfaceReadFace<S extends SurfaceSpec> = {
  [K in keyof S["cells"] & string]: {
    get: StreamingProcedure<
      undefined,
      NonNullable<S["cells"]>[K]["schema"]["Type"]
    >;
  };
} & {
  [K in keyof S["streams"] & string]: {
    get: StreamingProcedure<
      NonNullable<S["streams"]>[K]["inputSchema"]["Encoded"],
      NonNullable<S["streams"]>[K]["outputSchema"]["Type"]
    >;
  };
} & {
  [K in keyof S["events"] & string]: {
    get: StreamingProcedure<
      NonNullable<S["events"]>[K]["inputSchema"]["Encoded"],
      NonNullable<S["events"]>[K]["outputSchema"]["Type"]
    >;
  };
} & {
  [NS in keyof S["procedures"] & string]: {
    // The same four-arm ladder the Solid face's `BoundProcedure` resolves, on the
    // same two sides — encoded in, decoded out. A projection forwards a procedure
    // by CALLING it, so erasing either side here would silently un-type the one
    // place a projection's `deps` reads a remote result.
    [V in keyof NonNullable<S["procedures"]>[NS] & string]: NonNullable<
      S["procedures"]
    >[NS][V] extends {
      input: infer In extends WireSchemaAny;
      output: infer Out extends WireSchemaAny;
    }
      ? (input: In["Encoded"]) => Promise<Out["Type"]>
      : NonNullable<S["procedures"]>[NS][V] extends {
            input: infer In extends WireSchemaAny;
          }
        ? (input: In["Encoded"]) => Promise<void>
        : NonNullable<S["procedures"]>[NS][V] extends {
              output: infer Out extends WireSchemaAny;
            }
          ? (input?: undefined) => Promise<Out["Type"]>
          : (input?: undefined) => Promise<void>;
  };
};

/** A client of a surface — the nested member face `buildSurfaceFace` mints, typed
 *  from the SOURCE surface's spec. Reach for `client.surface.<cellKey>.get()` and
 *  `client.surface.<ns>.<verb>(...)`. The type parameter is the source surface's
 *  *spec*, so a projection's `deps` callback names the source surface once and gets
 *  a typed read face.
 *
 *  It IS the face, with only the `surface` nesting re-typed: the face's other
 *  nestings (today `effect`) ride through erased, so a projection that wants a
 *  composable member call reaches `client.effect.<ns>.<verb>` and narrows it
 *  itself. Spelling this as a narrowing of `SurfaceFace` rather than a fresh
 *  object type is also what keeps `surfaceClientRef`'s single cast a NARROWING
 *  rather than an `as unknown as` — a new nesting on the face cannot silently
 *  turn that cast into a lie. */
export type SurfaceClientOf<S extends SurfaceSpec> = Omit<
  SurfaceFace,
  "surface"
> & {
  readonly surface: SurfaceReadFace<S>;
};

/** A structural, spec-agnostic view of *any* surface client — just the
 *  top-level `surface` namespace. Every `SurfaceClientOf<S>` is assignable to
 *  it. Used only where a precise per-spec client type would force a second
 *  materialization of the client mapped type in the same type-check pass and
 *  overflow TS's union budget — see `projectSurface`'s `implement` parameter.
 *  Not a substitute for `SurfaceClientOf<S>` where precision is cheap. */
export type SurfaceClientLike = { surface: Record<string, unknown> };

/** Build an in-process client of a *sibling* surface from its served handlers —
 *  a thin, surface-typed wrapper over `buildSurfaceFace(source, directDispatch(…))`.
 *
 *  This is how surface B's handlers obtain a client of surface A inside the
 *  same process: A is implemented (`implementSurface` → `{ handlers }`), then B's
 *  projection calls `surfaceClientRef(A, served)` to subscribe to A's cells /
 *  streams and map them. Zero serialization in either direction — A's handler
 *  returns the very `Stream` B's mapper consumes.
 *
 *  The *return* type is pinned precisely off `S`, so call sites get inference even
 *  though the served handler record is typed loosely (its bind walk is dynamic). */
export function surfaceClientRef<S extends SurfaceSpec>(
  source: Surface<S>,
  served: { readonly handlers: SurfaceHandlers },
): SurfaceClientOf<S> {
  // The face is built by the SAME walk every other client uses, then cast to the
  // read-face projection: the runtime object carries the mutation verbs too (it is
  // the full face), and `SurfaceReadFace` simply declines to type them. One cast
  // here beats re-materialising a second precise client type at every call site.
  return buildSurfaceFace(source, directDispatch(served)) as SurfaceClientOf<S>;
}

// ── deriveStream / deriveEvent — map an upstream stream ──────────────────

/** The shape of an upstream streaming call as a client exposes it: `(input) =>
 *  Stream<F>` — exactly `client.surface.<key>.get`. An alias of
 *  {@link StreamingProcedure} kept for call-site readability at the derive
 *  helpers, where "upstream" is the load-bearing word. */
export type UpstreamSource<I, F> = StreamingProcedure<I, F>;

/** Derive a stream's server source by mapping an upstream A stream/cell.
 *
 *  Preserves snapshot-then-deltas: A's source leads with a snapshot, so the first
 *  mapped frame is B's snapshot. Returns the `{ source }` shape
 *  `implementSurface`'s `streams.<key>` slot (and `StreamHandlerDeps`) expects.
 *
 *      streams: {
 *        quad: deriveStream(a.surface.doubled.get, (n) => n * 2),
 *      }
 *
 *  Teardown is inherited, not implemented: B's consumer interrupts, `Stream.map`
 *  propagates the interruption upstream, A's subscription closes. */
export function deriveStream<I, F, T>(
  upstream: UpstreamSource<I, F>,
  map: (frame: F) => T,
): StreamHandlerDeps<I, T> {
  return {
    // `Stream.map` keeps the upstream's error channel, but a served handler's
    // stream is typed `Stream<T>` (no declared failures): an upstream failure here
    // is a DEFECT — nothing in B's contract declared it — so `Stream.orDie` states
    // that rather than laundering it into a silent end (D4).
    source: (input) => Stream.orDie(Stream.map(upstream(input), map)),
  };
}

/** Derive an event's server source by mapping an upstream A event/stream.
 *
 *  Identical wiring to `deriveStream`, but typed as `EventHandlerDeps` — events
 *  carry **no snapshot obligation**, so the upstream may emit zero frames and
 *  need not lead with a current-state snapshot. The split mirrors the
 *  framework's own `streamHandlers` / `eventHandlers` split: it stops a
 *  projection from accidentally feeding a snapshot-free event source into a
 *  stream slot that promises snapshot-then-deltas. */
export function deriveEvent<I, F, T>(
  upstream: UpstreamSource<I, F>,
  map: (frame: F) => T,
): EventHandlerDeps<I, T> {
  return {
    source: (input) => Stream.orDie(Stream.map(upstream(input), map)),
  };
}

// ── deriveCell — track + map an upstream cell ────────────────────────────

/** The `cells.<key>` impl deps a derived (no-patch) cell needs: an
 *  `inMemoryCell` store and a `connect` hook that subscribes upstream. Matches
 *  the no-patch branch of `CellImplDeps`. `connect` returns a {@link Disposer}
 *  (interrupts the upstream subscription) so the runtime's `close()` tears the
 *  derivation down — the derived cell joins the {@link SurfaceRuntime}'s
 *  ownership rather than living for the process lifetime unconditionally. */
export interface DerivedCellDeps<T> {
  store: CellStore<T>;
  /** Returns an ASYNC disposer — the "await teardown" guarantee is in the TYPE, not
   *  only in prose, so a caller that must know the upstream subscription is fully
   *  torn down (the runtime`s `close()`) can `await` it without a cast. Assignable
   *  to { Disposer}, which the framework slot declares. */
  connect: (cell: { set: (next: T) => void }) => () => Promise<void>;
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
 *        count1: deriveCell(a.surface.count.get, (n) => n + 1, 0),
 *      }
 *
 *  `initial` is B's value before A's snapshot arrives (the connect subscription
 *  is asynchronous). Once A's first frame lands it's overwritten with the mapped
 *  snapshot through the same equals/onWrite/store.set/bus.publish path.
 *
 *  Teardown: `connect` owns its own FIBER and RETURNS a disposer, so the
 *  {@link SurfaceRuntime}'s `close()` interrupts the upstream subscription when the
 *  served surface is torn down — the derivation lives exactly as long as the
 *  runtime that owns it, not unconditionally for the process. The two teardown
 *  paths differ in their COMPLETION guarantee: `connect`'s returned disposer awaits
 *  the interruption, so it resolves only once the upstream subscription has fully
 *  torn down (the #1719 abort-then-observe contract the runtime's `close()` relies
 *  on). The standalone `dispose` — for a caller that owns its OWN teardown point (a
 *  test, a scoped adapter serving no runtime) — interrupts and returns immediately,
 *  NOT awaiting; use it for fire-and-forget cancellation, the returned disposer when
 *  you must know teardown finished. Interruption is idempotent, so the two never
 *  conflict.
 *
 *  Error policy: a non-interruption upstream failure is routed to `opts.onError` and
 *  the subscription ends; the cell keeps its last value. Left to propagate it would
 *  become an unobserved fiber failure and the derived cell would silently stop
 *  tracking. `onError` defaults to a stderr log so a failure is never invisible —
 *  pass `() => {}` to opt into silent-stop deliberately, or supply a handler that
 *  re-arms the subscription if you need retry/backoff. (An INTERRUPTION —
 *  `dispose()` / shutdown — is end-of-life, never an error: `runStreamScoped`'s rule,
 *  applied here through `Effect.runFork` + `Fiber.interrupt`.) */
export function deriveCell<F, T>(
  upstream: UpstreamSource<undefined, F>,
  map: (frame: F) => T,
  initial: T,
  opts?: { onError?: (err: unknown) => void },
): DerivedCellDeps<T> & { dispose: () => void } {
  const store = inMemoryCell<T>(initial);
  const onError =
    opts?.onError ??
    ((err: unknown) => {
      console.error("deriveCell: upstream subscription failed", err);
    });
  // Assigned by `connect`; `dispose()` before a connect is a no-op (nothing has
  // subscribed yet), exactly as aborting an unused controller was.
  let fiber: Fiber.Fiber<void, never> | undefined;
  const interrupt = () => {
    const f = fiber;
    return f === undefined ? Effect.void : Fiber.interrupt(f);
  };
  return {
    // `inMemoryCell` satisfies `CellStore<T>` directly (its `get`/`set`),
    // so hand its store straight through — no rename adapter.
    store,
    connect: (cell) => {
      // The framework calls `connect` once, after the cell ctx is wired, handing us
      // its setter — every mapped frame flows through the surface's
      // equals/onWrite/store.set/bus.publish path (we do NOT touch `store`
      // directly, or the wire side wouldn't see the publish).
      //
      // `Effect.catchCause` (not a bare `catch`) so an upstream DEFECT is reported
      // too: a projection whose upstream dies must not go quiet just because the
      // failure arrived on the defect channel. Interruption is excluded — it is how
      // the disposer below stops this fiber, and reporting our own teardown as a
      // failure is the `caught-error-must-not-collapse` defect in reverse.
      fiber = Effect.runFork(
        Effect.catchCause(
          Stream.runForEach(upstream(undefined), (frame) =>
            Effect.sync(() => cell.set(map(frame))),
          ),
          (cause) =>
            Effect.sync(() => {
              if (!Cause.hasInterruptsOnly(cause)) onError(Cause.squash(cause));
            }),
        ),
      );
      // Return an ASYNC disposer: interrupt the upstream subscription AND await its
      // teardown (the stream's finalizers), so the SurfaceRuntime's `close()` does
      // not resolve before A's subscription is fully torn down.
      return () => Effect.runPromise(interrupt());
    },
    dispose: () => {
      Effect.runFork(interrupt());
    },
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
   *  supplies (typically `surfaceClientRef(A, served)`).
   *
   *  `A` is wrapped in `NoInfer` so it's inferred *only* from `projectSurface`'s
   *  `source` argument — never from this contravariant client position. */
  deps: (client: SurfaceClientOf<NoInfer<A>>) => ImplementSurfaceDeps<B>;
}

/** Project surface A onto a new surface B whose handlers consume A via a
 *  client. Returns B's `surface` value (its group + descriptors) and an
 *  `implement` fn that, given an A-client, wires B's handlers + ctx by feeding
 *  `projection.deps(client)` to `implementSurface`.
 *
 *      const projected = projectSurface(appSurface, {
 *        spec: { cells: { … }, streams: { … }, procedures: { … } },
 *        deps: (a) => ({
 *          cells:   { mirror: deriveCell(a.surface.x.get, map, 0) },
 *          streams: { view:   deriveStream(a.surface.s.get, map) },
 *          procedures: { ns: { run: ({ input }) => Effect.promise(() => a.surface.ns.run(input)) } },
 *        }),
 *      });
 *
 *      // A is already implemented elsewhere → its served handlers:
 *      const aClient = surfaceClientRef(appSurface, servedA);
 *      const servedB = projected.implement(aClient);
 *
 *  One subtlety on the public types: the *fully-typed* A-client
 *  (`SurfaceClientOf<A>`) is materialized exactly once — for the `deps`
 *  callback, where it earns its keep (autocomplete + checked frame types inside
 *  the derive helpers). `implement`'s `client` parameter is typed loosely
 *  (`SurfaceClientLike` — the structural `{ surface: … }` shape every client
 *  has) rather than re-spelling `SurfaceClientOf<A>`: re-materializing the
 *  client mapped type a second time in the same call check overflows TS's union
 *  budget for a realistically-sized source surface. Callers always pass the
 *  result of `surfaceClientRef(source, served)` (already `SurfaceClientOf<A>`,
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
  // `B` is a bare `SurfaceSpec` (policy-permissive default), so cast to the
  // policy-erased `never` form `defineSurface` mints from; the `Surface<B>` return is
  // restored below. A projection target is server-side (no client policy) regardless.
  const surface = defineSurface(
    projection.spec as unknown as SurfaceSpec<never>,
  ) as unknown as Surface<B>;
  // Inside the body, view `deps` through its loose client shape so the heavy
  // `SurfaceClientOf<A>` mapped type is never re-materialized here (it's already
  // paid for once at `deps`' public annotation). Runtime is identical — `deps` only
  // reads `client.surface.*`, which `SurfaceClientLike` covers.
  const deps = projection.deps as unknown as (
    client: SurfaceClientLike,
  ) => ImplementSurfaceDeps<B>;
  return {
    surface,
    implement: (client) => implementSurface(surface, deps(client)),
  };
}

// Re-exported so a projection's spec literal can be annotated without a second
// import line; they are the spec shapes `projection.spec` is written against.
export type { CellSpec, EventSpec, ProcedureSpec, StreamSpec };
