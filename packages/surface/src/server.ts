/**
 * @kolu/surface/server — server-side bindings for the typed reactive surface.
 *
 * Headline API: `implementSurface(surface, deps)` walks a `Surface` (from
 * `defineSurface`) and returns a supervised `SurfaceRuntime`
 * `{ group, handlers, ctx, done, close }` — every cell/collection/stream/event/
 * procedure wired in one declarative call.
 *
 * `handlers` is a PLAIN RECORD keyed by the member's FULL wire tag
 * (`surface/<member>/<verb>`, or `surface/<key>/<member>/<verb>` for a composed
 * sibling). Each entry is a function of the DECODED payload returning:
 *
 *   - an `Effect` for a unary member (`set`/`patch`/`upsert`/`delete`/a procedure);
 *   - a `Stream` for a streaming member (`get`/`keys`/`deltas`).
 *
 * That is exactly the shape `RpcGroup.toLayer(handlers)` takes, so a wire server
 * is `runtime.group.toLayer(runtime.handlers)` with nothing in between, and an
 * IN-PROCESS dispatcher is `runtime.handlers[tag](payload)` — the same handler
 * value, invoked with zero serialization. The framework owns the snapshot+deltas
 * protocol on both sides; client `useCell` / `useCollection` / `useStream` consume
 * what `implementSurface` produces, and `ctx.cells.X.set(...)` etc. let domain code
 * mutate without parallel store-and-publish paths. `done` rejects on an owned
 * runtime fault and `close` releases every owned source (see
 * {@link SurfaceRuntimeHandle}).
 *
 * Persistence and pub/sub are pluggable via `CellStore<T>` and `Channel<T>`
 * interfaces. Adapters for `conf` (`confStore`) and any
 * `{publish, subscribe}`-shaped publisher (`publisherChannel`) ship with the
 * framework; consumers can supply their own.
 *
 * ── The AbortSignal seam (D10) ─────────────────────────────────────────
 *
 * Effect RPC has no `signal` anywhere: a handler's lifetime IS its fiber, and
 * cancellation IS interruption. So a member's SOURCE is Effect-native — a
 * `StreamSpec`/`EventSpec` source returns a `Stream`, and the framework's own
 * relays are `Stream`s over the pub/sub `Channel`. `Channel<T>` itself keeps its
 * AsyncIterable face (it is a framework-independent leaf with its own tests and
 * out-of-package consumers); the bridge from that face to a fiber-interruptible
 * `Stream` lives HERE, in `channelSubscription`, which registers the subscriber
 * on acquire and drops it on scope close. An AsyncIterable producer that needs an
 * `AbortSignal` (a PTY tap, a node API) bridges at ITS OWN edge through
 * {@link streamFromAbortableSource}.
 *
 * The seam's LAST residual — the cell `connect` hook, which carried
 * `{signal: AbortSignal}` + a `Disposer` because it had to reach a lint-pinned
 * `reactor.ts` — is gone too: {@link CellConnector} is now a scoped `Effect`, so
 * the runtime's owned sources are fibers, `close()` is interruption, and teardown
 * is a scope. Nothing in this file classifies an abort-caused rejection any more,
 * because an interrupted fiber cannot present as a failure.
 *
 * Low-level escape hatches: `cellHandlers` / `collectionHandlers` /
 * `streamHandlers` / `eventHandlers` build the same handler bodies for
 * a single primitive — useful when a primitive needs custom plumbing
 * that doesn't fit `implementSurface`'s declarative path.
 */

import { Cause, Effect, Layer, type Scope, Stream } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcServer } from "effect/unstable/rpc";
import {
  collectionDeltasChannel,
  collectionKeyChannel,
  collectionKeysetChannel,
} from "./channelNames";
import {
  type CellSpec,
  type CollectionDelta,
  type CollectionDeltasMsg,
  type CollectionSpec,
  collectionHasDeltas,
  composeSurfaceContracts,
  defineSurface,
  type EventSpec,
  type ProcedureInputSchema,
  type ProcedureOutputSchema,
  type ProcedureSpec,
  type ProcedureSpecError,
  READ_VERBS,
  reservedSurfaceTags,
  resolveCellVerbs,
  resolveCollectionVerbs,
  type StreamSpec,
  type Surface,
  type SurfaceSpec,
  surfaceTag,
  type WireSchemaAny,
} from "./define";

// `composeSurfaceContracts` is a browser-safe, group-only helper — it lives in
// `./define` so a browser-reached common module can value-import it without
// dragging the server bindings into the client bundle. Re-exported here so
// server-only consumers that already import from `@kolu/surface/server` keep
// working.
export { composeSurfaceContracts };

import { CLOCK_NOW_NAMESPACE, CLOCK_NOW_VERB } from "./clockNow";
import { containThrow } from "./containThrow";
import {
  type BakedIdentity,
  IDENTITY_NAMESPACE,
  IDENTITY_VERB,
  serveIdentity,
} from "./identity";
import type {
  Cell,
  Collection,
  Event,
  Stream as StreamDescriptor,
} from "./index";
import { LIVENESS_NAMESPACE, LIVENESS_VERB } from "./liveness";
// Type-only: the compute-cell carrier is the return of `derived.cell(($) => …)`,
// used purely to type the cell deps slot. `import type` is fully erased under
// this repo's `isolatedModules` + esbuild bundling, so it pulls NO engine value
// into `server.ts`'s runtime graph (the leaf rationale above stands).
import type { DerivedComputeCell, PollDerivedCell } from "./reactor";
// The derived-cell brands live in their own import-free leaf so the boot walk
// can spot a reactor `derived.cell(...)` dep — and its compute-fn variant —
// WITHOUT importing `reactor.ts` (which imports the signals engine). The walk
// bridges each sibling into the graph through plain `SiblingSource` closures
// (read + a synchronous post-equals change edge), so the engine stays reachable
// only through `reactor.ts`: the walk itself never touches a signal.
import {
  type DerivedCellBranded,
  type DerivedCollectionBranded,
  isDerivedCellDeps,
  isDerivedCollectionDeps,
  isDerivedComputeCellDeps,
  isDerivedPollCellDeps,
  type SiblingSource,
  type SiblingSourcesRuntime,
} from "./reactorBrand";

/** This server process's start time (ms epoch), captured once when the serve path
 *  module loads — which, for a daemon that imports it at boot, is the process
 *  start. The reserved `system.identity` stamps it (the uptime source), so a server
 *  never has to thread its own start time through `implementSurface`. */
const SERVER_STARTED_AT = Date.now();

// `projectSurface` and its derive helpers are server-side (they import
// `implementSurface` from here), so they live in `./project` and are imported
// from the dedicated `@kolu/surface/project` subpath — the canonical import for
// adapter authors. They are intentionally NOT re-exported here: `./project`
// imports `./server`, so re-exporting it back would form an import cycle.

// ── The handler record ─────────────────────────────────────────────────

/** What a bound member handler returns: an `Effect` for a unary member, a
 *  `Stream` for a streaming one. There is no third shape — a handler never
 *  returns a bare value or a Promise, because the wire server and the
 *  in-process dispatcher both need one uniform thing to run and to interrupt. */
export type SurfaceHandlerResult =
  // biome-ignore lint/suspicious/noExplicitAny: the record is heterogeneous by construction (one entry per member verb); per-member precision lives in `SurfaceRpcsFor<S>` in ./define, which is what the client face and the group are typed from.
  Effect.Effect<any, any> | Stream.Stream<any, any>;

/** One bound member handler: a function of the member's DECODED payload. */
// biome-ignore lint/suspicious/noExplicitAny: see SurfaceHandlerResult — the payload type is per-tag and lives in `SurfaceRpcsFor<S>`.
export type SurfaceHandler = (payload: any) => SurfaceHandlerResult;

/** Every member of a served surface, keyed by its FULL wire tag
 *  (`surface/<member>/<verb>`). This — not a router — is what
 *  {@link implementSurface} produces:
 *
 *    - a WIRE server is `runtime.group.toLayer(runtime.handlers)`;
 *    - an IN-PROCESS dispatcher is `runtime.handlers[tag](payload)`, with zero
 *      serialization and the identical handler value.
 *
 *  The record is built with a NULL PROTOTYPE: member names are arbitrary strings,
 *  so a member legitimately named `toString` / `constructor` must not collide with
 *  an inherited `Object.prototype` property (which would make the duplicate-tag
 *  guard fire falsely and make a lookup return a function nobody bound). */
export type SurfaceHandlers = Record<string, SurfaceHandler>;

/** A fresh, null-prototype handler record. Exported for the one other builder of
 *  a handler record — `@kolu/surface/expose`'s `restrictHandlers` — so the
 *  null-prototype reason above has one statement and one implementation. */
export function emptyHandlers(): SurfaceHandlers {
  return Object.create(null) as SurfaceHandlers;
}

/** PROVE the bound handler set is exactly the group's tag set. `defineSurface`
 *  mints the tags and this file binds them; the two walks are separate code, so
 *  the only honest guarantee is an assertion — a member the group advertises but
 *  nobody bound would 404 at the far end, and a handler bound at a tag the group
 *  does not carry is dead code that silently never runs. Both are boot crashes.
 *  This is the runtime half of D1's route-set identity (the type-level half is
 *  `SurfaceTags<S>`). Exported because every consumer that REBUILDS a handler
 *  record owes the same proof — `@kolu/surface/expose`'s `restrictHandlers`
 *  asks it of the record it is handed, before it filters anything. */
export function assertHandlersMatchGroup(
  group: RpcGroup.RpcGroup<Rpc.Any>,
  handlers: SurfaceHandlers,
  label: string,
): void {
  const bound = Object.keys(handlers);
  const missing = Array.from(group.requests.keys()).filter(
    (tag) => !(tag in handlers),
  );
  const extra = bound.filter((tag) => !group.requests.has(tag));
  if (missing.length === 0 && extra.length === 0) return;
  throw new Error(
    `${label}: the bound handler set does not match the surface's wire tags — ` +
      `${missing.length} unbound tag(s) [${missing.join(", ")}], ` +
      `${extra.length} handler(s) at unknown tag(s) [${extra.join(", ")}].`,
  );
}

/**
 * The `RpcServer` half of EVERY surface serve site — the group's bound
 * handlers, wired with the ONE defect policy a multiplexed surface requires.
 * The caller supplies only the protocol + serialization + transport layers
 * below it (a socket server, a stdio pair), so the policy cannot differ
 * between the unix-socket, websocket and stdio legs.
 *
 * ## Why `disableFatalDefects: true` — a member's fault is not the wire's
 *
 * Effect RPC's DEFAULT is that an unhandled DEFECT in any one handler is
 * *fatal to the whole client*: it answers with a connection-level `Defect`
 * message instead of that request's own `Exit`, which fails every OTHER
 * in-flight request on the same connection and tears the transport down. On a
 * surface that multiplexes a dozen cells, collections and streams over one
 * socket, that turns one member's bad minute into a total blackout.
 *
 * kolu lived that: killing the `kaval` daemon made padi's per-terminal
 * `terminalAttach` producer die (`streamFromAbortableSource` is `Stream.orDie`
 * at the producer edge, so a dead PTY tap arrives as a defect), which took
 * down kolu-server's ENTIRE padi link — every mirrored cell and collection
 * failed at once, the re-serve's mirror ended, and the browser's
 * `daemonStatus` froze at the last `connected` frame it had. The daemon was
 * down and the UI could not say so, because the channel that would have told
 * it had been collateral damage of the same death (W6/D3).
 *
 * With this on, the defect is delivered as THAT request's exit — the one
 * subscriber that asked sees it, loudly, and every sibling subscription keeps
 * flowing. Nothing is swallowed: the server still reports the cause through
 * Effect's logger exactly as before, and the failing member still fails.
 */
export function surfaceRpcServerLayer(
  group: RpcGroup.RpcGroup<Rpc.Any>,
  handlers: SurfaceHandlers,
): Layer.Layer<never, never, RpcServer.Protocol> {
  return RpcServer.layer(group, { disableFatalDefects: true }).pipe(
    // `handlers` is the erased, tag-keyed record `implementSurface` mints;
    // `toLayer`'s typed handler map is derived from the group's precise Rpc
    // union, which a runtime spec walk cannot produce (review #16). ONE cast,
    // at the one site every serve path now goes through.
    Layer.provide(group.toLayer(handlers as never)),
  );
}

// ── Persistence + pub/sub interfaces ───────────────────────────────────

/** Persistence interface for a Cell or Collection's storage backend. */
export interface CellStore<T> {
  get(): T;
  set(value: T): void;
}

/** A typed publish/subscribe channel. `publish` triggers all live
 *  iterators to emit the value; `subscribe` returns an AsyncIterable that
 *  yields each future publish until `signal` aborts; `consume` spawns a
 *  fire-and-forget loop that dispatches each value to `onEvent` and
 *  surfaces unexpected errors via `onError`, returning a cleanup fn.
 *
 *  Deliberately AsyncIterable-shaped, not `Stream`-shaped: `Channel<T>` is a
 *  framework-independent pub/sub leaf with its own tests and out-of-package
 *  implementations (a `MemoryPublisher` adapter, a re-serve mirror's fold). The
 *  ONE bridge from this face to a fiber-interruptible `Stream` is
 *  {@link channelSubscription} below, so there is a single place where a
 *  subscriber's registration and its release are decided. */
export interface Channel<T> {
  publish(value: T): void;
  subscribe(signal: AbortSignal | undefined): AsyncIterable<T>;
  /** Subscribe and dispatch each value to `handlers.onEvent` until
   *  cleanup. Owns the AbortController and suppresses post-abort errors
   *  (the publisher's iterator rejects with `signal.reason` on shutdown,
   *  which is expected end-of-life noise rather than a real failure).
   *
   *  `onError` is required to keep silent-swallow at the call site an
   *  explicit choice — pass `() => {}` for fire-and-forget where the
   *  consumer genuinely doesn't care. */
  consume(handlers: {
    onEvent: (value: T) => void;
    onError: (err: unknown) => void;
  }): () => void;
}

// ── Channel → Stream bridge ────────────────────────────────────────────

/** Expose an AsyncIterable producer's PULL side ONLY — deliberately WITHOUT a
 *  `return` method — and apply the abort-time swallow rule at the pull.
 *
 *  Two decisions, both load-bearing:
 *
 *  1. **No `return`.** `Stream.fromAsyncIterable` installs an
 *     `Effect.promise(() => iter.return!())` finalizer when the iterator has
 *     one, and AWAITS it. An async GENERATOR parked at an `await` (which every
 *     wrapper in this package is — `iterateUntilAborted`, `pollOnEvent`) defers
 *     its `.return()` until that await settles, so awaiting the return before
 *     the producer has been told to stop is a guaranteed deadlock on teardown.
 *     Cancellation is the `AbortSignal` the producer already documents; hiding
 *     `return` makes that the ONE teardown path instead of two racing ones.
 *  2. **Abort-time swallow.** A producer that rejects a pending pull with the
 *     signal's own abort reason is reporting expected end-of-life, not a fault —
 *     the exact rule {@link isAbortReason} names and `iterateUntilAborted`
 *     applies at the AsyncIterable layer. Applied here, it becomes a clean
 *     end-of-stream. Anything else propagates.
 *
 *  The kolu#2101 review asked whether this swallow manufactured the frozen panes:
 *  it did not, and it stays. The signal is the STREAM'S OWN, aborted only by its
 *  scope closing (`streamFromAbortableSource`), so the swallow is scoped to an
 *  end the consumer already caused — it can never convert a producer's death into
 *  a clean end. Classifying an unexpected end belongs where the domain knows what
 *  "unexpected" means; padi's `reattachingDeltas` now does exactly that. */
function pullOnly<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<T>> => {
        try {
          return await iterator.next();
        } catch (err) {
          if (isAbortReason(err, signal)) {
            return { value: undefined, done: true };
          }
          throw err;
        }
      },
    }),
  };
}

/** Open ONE subscription on `bus` as a scoped resource and expose it as a
 *  `Stream`. The ONE place a surface's pub/sub face meets Effect's:
 *
 *    - ACQUIRE registers the subscriber SYNCHRONOUSLY (`Channel.subscribe`
 *      registers before it returns — see `inMemoryChannel`), which is what lets
 *      {@link subscribeBeforeSnapshot} put the registration strictly before the
 *      snapshot read and so close the lost-update window;
 *    - RELEASE aborts the subscription's own signal, which is the teardown
 *      `Channel.subscribe(signal)` documents ("yields each future publish until
 *      `signal` aborts") and which every implementation — including the wrapped
 *      `publisherChannel` — already honors. Release runs on scope close, and a
 *      `Stream`'s scope closes when the consuming fiber is interrupted, so FIBER
 *      INTERRUPTION IS THE UNSUBSCRIBE: no signal is threaded through any
 *      handler or any call option, only through this one bridge.
 *
 *  A channel-level failure (a bounded channel's overflow abort) is a DEFECT, not
 *  a member failure: no surface member declares an error channel for its
 *  snapshot/delta stream, so an undeclared fault must crash loudly rather than
 *  masquerade as an end-of-stream the consumer would read as "no more data". */
function channelSubscription<T>(
  bus: Channel<T>,
): Effect.Effect<Stream.Stream<T>, never, Scope.Scope> {
  return Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => {
        const controller = new AbortController();
        return {
          controller,
          iterator: bus.subscribe(controller.signal)[Symbol.asyncIterator](),
        };
      }),
      ({ controller }) =>
        Effect.sync(() => {
          controller.abort();
        }),
    ),
    ({ controller, iterator }) =>
      Stream.orDie(
        Stream.fromAsyncIterable<T, unknown>(
          pullOnly(iterator, controller.signal),
          (err) => err,
        ),
      ),
  );
}

/** Relay every future publish on `bus`, for as long as the consuming fiber
 *  lives. The plain (no-snapshot) half of {@link channelSubscription}. */
function channelStream<T>(bus: Channel<T>): Stream.Stream<T> {
  return Stream.unwrap(channelSubscription(bus));
}

/** Bridge an ABORTSIGNAL-shaped AsyncIterable producer into a `Stream` at the
 *  PRODUCER's edge (D10). The framework itself has no `AbortSignal` left, but a
 *  producer that wraps a node API — a PTY tap, an fs watcher, a `fetch` — often
 *  does; this scopes an `AbortController` to the stream, so interrupting the
 *  consuming fiber aborts the producer exactly as `close()` used to.
 *
 *  Exported because the producers live in consuming packages (padi's PTY taps,
 *  drishti's samplers): the conversion belongs at each producer, and it must be
 *  ONE conversion, not one per site. */
export function streamFromAbortableSource<T>(
  make: (signal: AbortSignal) => AsyncIterable<T>,
): Stream.Stream<T> {
  return Stream.unwrap(
    Effect.map(
      Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (controller) =>
          Effect.sync(() => {
            controller.abort();
          }),
      ),
      (controller) =>
        Stream.orDie(
          Stream.fromAsyncIterable<T, unknown>(
            pullOnly(
              make(controller.signal)[Symbol.asyncIterator](),
              controller.signal,
            ),
            (err) => err,
          ),
        ),
    ),
  );
}

// ── Cell handlers ──────────────────────────────────────────────────────

export interface CellHandlerDeps<T, P = T> {
  /** Persistence backend. The framework reads on `get` first-yield and
   *  writes on every mutation. Pass `inMemoryStore(default)` for ephemeral
   *  cells (terminal-list etc.). */
  store: CellStore<T>;
  /** Publish channel used to broadcast mutation echoes to subscribers. */
  bus: Channel<T>;
  /** Pure merge for partial-update mutations. Required when the cell's
   *  `set`-equivalent procedure takes a patch shape `P` distinct from `T`
   *  (e.g. `PreferencesPatch`). When omitted, `set/patch` treat input as
   *  full-value `T`. */
  patch?: (current: T, p: P) => T;
  /** Optional equality predicate. When supplied, `set` / `patch` /
   *  `test__set` skip the store write and bus publish when the next
   *  value equals the current one. See `CellSpec.equals` in `define.ts`
   *  for the rationale. */
  equals?: (a: T, b: T) => boolean;
  /** Optional pre-mutation hook. Receives the *raw* patch / input value
   *  `P` (i.e. before `deps.patch` is applied) and the *current* stored
   *  value `T`. Fires on `set` and `patch` from the wire, *before* the
   *  `equals` dedup gate — i.e. fires even for no-op writes. Does **not**
   *  fire for `test__set` or for the server-internal
   *  `ctx.cells.<key>.set/patch`. Use for client-action audit logging
   *  and invariant checks that depend on the unresolved patch shape.
   *
   *  Compare `onWrite`: post-merge `T` payload, fires after the `equals`
   *  gate (no-ops skipped), fires on every write path including
   *  `test__set` and `ctx.cells.<key>.set`. */
  onMutate?: (patch: P, current: T) => void;
  /** Optional fire-and-forget side effect that runs synchronously on
   *  every successful write — `set`, `patch`, `test__set`, and the
   *  server-internal `ctx.cells.<key>.set`. Receives the resolved
   *  post-merge value `T`. Runs *after* the `equals` gate (no-op writes
   *  don't fire `onWrite`), just before `store.set` / `bus.publish`.
   *  Use for cross-cell invariants the cell write must atomically
   *  establish (e.g. cancelling a competing autosave timer when an
   *  external write lands on the session cell). Contrast with
   *  `onMutate`'s pre-merge `P` payload and wire-only fan-out. */
  onWrite?: (next: T) => void;
  /** Write-FORWARDING seam. When supplied, the wire `set` / `patch` /
   *  `test__set` handlers call THESE instead of the local apply-and-publish
   *  path (`equals` → `onWrite` → `store.set` → `bus.publish`). The cell then
   *  becomes a pure READ mirror: `get` still folds from `store` (which only a
   *  server-internal writer — the mirror fold via `ctx.cells.<key>.set` — ever
   *  writes), while a WIRE write crosses to an authoritative upstream and comes
   *  back through the fold. Both the local `equals` dedup and the local
   *  `bus.publish` are BYPASSED on purpose: the upstream is the authority, so a
   *  wire write whose value equals the stale local mirror must STILL forward
   *  (never dedup-dropped), and the local mirror must NOT phantom-echo the write
   *  before the upstream confirms it (a rejected upstream write would otherwise
   *  strand a value the mirror never reverts). The `@kolu/surface-remote`
   *  re-serve is the consumer. */
  forward?: CellForward<T, P>;
  /** Mirror-never-fabricate gate (forward mirrors only). When present, `get`
   *  withholds the opening snapshot until this returns `true` — i.e. until the
   *  authority's first real frame has folded into `store`. Before that, the
   *  seeded default is a fabrication asserted by NOBODY (the mirror needed
   *  something to show), byte-indistinguishable from a value the authority
   *  actually sent — the exact frame that makes a reconnect fire duplicate
   *  notifications. Withholding it makes the reader's `T | undefined` ("no frame
   *  yet") true end-to-end: the mirror relays truth or stays silent; the declared
   *  default belongs to the ONE writer. Omitted (the authoring, non-mirror case)
   *  means "always serve the snapshot" — that endpoint IS the authority, so its
   *  default is legitimate. */
  hasSnapshot?: () => boolean;
}

/** The write-forwarding handlers a re-serving mirror plugs into
 *  {@link CellHandlerDeps.forward} — one per wire mutation verb. Each forward is an
 *  `Effect` the handler's own effect runs, so the wire caller's `set` completes
 *  only once the upstream write did, and a FAILURE reaches the wire client
 *  (fail-fast: a forward with no live upstream link fails loud, never a silent
 *  local no-op). An upstream failure is UNDECLARED, so it crosses as a DEFECT —
 *  the crash-loudly channel, exactly as an undeclared throw did.
 *
 *  An `Effect` and not `void | Promise<void>`, and the difference is not cosmetic:
 *  a mirror builds these out of a client-face member, which is an `Effect`, and an
 *  `Effect` is not thenable — so the old `await run()` shape accepted one, awaited
 *  nothing, and made the forward a SILENT NO-OP. The type now rejects at the
 *  boundary what used to compile and do nothing. */
export interface CellForward<T, P = T> {
  set: (input: T) => Effect.Effect<unknown, unknown>;
  patch: (input: P) => Effect.Effect<unknown, unknown>;
  test__set: (input: T) => Effect.Effect<unknown, unknown>;
}

export interface CellHandlers<T, P = T> {
  /** Snapshot+deltas get handler. Bound at `<tagPrefix><key>/get`. */
  get: () => Stream.Stream<T>;
  /** Full-value set handler. */
  set: (input: T) => Effect.Effect<void>;
  /** Patch handler — applies `deps.patch(current, input)` and persists (or, when
   *  `deps.forward` is set, forwards the raw patch upstream). */
  patch: (input: P) => Effect.Effect<void>;
  /** Test reset handler. Same as `set` but used by e2e fixtures. */
  test__set: (input: T) => Effect.Effect<void>;
}

/** Run a mirror's write FORWARD as an `Effect`. The handler's effect completes
 *  only once the upstream write did, so the wire caller's `set` returns after the
 *  authority accepted it. `orDie` because an upstream failure is UNDECLARED here —
 *  the fail-fast contract, and the same disposition the old rejection-as-defect
 *  shape had. `suspend` so building the handler never starts a write. */
function forwardWrite(
  run: () => Effect.Effect<unknown, unknown>,
): Effect.Effect<void> {
  return Effect.asVoid(Effect.orDie(Effect.suspend(run)));
}

/** Build the server-side handler suite for a Cell. Returns raw handler
 *  functions ready to bind at the cell's tags.
 *
 *  Snapshot+deltas invariant on `get`: emits `store.get()` first, then
 *  every value pushed to `bus`. A reconnect re-invokes `get`, so the first
 *  frame must be a fresh snapshot — the framework guarantees this here. */
export function cellHandlers<Name extends string, T, P = T>(
  _cell: Cell<Name, T>,
  deps: CellHandlerDeps<T, P>,
): CellHandlers<T, P> {
  function applyAndPublish(next: T): void {
    // Dedup gate: skip the store write and bus publish when the next
    // value compares equal to the current one. Opt-in per cell via
    // `CellSpec.equals` / `CellHandlerDeps.equals`. Default is "always
    // publish" — see `CellSpec.equals` for the rationale.
    if (deps.equals?.(deps.store.get(), next)) return;
    // `onWrite` is a FIRE-AND-FORGET side effect, so a throw from it must not
    // abort the write it is a side effect of (juspay/kolu#2101 G6). Unbracketed it
    // did exactly that: the store write and the publish below never ran — a
    // half-applied write — and the throw unwound into the writer, which is very
    // often a reactor rebuild inside the batch drain, costing every OTHER member
    // its notifications for that frame. Contained and loud; the write completes.
    const hook = deps.onWrite;
    if (hook) containThrow("a cell onWrite hook", () => hook(next));
    deps.store.set(next);
    deps.bus.publish(next);
  }

  // Write-forwarding mirror: each wire mutation crosses to the authoritative
  // upstream and returns through the fold, so the local apply-and-publish path
  // (equals → onWrite → store.set → bus.publish) AND `onMutate` are skipped
  // entirely — the mirror never mutates or phantom-publishes on a wire write.
  const forward = deps.forward;
  if (forward) {
    return {
      // Subscribe BEFORE the snapshot decision: the authority's first fold is
      // then either already past (`hasSnapshot()` true → replay the folded value
      // as the snapshot for a late subscriber) or still future (captured by the
      // subscription, delivered as the first frame) — never missed, never
      // double-served. Mirror-never-fabricate: withhold the seeded default until
      // the fold has primed the store (`hasSnapshot()` false → an EMPTY snapshot,
      // the same zero-or-more-frames thunk the collection `get` uses).
      get: () =>
        subscribeBeforeSnapshot(deps.bus, () =>
          (deps.hasSnapshot?.() ?? true) ? [deps.store.get()] : [],
        ),
      set: (input) => forwardWrite(() => forward.set(input)),
      patch: (input) => forwardWrite(() => forward.patch(input)),
      test__set: (input) => forwardWrite(() => forward.test__set(input)),
    };
  }

  return {
    // The AUTHORING cell serves its own store as the snapshot and then relays the
    // bus — subscribe-before-snapshot, exactly like the mirror arm above and the
    // two collection reads. A plain `concat(snapshot, bus)` would acquire the bus
    // subscription only AFTER the snapshot chunk had been produced AND forwarded
    // downstream (across a socket, for a wire consumer), so every `set` landing in
    // that window published to nobody and was LOST FOREVER — the store moved on and
    // no later frame re-states it. That is not a theoretical gap: it is how a
    // reconnecting kolu-server mirror froze on padi's baked `newTerminalPolicy`
    // default (the push lands in the window; the cell never moves again).
    get: () => subscribeBeforeSnapshot(deps.bus, () => [deps.store.get()]),
    set: (input) =>
      Effect.sync(() => {
        deps.onMutate?.(input as unknown as P, deps.store.get());
        applyAndPublish(input);
      }),
    patch: (input) =>
      Effect.sync(() => {
        const current = deps.store.get();
        deps.onMutate?.(input, current);
        const next = deps.patch
          ? deps.patch(current, input)
          : (input as unknown as T);
        applyAndPublish(next);
      }),
    test__set: (input) =>
      Effect.sync(() => {
        applyAndPublish(input);
      }),
  };
}

// ── Collection handlers ────────────────────────────────────────────────

export interface CollectionHandlerDeps<K, T> {
  /** Read all current entries. Snapshot is yielded as the first frame of
   *  `keys` and `get(key)`. */
  readAll: () => Map<K, T>;
  /** Read one entry — used by per-key `get` snapshot. Defaults to
   *  `readAll().get(key)`. Override when a per-key fast path exists. */
  readOne?: (key: K) => T | undefined;
  /** Persist an upsert and broadcast to subscribers of that key. */
  upsert: (key: K, value: T) => void;
  /** Persist a delete and broadcast removal to subscribers. */
  remove: (key: K) => void;
  /** Bus for per-key value updates. Subscribers watch `(channel, key)`. */
  perKeyBus: (key: K) => Channel<T>;
  /** Bus for the live key set (broadcasts `K[]` snapshots on add/remove,
   *  coalesced to one tick-final snapshot per producer tick). */
  keysBus: Channel<K[]>;
  /** Bus for the coalesced batched delta stream — one `{upserts, removes}` per
   *  producer tick. Present only when the collection exposes the `deltas` verb
   *  (opt-in); `walkSurface` wires it and the per-tick coalescing together. */
  deltasBus?: Channel<CollectionDelta<K, T>>;
  /** A reader HOLDS `key` for the lifetime of the scope this runs in — the per-key
   *  `get` stream's own scope.
   *
   *  The wire already says when a reader OPENS a key: a per-key `get` IS a
   *  subscription, and {@link readOne} is where the server hears one arrive. What no
   *  member says is when the last reader LETS GO — and that fact is the framework's,
   *  not the app's: a handler answers with a `Stream`, the stream's scope IS the
   *  subscription, and the scope closes when the tab navigates, the socket drops, the
   *  runtime tears down, or a one-shot reader takes its frame and leaves. Fiber
   *  interruption is the unsubscribe. Without this seam a server that has to know
   *  whether anybody is still showing a key infers it from opens and ages the answer
   *  out — a bound with no honest number in it.
   *
   *  NOT A MEMBER OF THE SPEC, and that is the decision worth stating. A release verb
   *  a reader had to CALL would be a promise a closed tab cannot keep: the readers
   *  this is about are exactly the ones that vanish. The transport is what notices,
   *  so the transport is what is asked, and nothing new crosses the wire.
   *
   *  Runs BEFORE the channel subscribe and BEFORE {@link readOne}, and that pull
   *  order is load-bearing rather than incidental — a `readOne` that ACTS on the hold
   *  (reading a body only a held path is read for) must find the hold already in
   *  place. Pinned by test, not by this paragraph.
   *
   *  Two readers of one key are two calls, two holds, two releases; an interrupted
   *  reader releases only its own. The framework REPORTS lifetimes and does not
   *  count: what a hold is worth, and what happens when the count reaches zero,
   *  belongs to whoever asked for one.
   *
   *  `get` only. `keys` and `deltas` are collection-wide streams — "who holds this
   *  key" has no meaning there. Typed `never` in the error channel: a hold cannot
   *  fail, and a defect in one crashes that subscription loudly rather than serving
   *  it unheld. Absent, the `get` stream is the exact expression served today. */
  holders?: (key: K) => Effect.Effect<unknown, never, Scope.Scope>;
}

/** Run `run` at most once per producer tick — the shared latch under BOTH
 *  collection coalescers below, which agree on the time shape (one
 *  `queueMicrotask` flush after the synchronous producer loop) and on nothing
 *  else: the `deltas` one carries a last-op-wins `pending` map, the `keys` one
 *  carries the previously published set.
 *
 *  The latch is released BEFORE `run`, not after, and that ordering is
 *  load-bearing rather than incidental: a mutation fired RE-ENTRANTLY from
 *  inside the flush — a subscriber that writes back on publish — must schedule
 *  the NEXT tick instead of being swallowed as a lost update. Its cost, stated
 *  because it is the other side of the same choice: a `run` that reliably
 *  causes its own re-schedule spins forever. Nothing in this repo does, and the
 *  alternative silently drops writes — which is worse than a loop that
 *  announces itself. */
function oncePerTick(run: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      run();
    });
  };
}

/** Per-tick coalescer for a collection's batched `deltas` stream. A `pending`
 *  Map keeps last-op-wins in program order (an upsert then a remove of the same
 *  key in one tick resolves to a remove), and a single `queueMicrotask` flush
 *  runs after the synchronous upsert/remove loop the producer drives — so N
 *  keyed mutations publish ONE `{upserts, removes}` frame instead of N per-key
 *  frames. A bounded, time-based leaf (value + microtask window), lifted out of
 *  `walkSurface` so the spec walk holds no batching state. Constructed only when
 *  the collection opts into `deltas`; the `bus` is non-optional, so "deltas is
 *  on" has a single representation — this coalescer's existence. */
function createTickCoalescer<K, V>(
  bus: Channel<CollectionDelta<K, V>>,
): { upsert: (k: K, v: V) => void; remove: (k: K) => void } {
  const pending = new Map<K, { value: V } | "remove">();
  const scheduleFlush = oncePerTick(() => {
    if (pending.size === 0) return;
    const upserts: [K, V][] = [];
    const removes: K[] = [];
    for (const [k, op] of pending) {
      if (op === "remove") removes.push(k);
      else upserts.push([k, op.value]);
    }
    pending.clear();
    bus.publish({ kind: "delta", upserts, removes });
  });
  return {
    upsert: (k, v) => {
      pending.set(k, { value: v });
      scheduleFlush();
    },
    remove: (k) => {
      pending.set(k, "remove");
      scheduleFlush();
    },
  };
}

/** Per-tick coalescer for a collection's `keys` membership stream. Same time
 *  shape as {@link createTickCoalescer} (see {@link oncePerTick}), but for the
 *  FULL-SNAPSHOT stream: a producer that changes membership M times in one
 *  tick publishes ONE `K[]` frame — the live set read once at flush — instead
 *  of M frames of ~N keys each (the O(M·N) bulk-add storm; a 2000-key bulk add
 *  used to publish ~2M key elements and run the backing `readAll()` 2000
 *  times). Every `keys` frame is a complete snapshot that consumers fold
 *  idempotently (see the `keys` handler doc), so collapsing a tick's
 *  INTERMEDIATE sets into the tick-final one changes no consumer's converged
 *  state.
 *
 *  It does change WHICH intermediate states are observable, and that is worth
 *  stating rather than discovering: a key added and removed inside ONE tick is
 *  never announced, and a key removed and re-added inside one tick is never
 *  seen to leave. No consumer of a `walkSurface` collection depends on that —
 *  `mirrorCollection` reconciles against whatever set arrives, and a per-key
 *  reactive root keyed on departure exists only in `@kolu/surface-map`, which
 *  serves its own `keysBus` and is deliberately NOT coalesced (its
 *  `MapRegistry` contract requires every membership transition to be
 *  observable). Do not "unify" the two.
 *
 *  `readKeys` is a THUNK read at FLUSH time, not capture time, so the frame
 *  carries the backing store's own key order (the "server order" consumers
 *  render) exactly as the eager publish did — and reading the store rather
 *  than the framework's own `broadcastKeys` set is what keeps the published
 *  array literally the live one, the same source the connect snapshot reads.
 *
 *  The published set is compared against the last one and a REPEAT is dropped,
 *  which is what keeps the stream's promise honest under coalescing: a tick
 *  whose edges cancel out (add then remove the same new key) has a real edge
 *  behind its schedule but no membership change to report, and re-publishing
 *  an identical array would be exactly the redundant full-snapshot the
 *  `broadcastKeys` guards exist to prevent — one tick further out. The compare
 *  is free on top of an array this already built.
 *
 *  The flush runs consumer code (`readKeys` reaches the dep's `readAll`) on a
 *  DETACHED microtask, where a throw would otherwise become an unhandled
 *  rejection with no caller to blame — before coalescing it unwound into
 *  whoever called `upsert`. It is contained and named, the same rule the
 *  subscriber fan-out follows. */
function createKeysetCoalescer<K>(
  bus: Channel<K[]>,
  collection: string,
  readKeys: () => K[],
): () => void {
  let last: K[] | undefined;
  return oncePerTick(() => {
    containThrow(
      `collection "${collection}"'s keys snapshot`,
      () => {
        const next = readKeys();
        if (
          last !== undefined &&
          last.length === next.length &&
          last.every((k, i) => k === next[i])
        ) {
          return;
        }
        last = next;
        bus.publish(next);
      },
      "the collection's other streams and future writes keep flowing; this tick's membership frame is lost",
    );
  });
}

export interface CollectionHandlers<K, T> {
  keys: () => Stream.Stream<K[]>;
  get: (input: { key: K }) => Stream.Stream<T>;
  deltas?: () => Stream.Stream<CollectionDeltasMsg<K, T>>;
  upsert: (input: { key: K; value: T }) => Effect.Effect<void>;
  delete: (input: { key: K }) => Effect.Effect<void>;
  test__set: (input: Array<{ key: K; value: T }>) => Effect.Effect<void>;
}

/** Snapshot-then-live with NO lost-update window: subscribe to `bus` FIRST, THEN
 *  produce the snapshot, then forward. The subscription is ACQUIRED (registered)
 *  before the snapshot thunk runs, so any frame published in the
 *  snapshot→first-forward window is BUFFERED by the channel, not dropped — the
 *  gap a snapshot-then-subscribe stream leaves open.
 *
 *  `snapshot` is a THUNK, not a value: it MUST run AFTER the subscription is
 *  acquired. A caller passing an already-computed value would move the read back
 *  BEFORE the subscribe and reopen the window — the thunk keeps the `readAll()`
 *  on the safe side.
 *
 *  The thunk yields ZERO-OR-MORE frames: it returns an array so a caller with an
 *  unconditional snapshot passes a single-element array, and one whose snapshot is
 *  CONDITIONAL (a `get` on an absent key, a mirror with no fold yet) passes an
 *  empty array — the absent case collapses to `[]` instead of a bespoke
 *  `if`-guarded copy of this machine.
 *
 *  Cleanup: the subscription is a SCOPED resource of the returned stream, so an
 *  early interruption — anywhere, including mid-snapshot — releases it exactly
 *  once. That is what the old generator's `finally` + single-iterator dance was
 *  hand-rolling. */
function subscribeBeforeSnapshot<S, F>(
  bus: Channel<F>,
  snapshot: () => S[],
): Stream.Stream<S | F> {
  return Stream.unwrap(
    Effect.map(channelSubscription(bus), (frames) =>
      Stream.concat(Stream.fromIterable(snapshot()), frames),
    ),
  );
}

export function collectionHandlers<Name extends string, K, T>(
  _coll: Collection<Name, K, T>,
  deps: CollectionHandlerDeps<K, T>,
): CollectionHandlers<K, T> {
  const readOne = deps.readOne ?? ((k: K) => deps.readAll().get(k));

  const handlers: CollectionHandlers<K, T> = {
    // `keys` is self-healing (every frame is a full set snapshot, so a consumer
    // folds re-sends idempotently), yet a key born in the snapshot→subscribe window
    // of a QUIESCENT stream has no later frame to self-heal from until the next
    // membership change — so it still needs subscribe-before-snapshot. That, with
    // the `broadcastKeys` publish-side fix, is what lets an already-subscribed mirror
    // never miss a key born after it connected. See `subscribeBeforeSnapshot`.
    keys: () =>
      subscribeBeforeSnapshot(deps.keysBus, () => [
        Array.from(deps.readAll().keys()),
      ]),
    // A `get` for a key that DOESN'T EXIST YET is a legitimate HELD-OPEN
    // subscription, NOT an error. A collection's membership is dynamic by design
    // (the mirror's `initialKeys` reconcile already treats it so, W2.1), so a
    // consumer watching a fixed key may subscribe BEFORE the key is born: the
    // stream stays open, emits NOTHING until the key's first upsert, then
    // delivers it and every later update. Subscribe-before-snapshot (like `keys`)
    // so a value upserted in the snapshot→forward gap isn't lost; the ONLY
    // difference from `keys` is the snapshot is CONDITIONAL — a present key emits
    // its current value, an absent key emits nothing.
    //
    // Ordering note: subscribing BEFORE the snapshot can DOUBLE-DELIVER a value
    // whose upsert lands in the subscribe→snapshot window (the snapshot reads it
    // AND the buffered per-key frame forwards it) — benign and INTENTIONAL: every
    // consumer folds by replacement/reconcile, so a repeated value is idempotent.
    // Do NOT "fix" it by reading the snapshot BEFORE subscribing — that reopens the
    // lost-update gap this ordering exists to close (a frame born in the gap would
    // publish to zero subscribers and be lost). The lost-update prevention is pinned
    // by the "delivers a value published in the post-snapshot gap" test.
    //
    // This held-open-on-absent-key is a DELIBERATE, tested semantic, never an
    // accidental hang. The alternative — failing "key not found" on the first
    // snapshot — surfaced to a consuming browser as a NON-RETRIABLE application
    // error that KILLED its standing subscription: a key born AFTER the
    // subscription opened (kolu-server booting with an empty re-serve mirror; the
    // gray Kaval chip, #1681) then never reached the client until a full page
    // reload. Holding open turns "absent" into a RECOVERABLE waiting state the
    // consumer renders honestly (`undefined` until the first value). A key that
    // NEVER appears leaves the stream open emitting nothing — exactly as a `keys`
    // subscription to an empty collection holds open — so the consumer shows its
    // honest empty/absent state, not a corpse. Callers that need a bounded first
    // read interrupt their own fiber (a timeout, a race).
    //
    // Whoever declared `holders` is told the SUBSCRIPTION'S LIFETIME, and
    // `Stream.unwrap` is what makes it one: it runs the hold effect FIRST and builds
    // the inner stream from its result, so the sequence per subscription is
    // hold → channel subscribe → `readOne` snapshot. The hold is acquired in the
    // returned stream's scope — the same scope `channelSubscription`'s
    // `acquireRelease` rides — so an interruption ANYWHERE, including between the
    // hold and the subscribe or mid-snapshot inside `readOne`, releases exactly once,
    // and a subscription nobody ever runs holds nothing (the stream is lazy). Absent,
    // this is the exact expression it was: not a wrapped equivalent, no overhead,
    // no behaviour delta for any collection that never asked.
    get: (input) => {
      const live = (): Stream.Stream<T> =>
        subscribeBeforeSnapshot(deps.perKeyBus(input.key), () => {
          const v = readOne(input.key);
          return v === undefined ? [] : [v];
        });
      const holders = deps.holders;
      if (holders === undefined) return live();
      // `suspend` so the CALL to `holders` is inside the effect too, not just the
      // effect it returns: a subscription nobody runs then does nothing at all on the
      // consumer's behalf, and a hold that throws synchronously dies on this
      // subscription's own fiber rather than escaping to whoever asked for the stream.
      return Stream.unwrap(
        Effect.suspend(() => Effect.map(holders(input.key), live)),
      );
    },
    upsert: (input) =>
      Effect.sync(() => {
        deps.upsert(input.key, input.value);
      }),
    delete: (input) =>
      Effect.sync(() => {
        deps.remove(input.key);
      }),
    test__set: (input) =>
      Effect.sync(() => {
        // Replace-all: clear current keys, upsert each from the fixture.
        const before = Array.from(deps.readAll().keys());
        for (const k of before) deps.remove(k);
        for (const { key, value } of input) deps.upsert(key, value);
      }),
  };

  // The batched `deltas` stream, wired only when the collection opts in (the
  // `deltasBus` is present). Snapshot-then-deltas: a (re)subscribe replays the full
  // set, then each producer tick's coalesced `{upserts, removes}` follows. A
  // `deltas` frame is INCREMENTAL (not a full snapshot), so — UNLIKE the self-healing
  // `keys`/`get` streams — a frame missed in the snapshot→subscribe window is lost
  // until reconnect, which makes subscribe-before-snapshot load-bearing here. See
  // `subscribeBeforeSnapshot`. (A tick whose store write already landed is in BOTH
  // the snapshot and a buffered delta — idempotent: upsert is last-write-wins,
  // remove of an absent key is a no-op.)
  const deltasBus = deps.deltasBus;
  if (deltasBus) {
    handlers.deltas = () =>
      subscribeBeforeSnapshot<CollectionDeltasMsg<K, T>, CollectionDelta<K, T>>(
        deltasBus,
        () => [
          {
            kind: "snapshot",
            entries: Array.from(deps.readAll().entries()),
          },
        ],
      );
  }

  return handlers;
}

// ── Stream handlers ────────────────────────────────────────────────────

export interface StreamHandlerDeps<I, T> {
  /** Source factory. Must have snapshot-then-deltas semantics: the first
   *  emission is a fresh full snapshot for the input, subsequent emissions
   *  deliver updates. The framework's `pollOnEvent` produces this shape
   *  for poll-on-event sources.
   *
   *  Effect-native (D10): the source returns a `Stream`, so the subscription's
   *  lifetime is the consuming fiber's and cancellation is interruption. An
   *  AbortSignal-based producer converts at its own edge via
   *  {@link streamFromAbortableSource}. */
  source: (input: I) => Stream.Stream<T>;
}

export interface StreamHandlers<I, T> {
  get: (input: I) => Stream.Stream<T>;
}

export function streamHandlers<Name extends string, I, T>(
  _stream: StreamDescriptor<Name, I, T>,
  deps: StreamHandlerDeps<I, T>,
): StreamHandlers<I, T> {
  return { get: (input) => deps.source(input) };
}

// ── Event handlers ─────────────────────────────────────────────────────

export interface EventHandlerDeps<I, T> {
  /** Occurrence source. Emits zero or more occurrences; **no snapshot
   *  obligation** — the framework explicitly does not require the first
   *  emission to be a current-state snapshot, distinguishing Event from
   *  Stream. A late subscriber misses past occurrences; that's the
   *  contract. */
  source: (input: I) => Stream.Stream<T>;
}

export interface EventHandlers<I, T> {
  get: (input: I) => Stream.Stream<T>;
}

/** Wire the server side of an `Event<I,T>`. Wire shape matches `streamHandlers`
 *  (a `Stream` of `T`); the contract difference is that the source may emit zero
 *  items and need not start with a snapshot. The split from `streamHandlers`
 *  exists so authors can't accidentally wire an event source — which has no
 *  snapshot — to a stream handler that promises snapshot-then-deltas.
 *
 *  Implementation note: the source `Stream` is forwarded DIRECTLY, with no
 *  wrapper stream around it. Under the oRPC async-generator wire an extra wrap
 *  layer put "iterator complete" one async tick ahead of a single-yield-then-
 *  return source, and the yielded value was dropped — pinned by `kill.feature`
 *  "Natural PTY exit removes terminal". A `Stream` cannot lose an emitted
 *  element to its own completion, but the invariant is the CONTRACT, not the
 *  mechanism, so it is pinned implementation-independently in
 *  `streamOrdering.test.ts` and the no-wrapper shape is kept deliberately. */
export function eventHandlers<Name extends string, I, T>(
  _event: Event<Name, I, T>,
  deps: EventHandlerDeps<I, T>,
): EventHandlers<I, T> {
  return { get: (input) => deps.source(input) };
}

// ── pollOnEvent (poll-on-event-tick stream source) ─────────────────────

/** Repeatedly read on event tick, yield only when the value changed.
 *
 *  Snapshot-then-deltas in the form: yield an initial read, then on every
 *  event from `install` re-read and yield only when `isEqual(last, next)`
 *  is false. The initial read's exception propagates (first frame); a
 *  subsequent read failure invokes `onReadError` and continues — a
 *  transient error shouldn't tear down a long-lived subscription.
 *
 *  SUBSCRIBE-BEFORE-SNAPSHOT: `install` runs BEFORE the initial `read()`, not
 *  after it. A `yield` is a suspension point until the CONSUMER pulls the next
 *  item — real wall-clock, not a microtask — so installing the listener only
 *  once the consumer resumes (the old read→yield→install order) left a window
 *  where a source that began producing concurrently (e.g. a freshly-established
 *  upstream subscription delivering its first edge) could change the underlying
 *  value with NO listener attached: the initial snapshot missed it and, if the
 *  value settled back before the next real event, the change was never yielded
 *  at all. Installing first closes that gap — a `dirty` flag buffers any event
 *  that fires during the initial read (or mid-yield), and the loop coalesces it
 *  into a single re-read on its next turn, so a concurrent change is delayed at
 *  worst, never dropped.
 *
 *  `onReadError` is required so the silent-skip path is an explicit choice
 *  at every call site (a misbehaving source that perpetually fails reads
 *  would otherwise burn CPU re-installing and re-reading with zero
 *  observability). Pass `() => {}` if a use case genuinely doesn't care.
 *
 *  The equality predicate stays at the call site so reviewers see it
 *  next to the schema. */
export async function* pollOnEvent<T>(opts: {
  read: () => Promise<T>;
  isEqual: (a: T, b: T) => boolean;
  install: (onEvent: () => void) => () => void;
  signal: AbortSignal | undefined;
  onReadError: (err: unknown) => void;
}): AsyncIterable<T> {
  let dirty = false;
  let wake: (() => void) | null = null;
  // Drain the pending wake promise so the loop's `await` returns. Both the
  // upstream event callback and the abort signal need this exact sequence;
  // factoring it out keeps a future log/error addition landing in one path.
  const drainWake = (): void => {
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  };
  // Install BEFORE the initial read (subscribe-before-snapshot, above). Events
  // during the read set `dirty`, coalesced into one re-read on the first loop
  // turn — never lost. `unsub` runs from the `finally`, so an initial-read
  // throw still tears the subscription down before it propagates.
  const unsub = opts.install(() => {
    dirty = true;
    drainWake();
  });
  opts.signal?.addEventListener("abort", drainWake);
  try {
    let last: T = await opts.read();
    yield last;
    while (opts.signal?.aborted !== true) {
      if (dirty) {
        dirty = false;
        let next: T;
        try {
          next = await opts.read();
        } catch (e) {
          opts.onReadError(e);
          continue;
        }
        if (opts.isEqual(last, next)) continue;
        last = next;
        yield last;
        continue;
      }
      await new Promise<void>((r) => {
        wake = r;
      });
    }
  } finally {
    opts.signal?.removeEventListener("abort", drainWake);
    unsub();
  }
}

// ── Built-in CellStore adapters ────────────────────────────────────────

/** In-memory CellStore — for cells with no persistence (e.g. live terminal
 *  list). Initialized with `default` and held in a closure. */
export function inMemoryStore<T>(initial: T): CellStore<T> {
  let value: T = initial;
  return {
    get: () => value,
    set: (v) => {
      value = v;
    },
  };
}

/** In-memory additive Collection deps — the Map-backed `{ readAll, upsert, remove }`
 *  a collection with no persistence hands `implementSurface` (the collection twin of
 *  {@link inMemoryStore}). `readAll` returns the LIVE backing Map (the framework
 *  reads it for `keys` / `get` / the `deltas` snapshot); `upsert` / `remove` mutate
 *  it. One implementation for every re-serve mirror cache and additive fold that
 *  used to hand-roll the same three lines (SR5). */
export function inMemoryCollection<K, V>(): {
  readAll: () => Map<K, V>;
  upsert: (key: K, value: V) => void;
  remove: (key: K) => void;
} {
  const map = new Map<K, V>();
  return {
    readAll: () => map,
    upsert: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

/** Single-process broadcast pub/sub `Channel<T>` for surfaces served from a
 *  Node-only process where a name-keyed external publisher would be overkill.
 *  Each `publish` delivers to every live subscriber synchronously
 *  via per-subscriber queues; `subscribe` returns an `AsyncIterable<T>` that
 *  yields each future publish until `signal` aborts.
 *
 *  Use this when:
 *    - the surface is served from one process (no horizontal scale),
 *    - there's no need for a wire-level publisher,
 *    - you want the same `Channel<T>` shape `implementSurface` already
 *      expects — i.e. a drop-in substitute for `publisherChannel`.
 *
 *  Subscriber backpressure: each subscriber gets its own receive queue. By
 *  DEFAULT the queue is UNBOUNDED — a subscriber that falls behind the
 *  publisher grows its queue in memory (the channel never drops), so consumers
 *  must keep up or unsubscribe. Pass {@link InMemoryChannelOptions.highWaterMark}
 *  to CAP that queue with an explicit, loud breach policy
 *  ({@link InMemoryChannelOptions.overflow}) — `"abort"` (fail-fast: close the
 *  slow subscriber with a {@link ChannelOverflowError} so it re-subscribes) or
 *  `"drop-oldest"` (evict the oldest frame + signal, for a self-healing value
 *  channel). The bound is opt-in precisely so this default stays a drop-in for
 *  every existing consumer; a slow-consumer + unpaced-producer pairing that
 *  can grow without limit should set it.
 *
 *  Ordering: a single `publish` synchronously fans out to all subscribers'
 *  queues before returning, so per-subscriber ordering is preserved. Unlike
 *  `publisherChannel`, there is no cross-channel microtask delay — that
 *  delay is a wire-publisher concern (multiple channels racing on the same
 *  tick). In-process, the same JS scheduler handles ordering. */
export interface InMemoryChannel<T> extends Channel<T> {
  /** Number of currently-attached subscribers. Used by
   *  `inMemoryPublisher` to evict empty per-name channels on
   *  unsubscribe — a process monitor keyed-by-PID accumulates
   *  thousands of dead names otherwise. */
  subscriberCount(): number;
  /** Fires when the subscriber count transitions from >0 to 0. The
   *  publisher uses this to drop the name from its map; null on a
   *  fresh channel so the publisher can detect "channel had a sub at
   *  some point then went idle" vs "never had one". */
  onIdle(cb: () => void): void;
}

/** Per-subscriber receive-queue bound for {@link inMemoryChannel}. Opt-in: omit
 *  the whole options object (or `highWaterMark`) for the historical unbounded
 *  queue. Setting `highWaterMark` REQUIRES an `overflow` policy — an unbounded
 *  grow must never be silent, and a breach must never degrade quietly. */
export interface InMemoryChannelOptions {
  /** Max values buffered for a subscriber that has fallen behind the publisher.
   *  Omit for the unbounded default. */
  highWaterMark?: number;
  /** Breach policy when a subscriber's queue would exceed `highWaterMark`.
   *  Required whenever `highWaterMark` is set (construction throws otherwise):
   *    - `"abort"` — close the subscriber with a {@link ChannelOverflowError}
   *      (its `next()` rejects, the consumer's loop ends loudly). Fail-fast; the
   *      right fit for a byte / fail-through stream that must re-subscribe
   *      end-to-end rather than splice a gap.
   *    - `"drop-oldest"` — evict the oldest queued value to admit the new one
   *      and fire `onOverflow` once per drop, so a self-healing VALUE channel
   *      keeps its newest frames and its consumer re-syncs from the next
   *      snapshot (kaval's attach-overflow precedent). */
  overflow?: "abort" | "drop-oldest";
  /** Fired once per dropped value under `"drop-oldest"` — the loud signal a
   *  value channel's consumer re-syncs on. Ignored for `"abort"`. */
  onOverflow?: () => void;
}

/** Raised on a subscriber's `next()` when its receive queue overflows its
 *  {@link InMemoryChannelOptions.highWaterMark} under the `"abort"` policy — the
 *  loud, fail-fast end that makes the consumer re-subscribe rather than let the
 *  channel grow without limit. */
export class ChannelOverflowError extends Error {
  constructor(queued: number) {
    super(
      `inMemoryChannel: subscriber receive queue exceeded its high-water mark (${queued} buffered) — aborting the stream so the consumer re-subscribes instead of growing unbounded`,
    );
    this.name = "ChannelOverflowError";
  }
}

export function inMemoryChannel<T>(
  opts: InMemoryChannelOptions = {},
): InMemoryChannel<T> {
  const { highWaterMark, overflow, onOverflow } = opts;
  // The bound must carry an explicit breach policy — a silent unbounded grow is
  // exactly the defect this option exists to retire, so a mark without a policy
  // is a wiring bug, not a "default to unbounded" convenience.
  if (highWaterMark !== undefined && overflow === undefined) {
    throw new Error(
      'inMemoryChannel: highWaterMark set without an overflow policy — pass overflow: "abort" | "drop-oldest"',
    );
  }
  const subscribers = new Set<{
    push: (value: T) => void;
    close: (reason?: unknown) => void;
  }>();
  let idleCb: (() => void) | null = null;
  const removeSub = (sub: {
    push: (value: T) => void;
    close: (reason?: unknown) => void;
  }): void => {
    if (subscribers.delete(sub) && subscribers.size === 0) idleCb?.();
  };
  const subscribe = (signal: AbortSignal | undefined): AsyncIterable<T> => {
    const queue: T[] = [];
    const waiters: Array<{
      resolve: (r: IteratorResult<T>) => void;
      reject: (e: unknown) => void;
    }> = [];
    let closed = false;
    let closeReason: unknown;
    const sub = {
      push: (value: T) => {
        if (closed) return;
        const waiter = waiters.shift();
        if (waiter) {
          waiter.resolve({ value, done: false });
          return;
        }
        // No waiter parked — this subscriber is behind. Enforce the bound BEFORE
        // buffering, so the queue never grows past the mark.
        if (highWaterMark !== undefined && queue.length >= highWaterMark) {
          if (overflow === "drop-oldest") {
            queue.shift(); // evict the oldest to bound memory; keep the newest
            onOverflow?.();
            queue.push(value);
          } else {
            // "abort": close loudly so the consumer re-subscribes end-to-end, AND
            // drop the sub from the registry. A rejected pending `next()` never
            // triggers `iterator.return()` (the consumer just abandons the
            // iterator), so nothing else reaps this entry — without the remove it
            // would linger forever, taking every later publish's now-no-op
            // `sub.push()`. Mirrors the onAbort + return() paths, which removeSub too.
            sub.close(new ChannelOverflowError(queue.length));
            removeSub(sub);
          }
          return;
        }
        queue.push(value);
      },
      close: (reason?: unknown) => {
        if (closed) return;
        closed = true;
        closeReason = reason;
        while (waiters.length > 0) {
          const waiter = waiters.shift();
          if (!waiter) break;
          if (reason !== undefined) waiter.reject(reason);
          else waiter.resolve({ value: undefined, done: true });
        }
      },
    };
    subscribers.add(sub);
    // Abort handler must ALSO drop the sub from the set — otherwise
    // an aborted subscriber that never has `iterator.return()` called
    // on it (e.g. consumer just rejected its pending next() and
    // abandoned the iterator) stays in `subscribers` forever, getting
    // every subsequent publish's `sub.push()` (which is now a no-op
    // because `closed === true`, but the dead entry sits in memory).
    const onAbort = () => {
      sub.close(signal?.reason);
      signal?.removeEventListener("abort", onAbort);
      removeSub(sub);
    };
    signal?.addEventListener("abort", onAbort);
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<T>> {
            if (queue.length > 0) {
              const value = queue.shift() as T;
              return Promise.resolve({ value, done: false });
            }
            if (closed) {
              if (closeReason !== undefined) return Promise.reject(closeReason);
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve, reject) =>
              waiters.push({ resolve, reject }),
            );
          },
          return(): Promise<IteratorResult<T>> {
            signal?.removeEventListener("abort", onAbort);
            sub.close();
            removeSub(sub);
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  };
  return {
    publish: (value) => {
      // PER-SUBSCRIBER ISOLATION (juspay/kolu#2101 G6). This fan-out is
      // synchronous on the WRITER's stack — and that writer is very often a
      // reactor rebuild inside `Atom.batch`'s drain. One subscriber that throws
      // (an `onOverflow` hook, a publisher's `onIdle` eviction callback, a
      // waiter's resolve) would otherwise starve every subscriber after it in
      // this set AND unwind into the drain, which severs the graph's edges and
      // freezes every derivation in the process — silently, until a restart.
      // A throwing subscriber is therefore logged loud and SKIPPED; its siblings
      // still receive the frame and the writer's stack stays clean.
      for (const sub of subscribers)
        containThrow("an in-memory channel subscriber", () => sub.push(value));
    },
    subscribe,
    consume: buildConsume(subscribe),
    subscriberCount: () => subscribers.size,
    onIdle: (cb) => {
      idleCb = cb;
    },
  };
}

/** Name-keyed in-process pub/sub — the repo's OWN publisher (D7), and the shape
 *  `publisherChannel` adapts, so the canonical wiring works uniformly:
 *
 *  ```ts
 *  const publisher = inMemoryPublisher();
 *  implementSurfaceOnPublisher(surface, deps, (name) =>
 *    publisherChannel(publisher, name),
 *  );
 *  ```
 *
 *  Why this exists: the `channel` factory `implementSurfaceOnPublisher`
 *  takes is called *once per publish/subscribe site* — the surface owns
 *  names like
 *  `"<key>:changed"` and `"<key>:key:<k>"`. The consumer must return the
 *  *same* `Channel<T>` instance for the same name, or the framework's
 *  publishes go to one channel and the subscribers register on
 *  another. A bare `inMemoryChannel<T>()` factory (`channel: (name) =>
 *  inMemoryChannel()`) silently drops every delta because each call
 *  creates a fresh channel — the registry layer is doing the
 *  load-bearing work of binding name → instance. */
export function inMemoryPublisher(channelOpts: InMemoryChannelOptions = {}): {
  publish<T>(channel: string, payload: T): void;
  subscribe<T>(
    channel: string,
    opts: { signal?: AbortSignal },
  ): AsyncIterable<T>;
} {
  const channels = new Map<string, InMemoryChannel<unknown>>();
  // Lazy + drop semantics for publish-side names: if no subscriber has
  // ever attached to `name`, drop the payload on the floor rather than
  // create an empty channel that lives forever. The process-monitor
  // demo publishes to `processes:<pid>:value` on every poll for every
  // PID — even when no one is subscribed — and the framework keeps
  // ~600 PIDs hot. Without this guard, every PID ever seen accumulates
  // a permanent (and unused) `InMemoryChannel` instance.
  return {
    publish: <T>(name: string, payload: T) => {
      const c = channels.get(name);
      if (c !== undefined) c.publish(payload as unknown);
    },
    subscribe: <T>(name: string, opts: { signal?: AbortSignal }) => {
      let c = channels.get(name);
      if (c === undefined) {
        c = inMemoryChannel<unknown>(channelOpts);
        channels.set(name, c);
        // Self-evict on idle: when the last subscriber detaches, drop
        // the name from the map so a future publish to that name is a
        // no-op again. Without this, every short-lived subscription
        // leaves a permanent channel behind.
        c.onIdle(() => {
          if (channels.get(name) === c) channels.delete(name);
        });
      }
      return c.subscribe(opts?.signal) as AsyncIterable<T>;
    },
  };
}

/** Convenience: one-liner factory for the canonical `channel` factory
 *  {@link implementSurfaceOnPublisher} takes, backed by a private
 *  `inMemoryPublisher`. Hides the two-step
 *  `const publisher = inMemoryPublisher(); (name) =>
 *  publisherChannel(publisher, name)` cassette. This IS what the ordinary
 *  {@link implementSurface} owns internally, so pass it EXPLICITLY only to
 *  `implementSurfaceOnPublisher` — i.e. when the factory must be SHARED with
 *  another concern (the cell fold in `reServeSurface`, a cross-cell publish):
 *
 *  ```ts
 *  const channel = inMemoryChannelByName();
 *  implementSurfaceOnPublisher(surface, deps, channel);
 *  ```
 *
 *  Use `inMemoryPublisher` + `publisherChannel` directly when you
 *  need the publisher reference for something else (cross-cell
 *  publishes, instrumentation, etc.); reach for this helper for the
 *  90% case where you just want named in-process channels.
 *
 *  Pass `channelOpts` to bound EACH per-name channel's per-subscriber receive
 *  queue (see {@link InMemoryChannelOptions}) — omit for the unbounded default. */
export function inMemoryChannelByName(
  channelOpts: InMemoryChannelOptions = {},
): <T>(name: string) => Channel<T> {
  const publisher = inMemoryPublisher(channelOpts);
  return <T>(name: string) => publisherChannel<T>(publisher, name);
}

/** Snapshot-then-delta observable cell. Combines a value (read via
 *  `current()`, written via `set()`) with a `Channel<T>` interface
 *  that fires `onEvent(current)` *synchronously* on consume before
 *  forwarding subsequent `set()` calls.
 *
 *  Use case: any in-process mutable state observers want to track with
 *  the same snapshot-then-delta contract `useCell` already gives wire
 *  consumers. The demo's `HostSession.onState(cb)` is the canonical
 *  example — without this, every such observer hand-rolls a
 *  `Set<callback>` plus a synchronous initial fire, and every variant
 *  is a chance for the initial fire to be forgotten.
 *
 *  Distinct from `inMemoryStore<T>` (read/write only, no observation)
 *  and `inMemoryChannel<T>` (observation only, no current value). The
 *  conjunction is the useful primitive.
 *
 *  `publish(v)` is an alias for `set(v)` so the cell still satisfies
 *  the `Channel<T>` interface that `implementSurface` expects when one
 *  is passed as the `channel:` dep — meaning the same cell can serve
 *  in-process observers AND back a framework-managed surface cell.
 *
 *  `get()` is an alias for `current()` so the cell also satisfies the
 *  `CellStore<T>` interface — one read/write store shape across the whole
 *  cell path (no rename adapter needed when handing the cell's store into a
 *  `CellStore`-typed slot). */
export function inMemoryCell<T>(initial: T): Channel<T> &
  CellStore<T> & {
    current(): T;
  } {
  let value = initial;
  const deltas = inMemoryChannel<T>();
  return {
    current: () => value,
    get: () => value,
    set: (v) => {
      value = v;
      deltas.publish(v);
    },
    publish: (v) => {
      value = v;
      deltas.publish(v);
    },
    subscribe: (signal) => deltas.subscribe(signal),
    consume: ({ onEvent, onError }) => {
      // Snapshot first — the consumer sees the initial state before
      // any deltas could possibly arrive.
      onEvent(value);
      return deltas.consume({ onEvent, onError });
    },
  };
}

/** Build the `consume` half of a `Channel<T>` from its `subscribe` half.
 *  Owns an `AbortController` per subscriber, runs a fire-and-forget loop,
 *  suppresses post-abort errors (those are end-of-life noise, not a real
 *  failure). Identical body for every `Channel<T>` implementation — the
 *  only thing they vary in is `subscribe`. */
function buildConsume<T>(
  subscribe: (signal: AbortSignal | undefined) => AsyncIterable<T>,
): Channel<T>["consume"] {
  return ({ onEvent, onError }) => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const value of subscribe(controller.signal)) onEvent(value);
      } catch (err) {
        if (!controller.signal.aborted) onError(err);
      }
    })();
    return () => controller.abort();
  };
}

/** CellStore backed by a `conf`-style key-value store. Reads/writes one
 *  top-level key on the underlying store; the rest of the on-disk shape
 *  is owned by the consumer (so multiple cells can share one Conf with
 *  one migration ladder).
 *
 *  Pass `T` explicitly: `confStore<Preferences>(store, "preferences")`.
 *  The Conf type's overloaded `get` doesn't flow through generic
 *  inference, so the cell value type is supplied at the call site. */
export function confStore<T>(
  conf: { get(key: string): unknown; set(key: string, value: T): void },
  key: string,
): CellStore<T> {
  return {
    get: () => conf.get(key) as T,
    set: (v) => conf.set(key, v),
  };
}

// ── Built-in Channel adapter for a name-keyed publisher ────────────

/** Build a `Channel<T>` from any name-keyed `{publish, subscribe}` publisher
 *  (`inMemoryPublisher` is the one this repo ships). The publisher's untyped
 *  string-channel API is hidden behind a typed bus so each cell has one named
 *  channel and consumers can't typo.
 *
 *  Wraps the underlying iterator with `iterateUntilAborted`, which applies the
 *  abort-time swallow rule at this layer: a transport that aborts every
 *  in-flight subscription on disconnect makes the publisher iterator reject its
 *  pending pulls with `signal.reason`, and letting that propagate produces a full
 *  DOMException stack on every disconnect. Swallowing the signal-shaped error
 *  keeps the cleanup quiet. (The wrapper also used to be load-bearing for
 *  CROSS-CHANNEL ORDERING — one microtask of delay per yielded event. It no longer
 *  is: the surface serves its channels as `Stream`s, so ordering is the fiber
 *  scheduler's, and the INVARIANT — not the mechanism — is pinned by
 *  `streamOrdering.test.ts`, which restates what `kill.feature` "Natural PTY exit
 *  removes terminal" catches end-to-end.) */
export function publisherChannel<T>(
  publisher: {
    publish: (channel: string, payload: T) => Promise<void> | void;
    subscribe: (
      channel: string,
      opts: { signal?: AbortSignal },
    ) => AsyncIterable<T>;
  },
  channelName: string,
): Channel<T> {
  const subscribe = (signal: AbortSignal | undefined) =>
    iterateUntilAborted(publisher.subscribe(channelName, { signal }), signal);
  return {
    publish: (value) => {
      void publisher.publish(channelName, value);
    },
    subscribe,
    consume: buildConsume(subscribe),
  };
}

/** The abort-time swallow contract in one predicate: a rejection is
 *  end-of-life noise iff `signal` has aborted and the error *is* its abort
 *  reason (the publisher rejects pending pulls with `signal.reason` on
 *  shutdown).
 *
 *  **Module-private, and that is the whole remaining story.** It used to be an
 *  exported contract because the projection layer's `upstream()` and connect-loop
 *  swallows decided the same question; those swallows are gone — a connector is a
 *  scoped Effect and an interrupted fiber cannot present as a failure, so there is
 *  nothing left there to classify. What survives is the ONE place a raw
 *  AsyncIterable is still pulled: the publisher bus. Two callers, both in this
 *  file, both feeding {@link publisherChannel}. */
function isAbortReason(err: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && err === signal.reason;
}

/** Iterate `source` and yield each item, ending cleanly if the iterator
 *  rejects with the signal's abort reason.
 *
 *  The abort-time iterator-teardown contract at the AsyncIterable layer: a
 *  downstream pull rejected with `signal.reason` on shutdown is end-of-life
 *  noise, swallowed here (via {@link isAbortReason}) so it never bubbles as an
 *  unhandled rejection. Module-private for the same reason the predicate is —
 *  its only caller is {@link publisherChannel}. */
async function* iterateUntilAborted<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  try {
    for await (const item of source) yield item;
  } catch (err) {
    if (isAbortReason(err, signal)) return;
    throw err;
  }
}

// ── implementSurface — server-side dep wiring for a Surface ─────────────

/** The DECODED domain type a spec schema describes. Spec schemas are
 *  `WireSchema<T>` = `Schema.Codec<T, unknown, never, never>`, so the decoded
 *  side is read by INDEXING the schema (`Sc["Type"]`) rather than by `infer`ring
 *  through an invariant codec parameter — the same rule `SurfaceTypes<S>` uses in
 *  `./define`, so the dep types and the consumer-facing types can't disagree
 *  about which side of a schema a position speaks. */
type Decoded<Sc> = Sc extends { readonly Type: infer T } ? T : never;

/** Per-cell implementation deps. The surface owns the publish channel
 *  (`<key>:changed`, derived from the surface key — not configurable);
 *  the consumer supplies persistence + (when patchSchema is set) the patch
 *  merge fn. */
export type CellImplDeps<
  // biome-ignore lint/suspicious/noExplicitAny: type-plumbing constraint over a heterogeneous spec map — the same erasure `./define`'s spec types carry; the `WireSchema<T>` bound is what keeps values honest.
  S extends CellSpec<any, any, any>,
> = S extends { patchSchema: WireSchemaAny }
  ? {
      store: CellStore<Decoded<S["schema"]>>;
      /** Pure merge for partial mutations. Optional here when the cell's
       *  spec already declares `patch` (the spec wins; the framework
       *  errors at boot if neither is supplied). */
      patch?: (
        current: Decoded<S["schema"]>,
        p: Decoded<S["patchSchema"]>,
      ) => Decoded<S["schema"]>;
      /** Optional equality predicate. Same resolution rule as `patch`:
       *  spec-declared `equals` wins, deps may override. See
       *  `CellSpec.equals` for semantics. */
      equals?: (a: Decoded<S["schema"]>, b: Decoded<S["schema"]>) => boolean;
      onMutate?: (
        patch: Decoded<S["patchSchema"]>,
        current: Decoded<S["schema"]>,
      ) => void;
      /** Fire-and-forget side effect on every successful write. See
       *  `CellHandlerDeps.onWrite`. */
      onWrite?: (next: Decoded<S["schema"]>) => void;
      /** Write-forwarding seam for a re-serving mirror. See
       *  `CellHandlerDeps.forward`. */
      forward?: CellForward<Decoded<S["schema"]>, Decoded<S["patchSchema"]>>;
      /** Mirror-never-fabricate gate. See `CellHandlerDeps.hasSnapshot`. */
      hasSnapshot?: () => boolean;
      /** Optional async-source republish. The runtime fires it ONCE after
       *  the cell is wired, handing it the cell ctx setter (so a late-arriving
       *  value flows through the same equals/onWrite/store.set/bus.publish path)
       *  and running the SCOPED effect it returns as an OWNED SOURCE of the
       *  {@link SurfaceRuntime}: a failure reaches `done`, and `close()`
       *  interrupts it, which releases whatever it acquired. Owned by the
       *  runtime — apps never call it. See {@link CellConnector}. */
      connect?: CellConnector<Decoded<S["schema"]>>;
    }
  : {
      store: CellStore<Decoded<S["schema"]>>;
      equals?: (a: Decoded<S["schema"]>, b: Decoded<S["schema"]>) => boolean;
      onMutate?: (
        next: Decoded<S["schema"]>,
        current: Decoded<S["schema"]>,
      ) => void;
      onWrite?: (next: Decoded<S["schema"]>) => void;
      /** Write-forwarding seam for a re-serving mirror. See
       *  `CellHandlerDeps.forward`. */
      forward?: CellForward<Decoded<S["schema"]>, Decoded<S["schema"]>>;
      /** Mirror-never-fabricate gate. See `CellHandlerDeps.hasSnapshot`. */
      hasSnapshot?: () => boolean;
      /** Optional async-source republish. See the patch arm above. */
      connect?: CellConnector<Decoded<S["schema"]>>;
    };

/** Per-collection implementation deps. The surface owns both buses
 *  (`<key>:keys` and `<key>:key:<k>`, derived from the surface key — not
 *  configurable) and wraps `upsert`/`remove` so every persisted change
 *  publishes through the surface's channels — the consumer's upsert/remove
 *  are persistence-only. Side-effects (`scheduleAutosave`, etc.) belong
 *  inside the consumer's upsert/remove fns or in the imperative procedure
 *  that triggered the call. */
export type CollectionImplDeps<
  // biome-ignore lint/suspicious/noExplicitAny: type-plumbing constraint — see CellImplDeps.
  S extends CollectionSpec<any, any, any>,
> = {
  readAll: () => Map<Decoded<S["keySchema"]>, Decoded<S["schema"]>>;
  readOne?: (key: Decoded<S["keySchema"]>) => Decoded<S["schema"]> | undefined;
  upsert: (key: Decoded<S["keySchema"]>, value: Decoded<S["schema"]>) => void;
  remove: (key: Decoded<S["keySchema"]>) => void;
  /** The LAST-READER seam — see {@link CollectionHandlerDeps.holders}, which this
   *  threads through verbatim. A reader holds `key` for the lifetime of its per-key
   *  `get` subscription, and the scope closing IS the release. */
  holders?: (
    key: Decoded<S["keySchema"]>,
  ) => Effect.Effect<unknown, never, Scope.Scope>;
  /** OPT-IN incremental `$`-sibling read (a PURE optimization behind
   *  `readAll()` semantics). By default a compute reading `$.<coll>()`
   *  re-runs `readAll()` on every access — correct for a registry
   *  projection whose `readAll` reads a live external store, but for a
   *  collection whose `readAll` is an EXPENSIVE per-key compose (padi's
   *  `terminals`: `registryMap(composePadiTerminal)`), a derived member
   *  folding `$.<coll>()` on a firehose re-composes ALL M entries per
   *  poke = O(M²) composes/cycle (SR7's urgency regression). Set this and
   *  the framework maintains a MATERIALIZED VIEW — a per-key cache seeded
   *  from `readAll()` once at construction and updated per-key by the
   *  SAME `upsert`/`remove` writes (which already carry the value) — so
   *  the `$`-read returns the view WITHOUT recomposing (O(M²)→O(M)). Same
   *  contents and same per-key `siblingChange` granularity as `readAll()`.
   *
   *  SAFE ONLY when EVERY mutation flows through the ctx `upsert`/`remove`
   *  seam — that is the view's SINGLE write path, so it cannot diverge
   *  from truth. Opting in is the author VOUCHING for that invariant. A
   *  collection whose backing is mutated OUTSIDE `upsert`/`remove` (a live
   *  external store its `readAll` re-reads) must NOT opt in. */
  materializeSiblingView?: boolean;
};

/** Per-stream implementation deps. A stream is either:
 *
 *  - **Poll-on-event** (the common case for external mutable state — git,
 *    fs): supply `{ read, install, isEqual }` and the framework synthesizes
 *    `pollOnEvent` internally, bridged into a `Stream` at that producer edge.
 *    Snapshot-then-deltas is preserved by construction; `onReadError` for
 *    subsequent-read failures defaults to
 *    `implementSurface(...).onStreamReadError`.
 *  - **Raw `Stream`**: supply `{ source }` directly when the source isn't
 *    shaped as poll-on-event (e.g. a long-poll bidirectional stream, or a
 *    custom snapshot computation). The author owns snapshot-then-deltas; the
 *    framework serves whatever the stream emits.
 *
 *  The two shapes are a discriminated union — supplying both is a type
 *  error. */
export type StreamImplDeps<
  // biome-ignore lint/suspicious/noExplicitAny: type-plumbing constraint — see CellImplDeps.
  S extends StreamSpec<any, any>,
> =
  | {
      /** Effect-native source (D10): interruption of the consuming fiber ends
       *  the subscription, so no `AbortSignal` is threaded. Wrap an
       *  AbortSignal-based producer with {@link streamFromAbortableSource}. */
      source: (
        input: Decoded<S["inputSchema"]>,
      ) => Stream.Stream<Decoded<S["outputSchema"]>>;
    }
  | {
      /** Read current value for `input`. Emitted as the snapshot first
       *  frame; re-invoked on every event tick from `install`. */
      read: (
        input: Decoded<S["inputSchema"]>,
      ) => Promise<Decoded<S["outputSchema"]>>;
      /** Install a "something changed" listener for `input`. The
       *  callback is invoked on each potential change; the framework
       *  re-reads and emits only when `isEqual(last, next)` is false.
       *  Returns an unsubscribe fn. */
      install: (
        input: Decoded<S["inputSchema"]>,
        onEvent: () => void,
      ) => () => void;
      /** Equality predicate to suppress redundant emissions. */
      isEqual: (
        a: Decoded<S["outputSchema"]>,
        b: Decoded<S["outputSchema"]>,
      ) => boolean;
      /** Subsequent-read error handler. Defaults to
       *  `implementSurface(...).onStreamReadError` when omitted. The
       *  initial read's error always propagates (the client has no
       *  snapshot yet). */
      onReadError?: (err: unknown) => void;
    };

/** Per-event implementation deps. The surface owns the per-input event
 *  channel (default name `<key>:<key-of-input>` where the key-of-input is
 *  `String(input)` for primitives and `JSON.stringify(input)` for objects).
 *
 *    - Domain code publishes via `ctx.events.<key>.publish(input, payload)`,
 *      which writes to that channel.
 *    - The wire handler reads from the same channel.
 *
 *  `source` is optional. The default relays the channel forever; supply one when
 *  the read path needs pre-subscribe validation, single-emission-then-complete,
 *  or any other shape. The supplied source receives `helpers.bus` — the same
 *  channel `ctx.publish` writes to — so it doesn't reference a channel name
 *  string. */
export type EventImplDeps<
  // biome-ignore lint/suspicious/noExplicitAny: type-plumbing constraint — see CellImplDeps.
  S extends EventSpec<any, any>,
> = {
  source?: (
    input: Decoded<S["inputSchema"]>,
    helpers: { bus: Channel<Decoded<S["outputSchema"]>> },
  ) => Stream.Stream<Decoded<S["outputSchema"]>>;
};

// ── Procedure ctx ──────────────────────────────────────────────────────

/** Per-cell procedure ctx — get/set/patch via the surface's wrapped helpers
 *  so imperative procedures publish through the same channel as the wire
 *  handlers. Bypassing this and writing directly to the consumer's store
 *  silently skips the publish; don't. */
/** `set`'s optional `{ force }` bypasses the cell's `equals` dedup for that ONE
 *  write (a re-serve's rebind epoch republishes an equal value — #1681); omitted,
 *  the write dedups as before. Exported as the ONE source of truth for the opts
 *  shape so a cross-package consumer (`reServeSurface`'s cell fold) references it
 *  instead of hand-copying a narrowed cast that would drift silently. */
export type CellCtxSetOpts = { force?: boolean };
type CellCtxSet<T> = (v: T, opts?: CellCtxSetOpts) => void;
type CellCtxFor<S> = S extends { patchSchema: WireSchemaAny; schema: unknown }
  ? {
      get: () => Decoded<S["schema"]>;
      set: CellCtxSet<Decoded<S["schema"]>>;
      patch: (p: Decoded<S["patchSchema"]>) => void;
    }
  : S extends { schema: unknown }
    ? { get: () => Decoded<S["schema"]>; set: CellCtxSet<Decoded<S["schema"]>> }
    : never;

type CollectionCtxFor<S> = S extends {
  keySchema: unknown;
  schema: unknown;
}
  ? {
      upsert: (k: Decoded<S["keySchema"]>, v: Decoded<S["schema"]>) => void;
      remove: (k: Decoded<S["keySchema"]>) => void;
      readAll: () => Map<Decoded<S["keySchema"]>, Decoded<S["schema"]>>;
      readOne: (k: Decoded<S["keySchema"]>) => Decoded<S["schema"]> | undefined;
    }
  : never;

/** Per-event ctx — `publish(input, payload)` writes to the framework-derived
 *  channel that the event's handler subscribes to. The channel name is
 *  `<key>:<key-of-input>` where the key-of-input is `String(input)` for
 *  primitives or `JSON.stringify(input)` for objects. Domain code never
 *  sees the channel string. */
type EventCtxFor<S> = S extends { inputSchema: unknown; outputSchema: unknown }
  ? {
      publish: (
        input: Decoded<S["inputSchema"]>,
        payload: Decoded<S["outputSchema"]>,
      ) => void;
    }
  : never;

export type SurfaceCtx<S extends SurfaceSpec> = {
  cells: {
    [K in keyof S["cells"] & string]: CellCtxFor<NonNullable<S["cells"]>[K]>;
  };
  collections: {
    [K in keyof S["collections"] & string]: CollectionCtxFor<
      NonNullable<S["collections"]>[K]
    >;
  };
  events: {
    [K in keyof S["events"] & string]: EventCtxFor<NonNullable<S["events"]>[K]>;
  };
};

/** Handler for an imperative procedure. ONE arm, not four: `Rpc.make` resolves a
 *  procedure's payload / success / error POSITIONALLY (`Schema.Void` / `Schema.Void`
 *  / `Schema.Never` when undeclared), so an input-less procedure receives
 *  `input: void` and an output-less one returns `Effect<void>` — the four oRPC-era
 *  arms collapse into the schema resolution `./define` already performs.
 *
 *  The handler returns an `Effect`:
 *
 *    - its DECLARED failures are the `error` schema's decoded type (normally a
 *      union of `Schema.TaggedError`es — see `./errors` for the framework's
 *      own vocabulary). `Effect.fail(new MyError({...}))` reaches the caller with
 *      its `_tag` and data intact, narrowed by a `_tag` check;
 *    - an UNDECLARED throw stays a DEFECT (`Effect.die`) — the crash-loudly
 *      channel, unchanged;
 *    - CANCELLATION is interruption: there is no `signal` to thread, because the
 *      handler's fiber IS the call's lifetime (D10).
 *
 *  `ctx` exposes the surface's cell/collection mutation helpers so cross-descriptor
 *  publishes (e.g. `notes.create` writing to the `notes` collection) go through the
 *  same channels the wire handlers do. */
export type ProcedureImpl<
  // biome-ignore lint/suspicious/noExplicitAny: type-plumbing constraint — see CellImplDeps.
  S extends ProcedureSpec<any, any>,
  Ctx,
> = (opts: {
  input: Decoded<ProcedureInputSchema<S>>;
  ctx: Ctx;
}) => Effect.Effect<
  Decoded<ProcedureOutputSchema<S>>,
  Decoded<ProcedureSpecError<S>>
>;

// ── ImplementSurfaceDeps ────────────────────────────────────────────────

/** A cell's implementation dep: an ordinary {@link CellImplDeps} (its own store,
 *  or a graph-node `derived.cell(node)` — which is structurally a `CellImplDeps`
 *  with a `connect`), OR the compute-fn `derived.cell(($) => …)` carrier, whose
 *  `S` phantom flows the surface's sibling types back to the `$` parameter at the
 *  declaration site. The compute arm drops `connect`/`dispose`/`bindSiblings` — the
 *  runtime reads those off the branded value directly; keeping the callback
 *  `connect` in the union would de-contextualize a plain cell dep's own `connect`
 *  callback (its `cell` param would infer `any`). What survives carries what the
 *  slot needs: the brands, the `store` (its `T` validates the compute's return
 *  against the cell schema), and the `S` phantom. */
type CellDepFor<
  S extends SurfaceSpec,
  // biome-ignore lint/suspicious/noExplicitAny: type-plumbing constraint — see CellImplDeps.
  C extends CellSpec<any, any, any>,
> =
  | CellImplDeps<C>
  | Omit<
      DerivedComputeCell<S, Decoded<C["schema"]>>,
      "connect" | "dispose" | "bindSiblings"
    >
  // A POLL-source `derived.cell(source(...))`: its synchronous face is honestly
  // `T | undefined` (undefined until the seed), so it is NOT a `CellImplDeps<C>`
  // (whose `store` is `CellStore<T>`). The walk seeds the private serving store
  // from the spec default and drives it through `connect`, so the SERVED value is
  // a `T` — the `T | undefined` dep face is never served. `connect`/`dispose`/
  // `store` are dropped from the arm: the runtime reads `connect`/`dispose` off the
  // branded value directly, and a second `connect` shape OR a `CellStore<T | undefined>`
  // `store` in the union would de-contextualize a plain authored cell's own inline
  // `connect`/`store.set` param types. The poll cell's `store: CellStore<T | undefined>`
  // honesty lives on the {@link PollDerivedCell} return type (checked at the
  // `derived.cell(...)` call site), not this slot — the slot only ACCEPTS the value,
  // matched by its poll brand.
  | Omit<
      PollDerivedCell<Decoded<C["schema"]>>,
      "connect" | "dispose" | "store"
    >;

export interface ImplementSurfaceDeps<S extends SurfaceSpec> {
  /** Default subsequent-read error handler for poll-shape streams (those
   *  declared with `{ read, install, isEqual }` rather than a raw `source`).
   *  Per-stream `onReadError` overrides this. The initial read's error
   *  always propagates regardless. Required when at least one poll-shape
   *  stream omits its own `onReadError`; pass `() => {}` to opt into
   *  silent-skip explicitly. */
  onStreamReadError?: (err: unknown, info: { stream: string }) => void;

  cells?: {
    [K in keyof S["cells"] & string]: CellDepFor<S, NonNullable<S["cells"]>[K]>;
  };
  collections?: {
    // A collection's dep is either an ordinary {@link CollectionImplDeps} (its own
    // reads + write seams) OR a `derived.collection(node)` — graph-owned, so it
    // carries `readAll`/`readOne`/`connect` and no `upsert`/`remove` (the walk
    // narrows the ctx to throw and drives the publishers from the reconciler). As
    // with the compute-cell arm, drop the callback-bearing fields (`readOne`/
    // `connect`/`dispose`) from the derived arm — the runtime reads those off the
    // branded value directly, and keeping them in the union would de-contextualize
    // a plain authored dep's own `readOne`/`upsert` callback params (infer `any`).
    [K in keyof S["collections"] & string]:
      | CollectionImplDeps<NonNullable<S["collections"]>[K]>
      | Omit<DerivedCollectionBranded, "readOne" | "connect" | "dispose">;
  };
  streams?: {
    [K in keyof S["streams"] & string]: StreamImplDeps<
      NonNullable<S["streams"]>[K]
    >;
  };
  events?: {
    [K in keyof S["events"] & string]: EventImplDeps<
      NonNullable<S["events"]>[K]
    >;
  };
  procedures?: {
    [K in keyof S["procedures"] & string]: {
      [V in keyof NonNullable<S["procedures"]>[K] & string]: ProcedureImpl<
        NonNullable<S["procedures"]>[K][V],
        SurfaceCtx<S>
      >;
    };
  };
}

// ── Supervision: SurfaceRuntime / owned sources ─────────────────────────

/** A cell connector: the async-source republish hook the runtime fires once after
 *  wiring a cell. It receives the cell's private setter and returns a SCOPED
 *  effect — the connector's whole lifetime, stated as one value.
 *
 *  **Teardown is the scope, cancellation is interruption.** Whatever the
 *  connector acquires (`Effect.acquireRelease`, `Effect.addFinalizer`, a forked
 *  child) is released when the runtime's `close()` interrupts it. There is no
 *  disposer to return, no abort signal to thread, and no "was that rejection just
 *  our own teardown?" question — an interruption is end-of-life by construction,
 *  so a clean close resolves `done` and only a GENUINE failure (or a finalizer
 *  faulting) reaches it.
 *
 *  **Install synchronously; do not fork the publish.** The runtime forks the
 *  connector, and Effect runs a `sync` step on the forking stack — so a connector
 *  whose acquire is `Effect.sync(() => subscribe(publish))` is live the instant
 *  `implementSurface` returns, and every later publish rides the WRITER's stack.
 *  Routing the publish through a fiber or a queue instead would move a reactor
 *  cell's frame behind an event published in the same tick, which is the ordering
 *  `streamOrdering.test.ts` (a) and `kill.feature` pin. Fork the parts that must
 *  be concurrent (`Effect.forkScoped`), never the publish itself. */
export type CellConnector<T> = (cell: {
  set: (next: T) => void;
}) => Effect.Effect<void, unknown, Scope.Scope>;

/** One supervised, owned source of a served surface — a cell connector (the
 *  `connect` seam) running as a FIBER in its own scope.
 *
 *  The three-verb `{abort, settled, dispose}` contract this replaced collapses
 *  because a fiber already has all three: interruption cancels it, its exit is
 *  the settle, and Effect runs the scope's finalizers AS PART of that exit. So
 *  #1719's abort-then-observe is not a sequence the framework has to sequence any
 *  more — it is what `interrupt` then `await exit` means. */
interface SurfaceSource {
  /** Cancel the source — fiber interruption (idempotent). */
  interrupt(): void;
  /** Resolves once the source's fiber has exited AND its scope's finalizers have
   *  run. An interrupt-only exit is a CLEAN end (that is how `close()` stops it);
   *  any other failure — the connector's own, or a finalizer's — rejects, and is
   *  the OWNED FAULT that must reach `done`. */
  settled: Promise<void>;
}

/** A deferred connector START — a thunk the walk collects but does NOT invoke.
 *  Construction is transactional: the walk validates EVERY member (and the caller
 *  builds the final router) BEFORE any thunk runs, so a later missing dep or a
 *  router-assembly throw can never leave an earlier connector already running with
 *  nobody observing its exit. Invoking the thunk starts the connector and returns
 *  its supervised {@link SurfaceSource}. */
type SurfaceSourceStart = () => SurfaceSource;

/** Start one owned source: fork the connector into its own scope and PARK it.
 *
 *  THE ONE `Effect.run*` EDGE in this file, and the argument for it: a served
 *  surface's public face is synchronous-construction + Promise-shaped
 *  `done`/`close`, so this is where a connector's Effect becomes a supervised
 *  fiber. Everything downstream of it composes.
 *
 *  Three properties are bought by the shape rather than coded:
 *
 *  - **The connector installs SYNCHRONOUSLY.** `Effect.runFork` executes the
 *    effect on this stack until it suspends, so a connector whose acquire is a
 *    `sync` subscription is live before `start()` returns — which is what keeps a
 *    reactor cell's publish on the writer's stack (see {@link CellConnector}).
 *  - **A synchronous throw cannot escape `start()`.** A defect inside the
 *    connector lands in the fiber's exit, not on this stack, so an earlier
 *    source can never be orphaned by a later one throwing during the start pass.
 *    `Effect.suspend` puts even the BUILDER call (`connect(cell)`) inside the
 *    fiber, so a consumer whose connector throws while constructing its effect is
 *    covered by the same guarantee. (This is what the derived-collection connect's
 *    hand-rolled microtask deferral — and the same-turn-close guard it then
 *    needed — existed for.)
 *  - **`Effect.never` after the connector** keeps the scope open for the source's
 *    whole life: a connector that COMPLETES (it installed a watch and returned)
 *    must not have its finalizers run on completion. `never` is a bare suspension
 *    — no timer, no handle — so a parked source never holds the event loop open. */
function startOwnedSource(
  connect: () => Effect.Effect<void, unknown, Scope.Scope>,
): SurfaceSource {
  const fiber = Effect.runFork(
    Effect.scoped(Effect.andThen(Effect.suspend(connect), Effect.never)),
  );
  const settled = new Promise<void>((resolve, reject) => {
    fiber.addObserver((exit) => {
      if (exit._tag === "Success") return resolve();
      // Our OWN interruption (`close()`) — the clean end-of-life edge, never a
      // fault. Anything else, including a finalizer's defect, is owned and must
      // reach `done`.
      if (Cause.hasInterruptsOnly(exit.cause)) return resolve();
      reject(Cause.squash(exit.cause));
    });
  });
  return { interrupt: () => fiber.interruptUnsafe(), settled };
}

/** Wire a set of owned sources into the `done` / `close` supervision contract.
 *
 *  WHICH failures reach `done` — and which are deliberately cell-local — is
 *  audited as a table in ONE home: {@link SurfaceRuntimeHandle.done}. Read it
 *  before adding a fault path here; a serving site's fatal disposition rests on it.
 *
 *  - `done` rejects the instant ANY source faults before `close` (an owned
 *    fault reaches `done` rather than floating as an unhandled rejection), and
 *    resolves once a clean `close` has torn everything down.
 *  - `close` is idempotent and always resolves (teardown is harmless to repeat):
 *    it interrupts every source FIRST, then observes each exit INDEPENDENTLY and
 *    concurrently (so a still-parked source's failure is observed, never
 *    abandoned — #1719, and a source that refuses interruption blocks only its
 *    own release, never a sibling's). A fault seen during teardown — the
 *    connector's own or one of its finalizers' — is routed to `done`, not thrown
 *    from `close`. */
function superviseSurface(sources: SurfaceSource[]): {
  done: Promise<void>;
  close: () => Promise<void>;
} {
  let resolveDone!: () => void;
  let rejectDone!: (err: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  let closing: Promise<void> | undefined;
  // A source that faults BEFORE close reaches `done` immediately as a rejection —
  // the FIRST such fault is the root cause (`done` is settle-once by spec, so a
  // later one is a no-op). Once `close` has begun, though, it stands down: its
  // own barrier below is then the SOLE settler, so it can AGGREGATE every
  // teardown fault instead of losing all but the first to this eager race. The
  // `.catch` still runs (the rejection never floats unhandled), it just doesn't
  // settle `done` during close.
  for (const s of sources)
    s.settled.catch((err) => {
      if (!closing) rejectDone(err);
    });

  const close = (): Promise<void> => {
    closing ??= (async () => {
      // Interrupt every source FIRST, then observe each exit INDEPENDENTLY (not
      // behind a global settlement barrier): a source that refuses interruption
      // blocks only its OWN release, never a sibling's. Each source's exit
      // already INCLUDES its scope's finalizers — Effect runs them as part of
      // interruption — so "abort, then observe the settle, then dispose"
      // (#1719) is now one await rather than a sequence to orchestrate, and a
      // finalizer that faults is carried out on the same exit as the connector's
      // own failure.
      for (const s of sources) s.interrupt();
      const outcomes = await Promise.allSettled(sources.map((s) => s.settled));
      // Surface EVERY teardown fault, not just the first: with the eager catch
      // stood down (above), this barrier is the sole settler during close, so a
      // second concurrently-faulting source is never silently dropped. One fault
      // rejects with its own reason (byte-identical to a single-source fault);
      // several aggregate so each is diagnosable.
      const faults = outcomes
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason);
      if (faults.length === 0) resolveDone();
      else if (faults.length === 1) rejectDone(faults[0]);
      else
        rejectDone(
          new AggregateError(faults, "surface runtime teardown faulted"),
        );
    })();
    return closing;
  };
  return { done, close };
}

/** Compose a passive owned RUNTIME with a TERMINAL source into one supervised
 *  `{ done, close }` — the re-serve/extend seam SR5 needed, and the framework home
 *  for the terminal-source doctrine `reServeSurface` used to hand-roll (SR1 left it
 *  "deferred to PR5").
 *
 *  The two settle differently, which is the whole point:
 *
 *  - the TERMINAL source (the re-serve pump) DRIVES the runtime and ENDS ON ITS
 *    OWN (the mirrored session was destroyed), so its settlement is the RESOLVING
 *    edge of the composite `done` — a clean terminal end resolves it, a mirror
 *    fault rejects it;
 *  - the RUNTIME's own owned sources (cell connectors) resolve only on `close`, so
 *    a runtime `done` RESOLUTION is not a terminal edge (propagating it would
 *    pre-empt the pump); only its REJECTION — an owned fault — faults the composite
 *    before close.
 *
 *  `close` closes the terminal FIRST (#1719: its detached per-key pumps settle via
 *  `signal.reason`), awaits that teardown, then releases the runtime — the same
 *  close-then-observe order {@link superviseSurface} uses, applied across the
 *  runtime boundary that hides the runtime's own sources (so it can't be expressed
 *  as one more `SurfaceSource`). The terminal's `close` is the ATOMIC teardown verb
 *  (tear the terminal down AND settle), so a terminal whose teardown is itself
 *  ASYNCHRONOUS — a full re-served runtime whose `close()` aborts its pump AND
 *  releases its own sources — fits the same socket, not only a sync-abort driver.
 *  Both closes are always attempted. One failure is rethrown directly; two are
 *  surfaced together as an AggregateError. Idempotent. */
export function superviseTerminalSource(
  runtime: { done: Promise<void>; close: () => Promise<void> },
  terminal: { done: Promise<void>; close: () => Promise<void> },
): { done: Promise<void>; close: () => Promise<void> } {
  const done = new Promise<void>((resolve, reject) => {
    terminal.done.then(resolve, reject);
    runtime.done.catch(reject);
  });
  // `done` may reject from either arm; guard against an unhandled rejection when a
  // consumer observes only `close()`. (A consumer that reads `done` still sees it.)
  done.catch(() => {});
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      const faults: unknown[] = [];
      try {
        await terminal.close();
      } catch (err) {
        faults.push(err);
      }
      try {
        await runtime.close();
      } catch (err) {
        faults.push(err);
      }
      if (faults.length === 1) throw faults[0];
      if (faults.length > 1) {
        throw new AggregateError(
          faults,
          "terminal-source supervision teardown faulted",
        );
      }
    })();
    return closing;
  };
  return { done, close };
}

/** The supervision contract shared by every servable surface runtime — one
 *  axis (group + handlers + ctx + done + close) parameterized over its ctx
 *  shape, so the singular and plural runtimes below differ only in `Ctx`, never
 *  in the supervision members. `done` rejects on an owned runtime fault (a cell
 *  connector failing) and resolves on a clean `close`; `close` releases every
 *  owned source and is idempotent. */
export interface SurfaceRuntimeHandle<Ctx> {
  /** The flat `RpcGroup` this runtime serves — every member's `Rpc`, keyed by
   *  the same tags {@link SurfaceRuntimeHandle.handlers} is keyed by. Hand the
   *  pair to `group.toLayer(handlers)` for a wire server. */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Every bound member handler, keyed by FULL wire tag. See
   *  {@link SurfaceHandlers}. */
  readonly handlers: SurfaceHandlers;
  /** The typed cells/collections/events mutation ctx (domain writes). */
  readonly ctx: Ctx;
  /** Rejects on an owned runtime fault; resolves on a clean {@link close}.
   *
   *  **A rejection means STRUCTURAL WIRING DEATH — a serving site MUST treat it as
   *  fatal** (log the full error, then exit through its shutdown path so a
   *  supervisor respawns it). That is not a policy choice a consumer gets to soften:
   *  the audit below is what makes it safe, because every fallible *periodic* thing
   *  was moved OFF this channel. A "log and keep serving" observer produces exactly
   *  the zombie the #2101 deploy-#2 incident diagnosed — process alive, gate held,
   *  socket answering, `done` already settled so every FUTURE fault is unobservable.
   *
   *  **The audit — every path that can settle `done`** (juspay/kolu#2101 G1; the
   *  single home for this table, referenced from {@link superviseSurface}). Owned
   *  sources are exactly the derived members' connectors (a derived cell's, a
   *  derived collection's); nothing else is supervised here.
   *
   *  | Path | Settles `done`? | Class |
   *  | --- | --- | --- |
   *  | Builder wiring throws — one-shot guard (`connect()` twice / after dispose), a builder body throw | REJECTS | runtime-fatal (structural) |
   *  | A push source's `install` (the subscription) throws | REJECTS | runtime-fatal (structural) |
   *  | A poll source's cadence `install(tick)` throws | REJECTS | runtime-fatal (structural) |
   *  | A scope FINALIZER throws during `close()` | REJECTS (aggregated) | runtime-fatal (structural teardown) |
   *  | Poll **T+0 seed** read or publish fails | no — since #2101 | cell-local: logged, cadence held, retried next tick |
   *  | Poll **later tick** read or publish fails | no | cell-local: log-skip-continue, holds last value |
   *  | `scan` step throws | no | cell-local: stop-hold, `stopped` latches |
   *  | `computed` / compute-cell recompute throws (later read) | no | cell-local: logged, holds last, heals |
   *  | Our own interruption (`close()`) | resolves | clean end-of-life |
   *  | Clean `close()` with no teardown fault | resolves | clean end-of-life |
   *
   *  Not on this channel at all: an EAGER SEED throw (a non-poll derived cell's
   *  `store.get()` pull, a compute cell's bind/seed) — it throws synchronously out of
   *  `implementSurface` before any source starts, so it is a boot crash the caller
   *  sees on its own stack, never a `done` rejection. */
  readonly done: Promise<void>;
  /** Release every owned source — interrupt each cell connector, which runs its
   *  scope's finalizers. Idempotent. */
  close(): Promise<void>;
}

/** A directly servable, supervised surface runtime — the return of
 *  {@link implementSurface} / {@link implementSurfaceOnPublisher}. `ctx` is the
 *  single surface's mutation ctx. */
export interface SurfaceRuntime<S extends SurfaceSpec>
  extends SurfaceRuntimeHandle<SurfaceCtx<S>> {}

/** The plural sibling of {@link SurfaceRuntime} — the return of
 *  {@link implementSurfaces} / {@link implementSurfacesOnPublisher}. `ctx` is
 *  keyed per sibling surface; `group`/`handlers`/`done`/`close` cover the whole
 *  map. */
export interface SurfacesRuntime<S extends SurfaceMap>
  extends SurfaceRuntimeHandle<SurfacesCtx<S>> {}

/** Walk a single surface's spec and bind every cell/collection/stream/event/
 *  procedure into `handlers`, keyed by the member's FULL wire tag. The tag rule
 *  is `surfaceTag(surface.tagPrefix, member, verb)` — the SAME algebra
 *  `defineSurface` mints with, read off the surface value, so a standalone
 *  surface and a composed sibling differ only in the prefix they carry and this
 *  walk never learns which it is looking at.
 *
 *  Shared by `implementSurface` (singular) and `implementSurfaces` (plural)
 *  so the two paths can never drift on how a primitive is wired.
 *
 *  Channel naming is surface-driven and not configurable: cells use
 *  `"<key>:changed"`, collections use `"<key>:keys"` + `"<key>:deltas"` +
 *  `"<key>:key:" + String(k)` (see `./channelNames.ts` — the sole source of
 *  these names), events use `"<key>:" + eventChannelKey(input)`. Renaming a
 *  surface key thus renames the channel — for cells whose channels back
 *  persisted subscriptions, prefer adding a new key and migrating off the
 *  old one.
 *
 *  `channel` is supplied by the constructor, NOT by the public deps: the
 *  ordinary constructor owns an internal `inMemoryChannelByName()`, and the
 *  `*OnPublisher` constructor injects the caller's shared channel. So the walk
 *  takes the public deps PLUS the resolved channel factory. */
function walkSurface<const S extends SurfaceSpec>(
  surface: Surface<S>,
  deps: ImplementSurfaceDeps<S> & {
    channel: <T>(name: string) => Channel<T>;
  },
  identity?: BakedIdentity,
): {
  handlers: SurfaceHandlers;
  ctx: SurfaceCtx<S>;
  starts: SurfaceSourceStart[];
} {
  const spec = surface.spec;
  const tagPrefix = surface.tagPrefix;

  const cellsCtx: Record<string, unknown> = {};
  const collectionsCtx: Record<string, unknown> = {};
  const handlers = emptyHandlers();
  /** Bind one member verb at its wire tag. Throws on a duplicate: the flat tag
   *  namespace means two members can spell the same tag, and a silent overwrite
   *  would drop one side's handler while the group still advertises the route.
   *  `defineSurface`'s `claim()` makes that unrepresentable on the GROUP side;
   *  this is the same guarantee on the HANDLER side, so neither walk can drift
   *  into a last-writer-wins `Map.set`. */
  const bind = (
    member: string,
    verb: string,
    handler: SurfaceHandler,
  ): void => {
    const tag = surfaceTag(tagPrefix, member, verb);
    if (tag in handlers) {
      throw new Error(
        `implementSurface: duplicate handler for wire tag "${tag}" (member "${member}", verb "${verb}").`,
      );
    }
    handlers[tag] = handler;
  };

  // Deferred STARTS for the owned async sources this surface declares (today:
  // cell connectors). Collected here but NOT invoked — the caller starts them
  // only after the whole surface (and, for a sibling map, every sibling) validates,
  // so construction is transactional. The returned runtime supervises the started
  // sources via `done` / `close`.
  const starts: SurfaceSourceStart[] = [];

  // ── Reactor sibling-read (`$`) machinery ───────────────────────────────
  // A compute-fn `derived.cell(($) => …)` reads its siblings through `$`. The
  // walk bridges each cell/collection into the graph with a plain
  // `SiblingSource`: `read()` returns the sibling's CURRENT value, and
  // `subscribe(cb)` registers a synchronous change edge fired by the sibling's
  // post-equals write. The walk never touches a signal — `reactor.ts` wraps each
  // source in a version signal when a compute cell binds, so the engine stays
  // reachable only through the reactor.
  //
  // A `siblingChange[key]` fan-out is the "post-equals mirror poke": the
  // bridge-owned store wrapper both cell write paths pass through calls it AFTER
  // the value lands (so only accepted writes fire), and the wrapped collection
  // publishers call it on every key change — a missed poke is unwritable by
  // construction, not a rider held by pinning tests.
  // NULL-prototype dictionaries: member names are arbitrary `Record<string, …>`
  // keys, so a cell legitimately named `toString` / `constructor` / `valueOf` must
  // not collide with an inherited `Object.prototype` property — that would make the
  // duplicate-key guard below fire falsely, and would leak an inherited function as
  // a "source" to the `$` Proxy (`sources[name]`). A null prototype means a lookup
  // is truthy ONLY for a genuinely registered member.
  const siblingSources: SiblingSourcesRuntime = Object.create(null);
  const siblingChange: Record<string, () => void> = Object.create(null);
  // A cell/collection registers its live read + change fan-out here. Subscribers
  // are held per key; `subscribe` returns an unsubscribe the compute cell runs on
  // dispose. `engineTracked` marks a DERIVED member (its `read` is a reactor-made
  // closure over its `computed`, held here opaquely — the walk never touches a
  // signal): the `$` face reads it directly, so a derived-reads-derived chain is a
  // pure computed graph, glitch-free. An AUTHORED member leaves it false and rides
  // the version-signal bridge fed by `siblingChange`.
  const registerSibling = (
    key: string,
    read: () => unknown,
    engineTracked = false,
  ): void => {
    // Cell and collection names are disjoint by construction — `defineSurface`
    // rejects a name declared as both (the `$` flat-namespace invariant is checked
    // at definition, where the spec lives), so no key is ever registered twice here.
    const subscribers = new Set<() => void>();
    siblingSources[key] = {
      read,
      subscribe: (cb) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      },
      engineTracked,
    } satisfies SiblingSource;
    siblingChange[key] = () => {
      for (const cb of subscribers) cb();
    };
  };
  // Compute cells cannot build their node until every sibling source exists (a
  // sibling collection is walked AFTER the cells), so their bind + eager seed is
  // deferred to one pass after both loops.
  // Compute-cell wiring, split into two independent phases so the deferred build
  // is a TWO-PASS walk: `bind` builds the (lazy) `engineComputed` node; `seed`
  // eager-pulls it into the private store. Pass A runs every `bind`, then pass B
  // runs every `seed` — so a compute cell that reads a DERIVED sibling via `$`
  // finds that sibling's node already built regardless of declaration order (the
  // engine's lazy DAG orders the pull). No upstream-before-downstream contract.
  const bindComputeCells: Array<{
    bind: (sources: SiblingSourcesRuntime) => void;
    seed: () => void;
  }> = [];

  // ── Cells ────────────────────────────────────────────────────────────
  for (const [key, rawSpec] of Object.entries(spec.cells ?? {})) {
    const cellSpec = rawSpec as CellSpec<unknown, unknown>;
    const bus = deps.channel<unknown>(`${key}:changed`);
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const cellDeps = (deps.cells as any)?.[key] as
      | {
          store: CellStore<unknown>;
          patch?: (c: unknown, p: unknown) => unknown;
          equals?: (a: unknown, b: unknown) => boolean;
          onMutate?: (p: unknown, c: unknown) => void;
          onWrite?: (next: unknown) => void;
          forward?: CellForward<unknown, unknown>;
          hasSnapshot?: () => boolean;
          // The connector's ONE source of truth — a full `CellConnector` (a
          // scoped effect), not a re-declared narrower shape that a later cast
          // would have to correct.
          connect?: CellConnector<unknown>;
        }
      | undefined;
    if (!cellDeps) {
      throw new Error(`implementSurface: missing deps for cell "${key}"`);
    }
    // Boot narrowing for a reactor `derived.cell(...)`: the graph is the
    // member's ONE writer, so a derived cell is wire-read-only BY CONSTRUCTION.
    // Crash loudly if it declares any write verb (`set`/`patch`/`test__set`) —
    // a second writer is a defect, not a knob, and this makes it a boot crash
    // rather than a silent double-writer. The derived value still reaches the
    // wire through the `connect` seam below; `get` is its only exposed verb.
    if (isDerivedCellDeps(cellDeps)) {
      const writeVerbs = resolveCellVerbs(cellSpec).filter(
        (v) => !READ_VERBS.includes(v),
      );
      if (writeVerbs.length > 0) {
        throw new Error(
          `implementSurface: derived cell "${key}" is wire-read-only (its derivation is the one writer) but declares write verb(s) [${writeVerbs.join(", ")}] — declare verbs: ["get"] (test__set included).`,
        );
      }
    }
    // Mirror-never-fabricate, fail-fast: a write-forwarding cell (a re-serve
    // mirror — the ONLY producer of `forward`) MUST carry the `hasSnapshot` gate,
    // or `cellHandlers.get` would fall back to `?? true` and serve the seeded
    // default as if the authority had sent it — the exact fabrication the gate
    // exists to forbid. Crash at boot rather than let the impossible state ship.
    if (cellDeps.forward && !cellDeps.hasSnapshot) {
      throw new Error(
        `implementSurface: forwarding cell "${key}" must declare a hasSnapshot gate (mirror-never-fabricate) — a mirror serves no frame until the authority's first fold. See CellHandlerDeps.hasSnapshot.`,
      );
    }
    // Spec-declared `patch` wins; deps may override (rare). Cells with
    // `patchSchema` need one or the other — error loudly if both are
    // missing rather than silently accepting full-replacement semantics.
    const patchFn = cellSpec.patch ?? cellDeps.patch;
    if (cellSpec.patchSchema && !patchFn) {
      throw new Error(
        `implementSurface: cell "${key}" has patchSchema but no patch fn (declare on spec or pass via deps)`,
      );
    }
    // Spec-declared `equals` wins; deps may override (rare). Same
    // resolution rule as `patch`.
    const equalsFn = cellSpec.equals ?? cellDeps.equals;
    const onWriteFn = cellDeps.onWrite;
    // A derived cell's PUBLIC `store` is a read-only, stateless facade (its `get`
    // pulls the graph node's current level, its `set` throws — the graph is the one
    // writer). The dep carries NO writable store, so nothing a holder can reflect off
    // it can poison the wire snapshot. `implementSurface` builds and OWNS the private
    // serving store here — seeded from the facade's `get` (the node's current level) —
    // and drives it exclusively through the `connect` seam below, so `cellHandlers.get`
    // and `ctxApply` read/write this closure-private store, never anything on the dep.
    // A non-derived cell uses its own `store` directly.
    //
    // A COMPUTE-fn derived cell's node does not exist until `bindSiblings` (a
    // sibling collection is walked AFTER the cells), so its facade `get` throws
    // before bind. Seed the private store with the spec DEFAULT as a placeholder
    // and re-seed it (eager pull) in the deferred bind pass below, before any
    // handler can read it — no wire reader exists until the runtime starts.
    const isComputeCell = isDerivedComputeCellDeps(cellDeps);
    // A poll-source derived cell has no synchronous seed (its T+0 read is async),
    // so — like a compute cell before its bind — seed the private store from the
    // spec DEFAULT; the async `connect` publishes the first read over it. This is
    // the value the hand-rolled sampler served pre-first-sample, so the conversion
    // stays behavior-neutral (and `connect`'s first-read failure still propagates).
    const isPollCell = isDerivedPollCellDeps(cellDeps);
    const rawStore: CellStore<unknown> = isDerivedCellDeps(cellDeps)
      ? inMemoryStore(
          isComputeCell || isPollCell ? cellSpec.default : cellDeps.store.get(),
        )
      : cellDeps.store;
    // The BRIDGE-OWNED store wrapper both cell write paths land in: `set` writes
    // the value, then fires this cell's post-equals change edge (the "mirror
    // poke"). `applyAndPublish` and `ctxApply` both check `equals` BEFORE calling
    // `set`, so the poke is POST-equals by construction — a suppressed write never
    // pokes, and a third write path would poke for free. Reads pass straight
    // through. `siblingChange[key]` is populated by `registerSibling` just below.
    const store: CellStore<unknown> = {
      get: () => rawStore.get(),
      set: (next) => {
        rawStore.set(next);
        siblingChange[key]?.();
      },
    };
    // Expose this cell to `$`. A DERIVED cell (either `derived.cell` form) is read
    // as its graph node's computed — an ENGINE-TRACKED read (a reactor-made closure,
    // `siblingRead`, held opaquely here — the walk touches no signal), so a
    // derived-reads-derived chain is a pure computed graph, glitch-free by lazy
    // pull, per the bridge law. An AUTHORED cell is read as its post-equals mirror
    // (the store wrapper above is its change edge, bridged via a version signal).
    //
    // EXCEPTION — a POLL-source derived cell: its graph level is `undefined` until
    // the async seed lands, so an engine-tracked `$`-read would hand a sibling
    // compute `undefined` (not the spec default) at boot — a crash / invalid
    // derivation. Register it as the private-store MIRROR instead: the store is
    // seeded with the spec default and updated post-write, so a `$`-reader gets the
    // default until the first read publishes, never `undefined`. Reading an async
    // poll as a mirror is honest — it is a sampled source, not a synchronous computed.
    if (isDerivedCellDeps(cellDeps) && !isPollCell) {
      const derivedDeps = cellDeps as unknown as DerivedCellBranded;
      registerSibling(key, () => derivedDeps.siblingRead(), true);
    } else {
      registerSibling(key, () => store.get());
    }
    // Defer a compute cell's node build (`bind`) and eager seed (`seed`) until
    // every sibling source exists, and keep them as SEPARATE phases: `bindSiblings`
    // builds the (lazy) node — evaluating nothing — while the eager pull re-seeds
    // the private store (a throw is a boot crash — mirror-never-fabricate) WITHOUT
    // firing the poke (a seed is not a change; no subscriber exists yet). The two
    // deferred loops run all binds before any seed, so every derived sibling's node
    // already exists by the time any seed pulls it — order-independent.
    if (isComputeCell) {
      const computeDeps = cellDeps as unknown as DerivedComputeCell<
        SurfaceSpec,
        unknown
      >;
      bindComputeCells.push({
        bind: (sources) => computeDeps.bindSiblings(sources),
        seed: () => rawStore.set(computeDeps.store.get()),
      });
    }
    const memberHandlers = cellHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
      (surface.descriptors.cells as any)[key] as Cell<string, unknown>,
      {
        store,
        bus,
        patch: patchFn,
        equals: equalsFn,
        onMutate: cellDeps.onMutate,
        onWrite: onWriteFn,
        forward: cellDeps.forward,
        hasSnapshot: cellDeps.hasSnapshot,
      },
    );

    // Server-internal `ctx.cells.<key>.set/patch` — same dedup/onWrite
    // gates as the wire-facing handlers so an internal write goes
    // through the same atomicity contract (e.g. an in-app
    // `setSavedSession` cancels the autosave timer via `onWrite`, and
    // a no-op republish is suppressed by `equals`).
    //
    // Intentionally does NOT call `onMutate`: that hook is the
    // wire-only client-action audit point, scoped to `set`/`patch`
    // verbs. Server-internal callers are domain code and don't have
    // a meaningful "patch payload before merge" to log — they already
    // know what they're writing.
    //
    // Mirrors the equals→onWrite→store.set→bus.publish sequence in
    // `cellHandlers.applyAndPublish`. Kept duplicated rather than
    // extracted to a shared helper so the two paths diverge loudly
    // (TypeScript errors / test failures) if anyone adds a step to
    // only one side. (`store` — resolved above — is a derived cell's private
    // writable backing, or a non-derived cell's own store.)
    // `force` bypasses the `equals` dedup for ONE write — a re-serve's rebind epoch
    // uses it so a fresh spawn re-confirming a value EQUAL to the pre-drain one still
    // republishes, letting a downstream holder tell "rebound and confirmed" from
    // "stale" (#1681; `reServeSurface`'s cell fold). Steady-state dedup is unchanged:
    // only the explicit `force` caller opts out, per write.
    function ctxApply(next: unknown, opts?: CellCtxSetOpts): void {
      if (!opts?.force && equalsFn?.(store.get(), next)) return;
      // Contained for the same reason as `applyAndPublish`'s twin above, and this
      // is the path that MATTERS most: a derived cell's graph publish comes
      // through here, on the reactor's batch-drain stack. A throwing `onWrite`
      // here used to half-apply the write AND unwind into the drain
      // (juspay/kolu#2101 G6).
      if (onWriteFn) {
        const hook = onWriteFn;
        containThrow("a cell onWrite hook", () => hook(next));
      }
      store.set(next);
      bus.publish(next);
    }
    // The write arm (`set`/`patch`) as its own object. The `connect` seam gets it
    // PRIVATELY (below) so the graph — a derived cell's ONE writer — can push
    // through the member's write gate, WITHOUT that setter also landing on the
    // procedure-handler-visible `ctx.cells.<key>`.
    const writeArm = {
      set: ctxApply,
      ...(patchFn
        ? {
            patch: (p: unknown) => {
              ctxApply(patchFn(store.get(), p));
            },
          }
        : {}),
    };
    // A derived cell is wire-read-only AND server-internal-read-only: the graph
    // is its one writer, and it reaches the store ONLY through `connect` (the
    // private `writeArm` below). So a derived cell's `ctx.cells.<key>` exposes `get`
    // plus a THROWING `set`/`patch` — a fail-fast one-writer guard, not a live write
    // path. Keeping the setters PRESENT (throwing) rather than absent makes the ctx
    // TYPE honest: `CellCtxFor` promises `set`/`patch`, and a procedure handler that
    // calls one gets a loud "graph-owned (one writer)" error, never a second writer
    // publishing a value the graph never derived and never a bare "set is not a
    // function". Non-derived cells keep their real server-internal writers.
    const derivedWriteGuard = (): never => {
      throw new Error(
        `implementSurface: cell "${key}" is graph-owned (a derived cell) — the graph is its one writer; ctx.cells.${key}.set/patch is not a write path.`,
      );
    };
    cellsCtx[key] = isDerivedCellDeps(cellDeps)
      ? {
          get: () => store.get(),
          set: derivedWriteGuard,
          ...(patchFn ? { patch: derivedWriteGuard } : {}),
        }
      : { get: () => store.get(), ...writeArm };

    // Optional async-source republish: fire once after the cell ctx is
    // wired, handing it the PRIVATE write arm so a late-arriving value (and a
    // derived cell's graph pushes) flows through the same
    // equals/onWrite/store.set/bus.publish path — without exposing `set` on a
    // derived cell's public ctx.
    //
    // The connector is an OWNED SOURCE (not fire-and-forget): it is a SCOPED
    // effect, so its resources are released when `close()` interrupts it and its
    // exit is tracked — a genuine failure reaches the runtime's `done` (never
    // floats), while the interruption `close()` itself caused is a clean end.
    if (cellDeps.connect) {
      const connect = cellDeps.connect;
      // DEFER the start: collect a thunk rather than firing the connector here,
      // so an invalid LATER member can never leave this connector running with
      // nobody observing its exit. The caller invokes the thunk only after the
      // whole surface — and, for a sibling map, every sibling — has validated.
      starts.push(() => startOwnedSource(() => connect(writeArm)));
    }

    for (const v of resolveCellVerbs(cellSpec)) {
      // biome-ignore lint/suspicious/noExplicitAny: handler map indexed by verb string
      const h = (memberHandlers as any)[v] as SurfaceHandler | undefined;
      if (h === undefined) continue;
      bind(key, v, h);
    }
  }

  // ── Collections ──────────────────────────────────────────────────────
  for (const [key, rawSpec] of Object.entries(spec.collections ?? {})) {
    const collSpec = rawSpec as CollectionSpec<unknown, unknown>;
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const collDeps = (deps.collections as any)?.[key] as
      | {
          readAll: () => Map<unknown, unknown>;
          readOne?: (k: unknown) => unknown;
          holders?: (k: unknown) => Effect.Effect<unknown, never, Scope.Scope>;
          // Authored collections carry write seams; a graph-owned
          // `derived.collection` does not (the walk narrows the ctx to throw and
          // drives the publishers from the reconciler's `connect`), so both are
          // optional here and resolved through `depUpsert`/`depRemove` below.
          upsert?: (k: unknown, v: unknown) => void;
          remove?: (k: unknown) => void;
          materializeSiblingView?: boolean;
        }
      | undefined;
    if (!collDeps) {
      throw new Error(`implementSurface: missing deps for collection "${key}"`);
    }
    // A `derived.collection(node)` — graph-owned: its ctx `upsert`/`remove` throw,
    // and its reconciler `connect` (fired as an owned source below) drives the
    // surface's per-key publishers.
    const derivedColl = isDerivedCollectionDeps(collDeps)
      ? (collDeps as unknown as DerivedCollectionBranded)
      : undefined;
    // Boot narrowing for a `derived.collection`: the reconciler is the member's
    // ONE writer, so it is wire-read-only BY CONSTRUCTION. Crash loudly if it
    // declares any wire WRITE verb (`upsert`/`delete`/`test__set`) — a wire
    // mutation would otherwise reach `wrappedUpsert` and publish a value the graph
    // never derived (a second writer over the wire). Mirror of the derived-cell
    // narrowing above; the reconciled value still reaches the wire through
    // `keys`/`get`/`deltas`.
    if (derivedColl) {
      const writeVerbs = resolveCollectionVerbs(collSpec).filter(
        (v) => !READ_VERBS.includes(v),
      );
      if (writeVerbs.length > 0) {
        throw new Error(
          `implementSurface: derived collection "${key}" is wire-read-only (its reconciler is the one writer) but declares write verb(s) [${writeVerbs.join(", ")}] — declare only read verbs (keys/get/deltas).`,
        );
      }
    }
    // The backing write seams the wrapped publishers call. For an authored
    // collection they are the dep's own persistence writes; for a derived
    // collection they are no-ops (the registry IS the reconciler's `current` map).
    // The derived arm is the ONLY one that legitimately has no write seam, so an
    // authored collection that omitted `upsert`/`remove` must fail LOUD with a named
    // error here — not via a `!` that defers to a cryptic "undefined is not a
    // function" at the first publish (the boot-narrowing fail-fast law).
    let depUpsert: (k: unknown, v: unknown) => void;
    let depRemove: (k: unknown) => void;
    if (derivedColl) {
      depUpsert = () => {};
      depRemove = () => {};
    } else {
      const { upsert, remove } = collDeps;
      if (!upsert || !remove) {
        throw new Error(
          `implementSurface: authored collection "${key}" must provide upsert + remove write seams (its publishers persist through them) — only a graph-owned derived.collection may omit them.`,
        );
      }
      depUpsert = upsert;
      depRemove = remove;
    }
    const keysBus = deps.channel<unknown[]>(collectionKeysetChannel(key));
    const perKeyBus = (k: unknown) =>
      deps.channel<unknown>(collectionKeyChannel(key, String(k)));

    // The batched `deltas` stream is OPT-IN: its bus and per-tick coalescing
    // exist only when the collection lists the `deltas` verb. A non-opted
    // collection pays nothing here — the per-key `keys`/`get` path is untouched.
    const collVerbs = resolveCollectionVerbs(collSpec);
    const hasDeltas = collectionHasDeltas(collSpec);
    const deltasBus = hasDeltas
      ? deps.channel<CollectionDelta<unknown, unknown>>(
          collectionDeltasChannel(key),
        )
      : undefined;
    // The per-tick coalescer owns the `pending` buffer + microtask flush; it
    // exists ONLY when the collection opts into `deltas`, so `hasDeltas` is the
    // single representation of "deltas is on" and the walk loop holds no
    // batching state. `coalescer?.upsert`/`.remove` below are the only gate.
    const coalescer = deltasBus
      ? createTickCoalescer<unknown, unknown>(deltasBus)
      : undefined;

    // Surface-owned publish: every upsert broadcasts the new per-key value, and
    // an upsert that ADDS a key (or any remove) broadcasts the new key set.
    // Consumers' upsert/remove stay persistence-only. The deltas coalescing is
    // additive on top.
    //
    // `keysBus` fires on MEMBERSHIP change only — the contract its dep doc states
    // ("broadcasts K[] snapshots on add/remove"). BOTH mirror paths enforce that
    // symmetrically against `broadcastKeys`: `wrappedUpsert` schedules a broadcast
    // only when a key is NEW to the set, and `wrappedRemove` only when the key was
    // actually IN it. A value-only upsert (existing key, new value) leaves the key
    // SET identical, and a remove of a non-member (a repeat/no-op drop) leaves it
    // identical too, so in either case re-publishing the whole key array would be a
    // redundant full-snapshot the `keys` subscribers fold to the same set (and a
    // spurious re-render). Value updates travel the per-key `get` stream
    // (`perKeyBus`) and the batched `deltas` stream (`coalescer`), both of which DO
    // fire on every upsert.
    //
    // The broadcast itself is COALESCED PER TICK (`createKeysetCoalescer`): a
    // same-tick burst of membership edges flushes as one tick-final snapshot on
    // the next microtask, so a bulk add of M keys costs one frame and one
    // `readAll()`, not M of each — and a tick whose edges cancel out publishes
    // nothing at all, so the guards below and the coalescer enforce the same
    // "membership-change only" promise at two time scales.
    //
    // "New key" must mean new to SUBSCRIBERS, NOT new to the store. A registry-
    // PROJECTION collection (kolu's `awareness` / `authored` / `daemonStatus`) has
    // a no-op `upsert` and adds the entry to its registry BEFORE calling this
    // publish, so `collDeps.readAll().has(k)` is ALREADY true here — a store test
    // taken before `upsert` would read the key as pre-existing and never broadcast
    // the add, so an already-subscribed `keys` consumer (a cross-process mirror)
    // would never see a key born after it connected (kolu's own client dodges this
    // by sourcing membership from a sibling, then reading per-key values). So track
    // the framework's OWN record of which keys it has broadcast and fire the
    // membership snapshot on a key's first upsert regardless of when the backing
    // inserted it — correct for an in-memory Map dep (where `upsert` adds the key)
    // and a registry projection alike.
    //
    // Seed the set from the keys ALREADY in the backing store at construction. A
    // consumer that subscribes later reads those keys from the `keys` handler's
    // connect snapshot (which reads `readAll()` live), so they need no membership
    // delta — and a value-only upsert on a key PRELOADED before this server was
    // built must NOT spuriously re-publish the whole key set. (An empty seed would
    // fire one redundant full-snapshot on such a key's first upsert: harmless —
    // subscribers fold it to the same set — but a real weakening of the
    // "membership-change only" contract this stream promises, and untested.) The
    // published array is always the live `readAll()` set, so the seed only ever
    // suppresses a redundant snapshot, never a wrong one.
    // Expose this collection to `$`. Its change edge fires on every accepted key
    // change below (a version poke — a compute reading `$.<coll>()` re-runs, then
    // its OWN member `equals` is the final wire dedup). Registered before the
    // wrapped publishers so `siblingChange[key]` exists when they fire.
    //
    // The sibling READ is `readAll()` by default (a fresh fold each access). When
    // the collection opts into `materializeSiblingView`, the read instead returns
    // a MATERIALIZED VIEW — a per-key cache of `readAll()` seeded once here and
    // kept current by the wrapped publishers below (the view's single write path)
    // — so a `$`-reader never re-runs an expensive `readAll()` recompose (the SR7
    // urgency O(M²) fix; see `CollectionImplDeps.materializeSiblingView`). Same
    // contents and same per-key poke granularity — a pure optimization behind the
    // seam. One `readAll()` seeds BOTH the view and `broadcastKeys`, so opting in
    // never doubles the boot fold.
    const initialEntries = collDeps.readAll();
    const siblingView = collDeps.materializeSiblingView
      ? new Map<unknown, unknown>(initialEntries)
      : undefined;
    registerSibling(
      key,
      siblingView ? () => siblingView : () => collDeps.readAll(),
    );
    const broadcastKeys = new Set<unknown>(initialEntries.keys());
    const scheduleKeysBroadcast = createKeysetCoalescer(keysBus, key, () =>
      Array.from(collDeps.readAll().keys()),
    );
    const wrappedUpsert = (k: unknown, v: unknown) => {
      depUpsert(k, v);
      siblingView?.set(k, v); // materialized view — the SINGLE write path (opt-in)
      if (!broadcastKeys.has(k)) {
        broadcastKeys.add(k);
        scheduleKeysBroadcast();
      }
      perKeyBus(k).publish(v);
      coalescer?.upsert(k, v);
      siblingChange[key]?.(); // version poke — a $-reader of this collection recomputes
    };
    const wrappedRemove = (k: unknown) => {
      depRemove(k);
      siblingView?.delete(k); // materialized view — the SINGLE write path (opt-in)
      if (broadcastKeys.delete(k)) {
        scheduleKeysBroadcast();
      }
      coalescer?.remove(k);
      siblingChange[key]?.(); // version poke — a removal changes what a $-reader folds
    };

    // A derived collection is graph-owned (one writer): its ctx `upsert`/`remove`
    // THROW — a fail-fast one-writer guard mirroring a derived cell's, so a
    // procedure handler that tries to mutate it gets a loud error, never a silent
    // second writer. An authored collection keeps its real server-internal writes.
    const derivedCollWriteGuard = (): never => {
      throw new Error(
        `implementSurface: collection "${key}" is graph-owned (a derived.collection) — the reconciler is its one writer; ctx.collections.${key}.upsert/remove is not a write path.`,
      );
    };
    collectionsCtx[key] = {
      upsert: derivedColl ? derivedCollWriteGuard : wrappedUpsert,
      remove: derivedColl ? derivedCollWriteGuard : wrappedRemove,
      readAll: collDeps.readAll,
      readOne: collDeps.readOne ?? ((k: unknown) => collDeps.readAll().get(k)),
    };

    // A derived collection's reconciler is an OWNED SOURCE: fire its `connect` in
    // the deferred `starts` pass (handing it the surface's per-key publishers + the
    // spec's value `equals`, defaulting to "always changed" so an equals-less
    // collection re-publishes every present key). Same lifecycle as a derived
    // cell's connector — a WIRING fault reaches the runtime's `done` (a poll
    // reconciler's first-read rejection does NOT: it is cell-local since #2101, see
    // the audit on `SurfaceRuntimeHandle.done`), and `close` disposes the node +
    // subscription.
    //
    // Note what is NOT here any more: the hand-rolled microtask deferral and the
    // same-turn-close guard it needed. Both existed because a SYNCHRONOUS connect
    // fault (a non-poll collection whose first reconcile's publisher throws) had
    // to become a rejection rather than escape `start()`. Inside a fiber that is
    // free — a defect lands on the exit — so the connect runs synchronously again
    // and can no longer race a `close()` that has not happened yet.
    if (derivedColl) {
      const dc = derivedColl;
      const collEquals = collSpec.equals ?? (() => false);
      starts.push(() =>
        startOwnedSource(() =>
          dc.connect({
            upsert: wrappedUpsert,
            remove: wrappedRemove,
            equals: collEquals as (a: unknown, b: unknown) => boolean,
          }),
        ),
      );
    }

    const memberHandlers = collectionHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
      (surface.descriptors.collections as any)[key] as Collection<
        string,
        unknown,
        unknown
      >,
      {
        readAll: collDeps.readAll,
        readOne: collDeps.readOne,
        holders: collDeps.holders,
        upsert: wrappedUpsert,
        remove: wrappedRemove,
        perKeyBus: perKeyBus as (k: unknown) => Channel<unknown>,
        keysBus: keysBus as Channel<unknown[]>,
        deltasBus,
      },
    );

    for (const v of collVerbs) {
      // biome-ignore lint/suspicious/noExplicitAny: handler map indexed by verb string
      const h = (memberHandlers as any)[v] as SurfaceHandler | undefined;
      if (h === undefined) continue;
      bind(key, v, h);
    }
  }

  // ── Streams ──────────────────────────────────────────────────────────
  for (const [key] of Object.entries(spec.streams ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const streamDeps = (deps.streams as any)?.[key] as
      | {
          source?: (i: unknown) => Stream.Stream<unknown>;
          read?: (i: unknown) => Promise<unknown>;
          install?: (i: unknown, onEvent: () => void) => () => void;
          isEqual?: (a: unknown, b: unknown) => boolean;
          onReadError?: (err: unknown) => void;
        }
      | undefined;
    if (!streamDeps) {
      throw new Error(`implementSurface: missing deps for stream "${key}"`);
    }
    // Synthesize `source` from the poll shape when `source` is not supplied
    // directly. The poll shape is the common case for external mutable
    // state (git, fs); the framework owns `pollOnEvent` so consumers
    // don't repeat the snapshot+install+re-read+isEqual plumbing per stream.
    let source: (i: unknown) => Stream.Stream<unknown>;
    if (streamDeps.source) {
      source = streamDeps.source;
    } else if (streamDeps.read && streamDeps.install && streamDeps.isEqual) {
      const read = streamDeps.read;
      const install = streamDeps.install;
      const isEqual = streamDeps.isEqual;
      // Per-stream override wins; fall back to top-level. Boot-time check
      // — a poll-shape stream with no observability for transient read
      // failures is almost always a bug, so fail at wiring rather than
      // silently swallow at runtime.
      const topLevel = deps.onStreamReadError;
      const onReadError =
        streamDeps.onReadError ??
        (topLevel ? (err: unknown) => topLevel(err, { stream: key }) : null);
      if (onReadError === null) {
        throw new Error(
          `implementSurface: stream "${key}" uses poll shape but has no onReadError — supply per-stream or set top-level onStreamReadError`,
        );
      }
      // `pollOnEvent` is an AsyncIterable producer that cancels through an
      // `AbortSignal` (its `install` teardown runs when the loop observes the
      // abort), so it bridges to a `Stream` at ITS OWN edge — the D10 rule. The
      // signal is scoped to the stream, so interrupting the consuming fiber tears
      // the poll loop down exactly as the old per-call `signal` did.
      source = (input) =>
        streamFromAbortableSource((signal) =>
          pollOnEvent({
            read: () => read(input),
            install: (cb) => install(input, cb),
            isEqual,
            signal,
            onReadError,
          }),
        );
    } else {
      throw new Error(
        `implementSurface: stream "${key}" needs either { source } or { read, install, isEqual }`,
      );
    }
    const memberHandlers = streamHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
      (surface.descriptors.streams as any)[key] as StreamDescriptor<
        string,
        unknown,
        unknown
      >,
      { source },
    );
    bind(key, "get", memberHandlers.get);
  }

  // ── Events ───────────────────────────────────────────────────────────
  // The surface owns each event's per-input channel. Domain code publishes
  // via `ctx.events.<key>.publish(input, payload)`; the wire source reads
  // from the same channel. Channel name = `<key>:<keyOfInput(input)>`.
  const eventsCtx: Record<string, unknown> = {};
  for (const [key] of Object.entries(spec.events ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const eventDeps = (deps.events as any)?.[key] as
      | {
          source?: (
            i: unknown,
            helpers: { bus: Channel<unknown> },
          ) => Stream.Stream<unknown>;
        }
      | undefined;
    const busFor = (input: unknown): Channel<unknown> =>
      deps.channel<unknown>(`${key}:${eventChannelKey(input)}`);
    eventsCtx[key] = {
      publish: (input: unknown, payload: unknown) => {
        busFor(input).publish(payload);
      },
    };
    const consumerSource = eventDeps?.source;
    const source = (input: unknown): Stream.Stream<unknown> => {
      const bus = busFor(input);
      return consumerSource
        ? consumerSource(input, { bus })
        : channelStream(bus);
    };
    const memberHandlers = eventHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
      (surface.descriptors.events as any)[key] as Event<
        string,
        unknown,
        unknown
      >,
      { source },
    );
    bind(key, "get", memberHandlers.get);
  }

  // ── Procedures ───────────────────────────────────────────────────────
  const ctx = {
    cells: cellsCtx,
    collections: collectionsCtx,
    events: eventsCtx,
  };
  for (const [ns, procs] of Object.entries(spec.procedures ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const procDeps = (deps.procedures as any)?.[ns] as
      | Record<
          string,
          (opts: { input: unknown; ctx: unknown }) => SurfaceHandlerResult
        >
      | undefined;
    for (const verb of Object.keys(procs)) {
      const handler = procDeps?.[verb];
      if (!handler) {
        throw new Error(
          `implementSurface: missing handler for procedure "${ns}.${verb}"`,
        );
      }
      bind(ns, verb, (input: unknown) => handler({ input, ctx }));
    }
  }

  // Auto-answer the framework-reserved liveness probe (see @kolu/surface
  // ./liveness). It lives only in the group (`defineSurface` claims it), never in
  // `spec`, so the procedures loop above neither demanded a dep nor bound it —
  // bind it here, with a trivial `{}` reply (resolution is the liveness signal).
  // No app implements it, so a client heartbeat / ssh watchdog gets a
  // surface-agnostic round-trip for free.
  bind(LIVENESS_NAMESPACE, LIVENESS_VERB, () => Effect.succeed({}));

  // Auto-answer the framework-reserved identity probe (see @kolu/surface
  // ./identity), the identity twin of `system.live` in the SAME reserved `system`
  // namespace. Stamps the server's process start; a server that DECLARED a build
  // (`identity` arg — only padi does) is served `identified`, else `anonymous`. No
  // app implements it. The served value is constant for the process lifetime, so
  // compute it once.
  const servedIdentity = serveIdentity(SERVER_STARTED_AT, identity);
  bind(IDENTITY_NAMESPACE, IDENTITY_VERB, () => Effect.succeed(servedIdentity));

  // Auto-answer the framework-reserved clock probe (see @kolu/surface ./clockNow),
  // the clock twin of `system.live`/`system.identity` in the SAME reserved `system`
  // namespace. Replies with this process's own wall clock — computed FRESH per call
  // (unlike the constant identity), since a consumer measures the far-end clock
  // OFFSET off it at admit (`Date.now()` is already the uptime source above). No
  // app implements it.
  bind(CLOCK_NOW_NAMESPACE, CLOCK_NOW_VERB, () =>
    Effect.sync(() => ({ epochMs: Date.now() })),
  );

  // ── Bind compute cells ($ read face) ───────────────────────────────────
  // Every member has validated and every cell/collection sibling source now
  // exists, so build each compute-fn `derived.cell(($) => …)` node and eager-seed
  // its private store — the last synchronous step before the walk returns, so a
  // seed's dependency graph is whole. TWO passes: pass A builds every (lazy) node,
  // pass B eager-seeds every store. Because every node exists before any seed pulls,
  // a compute cell that reads another compute sibling via `$` works in ANY
  // declaration order (a diamond across compute cells too) — the engine's lazy DAG
  // orders the pull, only a genuine cycle fails. A seed throw here is a boot crash
  // (mirror-never-fabricate); the graph subscriptions it installs are walk-local
  // closures, discarded with the walk if a throw unwinds it.
  for (const { bind: bindSiblings } of bindComputeCells)
    bindSiblings(siblingSources);
  for (const { seed } of bindComputeCells) seed();

  return { handlers, ctx: ctx as SurfaceCtx<S>, starts };
}

/** Optional serve-time knobs for {@link implementSurface}. */
export interface ImplementSurfaceOptions {
  /** The server's DECLARED build triple — what the reserved `system.identity` serves
   *  as its `identified` arm (the framework stamps `startedAt`). Omit and the surface
   *  is served `anonymous` (connected, no build declared) — the right answer for every
   *  server whose identity no consumer reads (drishti-agent, odu-runner). Only a
   *  server with a reader (padi) declares it. */
  identity?: BakedIdentity;
}

/** Serve a single surface as a directly-servable, supervised
 *  {@link SurfaceRuntime}. Owns an internal `inMemoryChannelByName()` — the
 *  in-process channel factory every self-contained consumer was passing by hand.
 *  A consumer that must serve on a SHARED, caller-owned publisher reaches for
 *  {@link implementSurfaceOnPublisher} instead — a distinct ownership promise,
 *  never a mode flag. */
export function implementSurface<const S extends SurfaceSpec>(
  surface: Surface<S>,
  deps: ImplementSurfaceDeps<S>,
  opts?: ImplementSurfaceOptions,
): SurfaceRuntime<S> {
  return implementSurfaceOnPublisher(
    surface,
    deps,
    inMemoryChannelByName(),
    opts,
  );
}

/** Serve a single surface on a caller-provided channel factory (a shared
 *  publisher whose lifetime the runtime does NOT own — the runtime's `close`
 *  releases only what IT minted). Distinct from {@link implementSurface}
 *  because kolu's shared publisher carries non-surface channels too, so its
 *  teardown is the caller's, not the surface's. */
export function implementSurfaceOnPublisher<const S extends SurfaceSpec>(
  surface: Surface<S>,
  deps: ImplementSurfaceDeps<S>,
  channel: <T>(name: string) => Channel<T>,
  opts?: ImplementSurfaceOptions,
): SurfaceRuntime<S> {
  const { handlers, ctx, starts } = walkSurface(
    surface,
    { ...deps, channel },
    opts?.identity,
  );
  // Route-set identity (D1): the group `defineSurface` minted and the handlers
  // this file bound must be the SAME tag set, or the surface serves a route
  // nobody answers (a 404 at the far end) or answers a route nobody advertises
  // (dead code). Both are boot crashes.
  assertHandlersMatchGroup(surface.group, handlers, "implementSurface");
  // Transactional construction: only NOW — after the walk validated every member
  // and the route set proved out — do we start the connectors. A throw above
  // returns before any source spins up, so none can be orphaned.
  const sources = starts.map((start) => start());
  const { done, close } = superviseSurface(sources);
  return { group: surface.group, handlers, ctx, done, close };
}

// ── extendSurface — compose a local runtime onto a re-served one ────────

/** A servable surface runtime paired with its surface DESCRIPTOR — the shape
 *  {@link extendSurface} composes. `reServeSurface`'s `ReServedSurface` (the
 *  re-served BASE) satisfies it directly; a local `implementSurface` runtime does
 *  once its `surface` is carried alongside (the runtime alone omits the descriptor,
 *  which the composition needs to build the combined group). */
export interface ServedSurface<S extends SurfaceSpec> {
  /** The surface this runtime serves — its descriptor, for the combined group. */
  readonly surface: Surface<S>;
  /** Every bound member handler, keyed by FULL wire tag (built against
   *  `surface`'s own tag prefix). */
  readonly handlers: SurfaceHandlers;
  /** Rejects on an owned fault; the base's resolves on its terminal end. */
  readonly done: Promise<void>;
  /** Release this runtime's owned sources. Idempotent. */
  close(): Promise<void>;
}

/** One KIND's member record, with an ABSENT kind (an optional-field `undefined`)
 *  normalized to the empty object `{}` — so intersecting two of these MERGES their
 *  members (`{status} & {history}` → `{status, history}`) and an absent side adds
 *  nothing (`{status} & {}` → `{status}`), instead of collapsing to `never` (which
 *  `& Record<string, never>` would). The `[T]` tuple stops a `Record | undefined`
 *  from distributing. Empty `{}` still satisfies `SurfaceSpec`'s per-kind
 *  `Record<string, …Spec>` constraint (vacuously — no properties to violate). */
type Members<T> = [T] extends [undefined]
  ? Record<never, never>
  : NonNullable<T>;

/** The spec of the surface {@link extendSurface} composes — a flat, per-kind merge
 *  of the base and extension specs (each kind's members intersect; see
 *  {@link Members}). A member-name collision within a kind is a runtime error,
 *  never a silent `{...spread}` overwrite. */
export type ComposedSurfaceSpec<
  A extends SurfaceSpec,
  B extends SurfaceSpec,
> = {
  cells: Members<A["cells"]> & Members<B["cells"]>;
  collections: Members<A["collections"]> & Members<B["collections"]>;
  streams: Members<A["streams"]> & Members<B["streams"]>;
  events: Members<A["events"]> & Members<B["events"]>;
  procedures: Members<A["procedures"]> & Members<B["procedures"]>;
};

/** The composed runtime {@link extendSurface} returns — the combined surface plus
 *  the supervision contract. `group`/`handlers` serve EVERY base + extension member
 *  FLAT under one `surface/` tag prefix (byte-identical tags), `done` settles when
 *  the base's terminal source ends (or either runtime faults), `close` releases both. */
export interface ExtendedSurface<
  Base extends SurfaceSpec,
  Ext extends SurfaceSpec,
> {
  readonly surface: Surface<ComposedSurfaceSpec<Base, Ext>>;
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly handlers: SurfaceHandlers;
  readonly done: Promise<void>;
  close(): Promise<void>;
}

const SURFACE_KINDS = [
  "cells",
  "collections",
  "streams",
  "events",
  "procedures",
] as const;

/** Merge two surface specs FLAT, failing loud on a member-name collision. The wire
 *  namespace is FLAT and PER-NAME: `defineSurface` folds every member — cell /
 *  collection / stream / event / procedure — into ONE namespace keyed by member
 *  name, so a name may be claimed by AT MOST ONE side across ALL kinds. A base cell
 *  `foo` and an ext procedure namespace `foo` have disjoint verbs, so a per-kind
 *  check (and `defineSurface`'s per-`(name,verb)` claim) would miss the clash while
 *  the flat wire namespace silently drops one side's handlers — so the collision is
 *  checked on the flat name axis the wire actually uses. Only the DECLARED (user)
 *  members participate: framework-injected reserved members (`system`) are absent
 *  from these specs and legitimately present in BOTH runtimes, so they are not a
 *  collision (their handler is resolved at the router splice, base-authoritative). */
function mergeSurfaceSpecs(a: SurfaceSpec, b: SurfaceSpec): SurfaceSpec {
  const flatNames = (s: SurfaceSpec): string[] =>
    SURFACE_KINDS.flatMap((k) =>
      Object.keys(
        (s as Record<string, Record<string, unknown> | undefined>)[k] ?? {},
      ),
    );
  const aNames = new Set(flatNames(a));
  for (const name of flatNames(b)) {
    if (aNames.has(name)) {
      throw new Error(
        `extendSurface: the base and extension both serve member "${name}" — a composed surface can't have two (the wire namespace is flat, per-name across all kinds), rename one.`,
      );
    }
  }
  const merged: Record<string, Record<string, unknown>> = {};
  for (const kind of SURFACE_KINDS) {
    const av = (a as Record<string, Record<string, unknown> | undefined>)[kind];
    const bv = (b as Record<string, Record<string, unknown> | undefined>)[kind];
    // EVERY kind is materialized (empty when both sides omit it), so the runtime
    // spec value matches `ComposedSurfaceSpec`'s all-kinds-present type — a reader of
    // `composed.surface.spec.<kind>` gets an object, never `undefined` behind an
    // object type. Names are guaranteed disjoint across the two specs by the check
    // above, so the shallow merge never overwrites.
    merged[kind] = { ...av, ...bv };
  }
  return merged as SurfaceSpec;
}

/** Compose a LOCAL runtime onto a RE-SERVED one, into one served surface (SR5 —
 *  parent-owned additions stay causally separate from mirroring). The BASE is a
 *  re-served surface (`reServeSurface`, a mirror of a remote agent); `ext` is a
 *  parent-LOCAL runtime (a retention ring, a derived registry) whose producers
 *  OBSERVE the base's committed frames POST-COMMIT rather than opening a SECOND
 *  mirror — so a parent keeps a local member (drishti's `metricHistory`) without an
 *  inert agent-side stub on the shared surface.
 *
 *  The result serves EVERY base + extension member FLAT under one `surface/` tag
 *  prefix, at byte-identical tags. On a FLAT tag namespace the composition is a
 *  plain record merge over the combined group — there is no router fragment to
 *  re-adapt against a matcher, because a tag carries its own route. What used to
 *  need `implement(combined).router({...})` (so a fragment picked up the combined
 *  contract's matcher meta) is now proved directly:
 *  {@link assertHandlersMatchGroup} pins the merged handler set against
 *  `combined.group.requests`, so "every member routes, at the same tag it had
 *  standalone" is an assertion, not an inference.
 *
 *  Collision policy is `claim` semantics, exactly as `defineSurface`'s walk:
 *  a tag claimed by BOTH sides throws — EXCEPT the three framework-reserved
 *  `system/*` tags, which every surface carries and which resolve
 *  BASE-AUTHORITATIVE (the base carries the re-served agent's identity and
 *  liveness gate; a local retention ring adds no gate). An APP-OWNED verb in the
 *  same namespace (`procedures.system.echo`) has its OWN tag, so it is preserved
 *  by construction rather than by a deep-merge — the flat namespace makes the old
 *  per-verb spread unnecessary.
 *
 *  Supervision routes through {@link superviseTerminalSource}: the base is the
 *  TERMINAL driver (its mirror pump ends when the remote session is destroyed, the
 *  composite's resolving edge), the local `ext` is PASSIVE (only its fault settles
 *  `done` before close). `close` tears the base down FULLY FIRST — `base.close()`,
 *  awaited to completion (it aborts the base's pump AND releases the base runtime's
 *  own sources) — then releases the local runtime. The combinator's terminal
 *  contract is the ATOMIC `close: () => Promise<void>` teardown verb, so the base's
 *  async full-runtime `close()` fits it directly — no hand-rolled done/close fold. */
export function extendSurface<
  Base extends SurfaceSpec,
  Ext extends SurfaceSpec,
>(
  base: ServedSurface<Base>,
  ext: ServedSurface<Ext>,
): ExtendedSurface<Base, Ext> {
  // The combined surface descriptor — a flat spec merge (loud on collision). The
  // documented cast is the standard dynamic-spec-merge pattern: `defineSurface`'s const
  // inference over the dynamic merge doesn't line up structurally with `ComposedSurfaceSpec`,
  // but the runtime IS that surface (every base + extension member).
  const combined = defineSurface(
    mergeSurfaceSpecs(
      base.surface.spec,
      ext.surface.spec,
    ) as unknown as SurfaceSpec<never>,
  ) as unknown as Surface<ComposedSurfaceSpec<Base, Ext>>;

  // Merge the two handler records. Extension first, then base — so the reserved
  // `system/*` tags (present in BOTH) resolve base-authoritative, and any other
  // double-claim is a loud throw rather than a silent last-writer-wins overwrite.
  const reserved = reservedSurfaceTags(combined.tagPrefix);
  const handlers = emptyHandlers();
  for (const [tag, handler] of Object.entries(ext.handlers)) {
    handlers[tag] = handler;
  }
  for (const [tag, handler] of Object.entries(base.handlers)) {
    if (tag in handlers && !reserved.has(tag)) {
      throw new Error(
        `extendSurface: the base and extension both bind wire tag "${tag}" — a composed surface can't have two handlers for one tag, rename one member.`,
      );
    }
    handlers[tag] = handler;
  }
  // Route-set identity: every tag the combined group advertises has exactly one
  // handler, and no handler sits at a tag the group never minted.
  assertHandlersMatchGroup(combined.group, handlers, "extendSurface");

  // Supervise through the framework's terminal-source combinator: the base (a
  // re-served mirror) is the TERMINAL driver — its `done` resolves when the remote
  // session ends (the composite's resolving edge) — and the local `ext` is PASSIVE,
  // so only its FAULT settles `done` before close. `close` tears the base down FULLY
  // FIRST (`base.close()` aborts its pump AND releases its own runtime, awaited to
  // completion), then releases the local runtime — the base's async `close()` is the
  // combinator's atomic terminal teardown verb, no hand-rolled done/close fold here.
  const { done, close } = superviseTerminalSource(ext, {
    done: base.done,
    close: base.close,
  });

  return { surface: combined, group: combined.group, handlers, done, close };
}

// ── implementSurfaces — sibling surfaces over one transport ─────────────

/** A keyed map of independent surfaces — the single source of *which*
 *  surfaces exist under *which* keys. Browser-safe (no server impls), so the
 *  same value feeds `composeSurfaceContracts` (group), `surfaceClients`
 *  (client), and `implementSurfaces` (server). Each surface is served as a
 *  SIBLING namespaced by its key — they are NOT merged into one surface. */
// biome-ignore lint/suspicious/noExplicitAny: the map is heterogeneous; each value pins its own SurfaceSpec.
export type SurfaceMap = Record<string, Surface<any>>;

/** The per-key server-implementation deps for a `SurfaceMap` — the same
 *  per-primitive wiring `implementSurface` takes (cell stores, collection
 *  readers, stream/event sources, procedure handlers). `channel` is not a dep
 *  (the base owns it, key-namespaced). Typed against each surface's own spec,
 *  so a key's deps are checked precisely (no `any`-spec'd entry map). */
export type SurfaceDepsFor<S extends SurfaceMap> = {
  [K in keyof S]: S[K] extends Surface<infer Spec>
    ? ImplementSurfaceDeps<Spec>
    : never;
};

/** The per-key typed mutation ctx returned by `implementSurfaces`. */
export type SurfacesCtx<S extends SurfaceMap> = {
  [K in keyof S]: S[K] extends Surface<infer Spec> ? SurfaceCtx<Spec> : never;
};

/** The transport-level base for {@link implementSurfaces} — everything shared
 *  across the sibling surfaces EXCEPT the channel factory (which the ordinary
 *  constructor owns internally; {@link implementSurfacesOnPublisher} injects). */
export interface ImplementSurfacesBase<S extends SurfaceMap> {
  /** Fallback subsequent-read error handler for any sibling's poll-shape streams
   *  whose deps don't supply their own. */
  onStreamReadError?: (err: unknown, info: { stream: string }) => void;
  /** Per-key DECLARED build identity — what each sibling's reserved
   *  `system.identity` serves as its `identified` arm (see `./identity`). Omit a
   *  key → that sibling serves `anonymous`. Only a sibling whose identity a
   *  consumer reads (kolu-server reads the `padi` sibling's) needs an entry. */
  identity?: { [K in keyof S]?: BakedIdentity };
}

/** Serve a keyed MAP of independent surfaces multiplexed over one transport,
 *  each namespaced by its key. Unlike `implementSurface`, the surfaces are NOT
 *  merged — surface-app stays a complete surface served as a sibling of the
 *  app surface under its own key.
 *
 *  Three args, mirroring the group/client side: `surfaces` (the same
 *  browser-safe `SurfaceMap` you pass to `composeSurfaceContracts` /
 *  `surfaceClients` — the single source of keys+surfaces), `base` (the one
 *  transport's `channel` + fallback `onStreamReadError`), and `deps` (the
 *  server-only per-surface impls, keyed the same as `surfaces`). The surfaces
 *  aren't re-listed here; only their deps are.
 *
 *  Routing: `composeSurfaceContracts` re-walks each sibling's spec with the
 *  sibling tag prefix, so every member lands at `surface/<key>/<member>/<verb>`
 *  in ONE flat group — no double-prefix, and no bare `RpcGroup.merge` (which
 *  would silently collide the three reserved `system/*` tags across siblings).
 *  The handler walk binds against the SAME per-sibling `Surface` value, so it
 *  never learns it is scoped.
 *
 *  Channels are key-namespaced: each surface's `channel(name)` call is rewritten
 *  to `base.channel(key + "/" + name)`, so two surfaces that each own e.g. a
 *  `buildInfo:changed` channel can't collide on the wire. `base.onStreamReadError`
 *  is the fallback for any surface whose deps don't supply their own. */
export function implementSurfaces<const S extends SurfaceMap>(
  surfaces: S,
  base: ImplementSurfacesBase<S>,
  deps: SurfaceDepsFor<S>,
): SurfacesRuntime<S> {
  return implementSurfacesOnPublisher(
    surfaces,
    { ...base, channel: inMemoryChannelByName() },
    deps,
  );
}

/** The shared-publisher sibling of {@link implementSurfaces}: the caller injects
 *  the one transport's `channel` (a shared publisher whose lifetime the runtime
 *  does NOT own). Distinct constructor, not a mode flag — the shared publisher
 *  carries non-surface channels too, and its teardown is the caller's. */
export function implementSurfacesOnPublisher<const S extends SurfaceMap>(
  surfaces: S,
  base: ImplementSurfacesBase<S> & {
    channel: <T>(name: string) => Channel<T>;
  },
  deps: SurfaceDepsFor<S>,
): SurfacesRuntime<S> {
  // The combined group envelope has ONE definition — the receptacle the
  // group side already uses. Each sibling comes back as a full `Surface`
  // whose `tagPrefix` is `surface/<key>/`, so the handler walk below is the
  // SAME walk a standalone surface takes.
  const composed = composeSurfaceContracts(surfaces);

  const handlers = emptyHandlers();
  const ctxByKey: Record<string, unknown> = {};
  const starts: SurfaceSourceStart[] = [];
  for (const key of Object.keys(surfaces)) {
    const sibling = composed.siblings[key] as Surface<SurfaceSpec>;
    const keyedChannel = <T>(name: string): Channel<T> =>
      base.channel<T>(`${key}/${name}`);
    const surfaceDeps = (
      deps as Record<string, ImplementSurfaceDeps<SurfaceSpec>>
    )[key];
    if (!surfaceDeps) {
      throw new Error(`implementSurfaces: missing deps for surface "${key}"`);
    }
    const walked = walkSurface(
      sibling,
      {
        ...surfaceDeps,
        channel: keyedChannel,
        onStreamReadError:
          surfaceDeps.onStreamReadError ?? base.onStreamReadError,
      },
      base.identity?.[key as keyof S],
    );
    for (const [tag, handler] of Object.entries(walked.handlers)) {
      // Sibling prefixes make cross-sibling tags disjoint by construction, so a
      // duplicate here means the composition itself is broken — crash rather
      // than let one sibling's member silently answer for another's.
      if (tag in handlers) {
        throw new Error(
          `implementSurfaces: duplicate wire tag "${tag}" while binding sibling "${key}".`,
        );
      }
      handlers[tag] = handler;
    }
    ctxByKey[key] = walked.ctx;
    starts.push(...walked.starts);
  }

  assertHandlersMatchGroup(composed.group, handlers, "implementSurfaces");
  // Transactional construction across the WHOLE map: every sibling has been
  // walked (an invalid one threw above) and the route set proved out, so
  // starting the connectors now can never orphan a source spun up for an
  // earlier sibling when a later sibling fails to validate.
  const sources = starts.map((start) => start());
  const { done, close } = superviseSurface(sources);
  return {
    group: composed.group,
    handlers,
    ctx: ctxByKey as SurfacesCtx<S>,
    done,
    close,
  };
}

/** Stringify an event input as a channel key. Primitives go through
 *  `String(...)`; objects go through `JSON.stringify(...)` so each distinct
 *  input gets a stable channel name without consumer config. */
function eventChannelKey(input: unknown): string {
  return typeof input === "object" && input !== null
    ? JSON.stringify(input)
    : String(input);
}
