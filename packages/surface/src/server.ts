/**
 * @kolu/surface/server — server-side bindings for the typed reactive surface.
 *
 * Headline API: `implementSurface(surface, deps)` walks a `Surface` (from
 * `defineSurface`) and produces both a router fragment and a typed
 * mutation `ctx` — every cell/collection/stream/event/procedure wired in
 * one declarative call. The framework owns the snapshot+deltas wire
 * protocol on both sides; client `useCell` / `useCollection` /
 * `useStream` consume what `implementSurface` produces, and `ctx.cells.X.set(...)`
 * etc. let domain code mutate without parallel store-and-publish paths.
 *
 * Persistence and pub/sub are pluggable via `CellStore<T>` and
 * `Channel<T>` interfaces. Adapters for `conf` (`confStore`) and
 * `@orpc/experimental-publisher` (`publisherChannel`) ship with the
 * framework; consumers can supply their own.
 *
 * Low-level escape hatches: `cellHandlers` / `collectionHandlers` /
 * `streamHandlers` / `eventHandlers` build the same handler bodies for
 * a single primitive — useful when a primitive needs custom plumbing
 * that doesn't fit `implementSurface`'s declarative path.
 */

import { implement } from "@orpc/server";
import type { ZodType } from "zod";
import {
  type CellSpec,
  type CollectionSpec,
  DEFAULT_CELL_VERBS_WITH_PATCH,
  DEFAULT_CELL_VERBS_WITHOUT_PATCH,
  DEFAULT_COLLECTION_VERBS,
  type EventSpec,
  type ProcedureSpec,
  type StreamSpec,
  type Surface,
  type SurfaceSpec,
} from "./define";
import type { Cell, Collection, Event, Stream } from "./index";

// ── Persistence + pub/sub interfaces ───────────────────────────────────

/** Persistence interface for a Cell or Collection's storage backend. */
export interface CellStore<T> {
  get(): T;
  set(value: T): void;
}

/** A typed publish/subscribe channel. `publish` triggers all live
 *  iterators to emit the value; `subscribe` returns an AsyncIterable that
 *  yields each future publish until `signal` aborts. */
export interface Channel<T> {
  publish(value: T): void;
  subscribe(signal: AbortSignal | undefined): AsyncIterable<T>;
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
  /** Optional pre-mutation hook — runs before persist+publish. Use for
   *  domain logging or invariant checks. */
  onMutate?: (patch: P, current: T) => void;
}

export interface CellHandlers<T, P = T> {
  /** Snapshot+deltas get handler. Plug into `t.X.get.handler(handlers.get)`. */
  get: (opts: { signal?: AbortSignal }) => AsyncGenerator<T>;
  /** Full-value set handler. Plug into `t.X.set.handler(handlers.set)`. */
  set: (opts: { input: T }) => void;
  /** Patch handler — applies `deps.patch(current, input)` and persists. */
  patch: (opts: { input: P }) => void;
  /** Test reset handler. Same as `set` but used by e2e fixtures. */
  test__set: (opts: { input: T }) => void;
}

/** Build the server-side handler suite for a Cell. Returns raw handler
 *  functions ready for `t.X.get.handler(handlers.get)` etc.
 *
 *  Snapshot+deltas invariant on `get`: yields `store.get()` first, then
 *  every value pushed to `bus`. The streaming retry plugin re-invokes
 *  `get` on every reconnect, so the first frame must be a fresh snapshot
 *  — the framework guarantees this here. */
export function cellHandlers<Name extends string, T, P = T>(
  _cell: Cell<Name, T>,
  deps: CellHandlerDeps<T, P>,
): CellHandlers<T, P> {
  function applyAndPublish(next: T): void {
    deps.store.set(next);
    deps.bus.publish(next);
  }

  return {
    get: async function* ({ signal }) {
      yield deps.store.get();
      for await (const v of deps.bus.subscribe(signal)) yield v;
    },
    set: ({ input }) => {
      deps.onMutate?.(input as unknown as P, deps.store.get());
      applyAndPublish(input);
    },
    patch: ({ input }) => {
      const current = deps.store.get();
      deps.onMutate?.(input, current);
      const next = deps.patch
        ? deps.patch(current, input)
        : (input as unknown as T);
      applyAndPublish(next);
    },
    test__set: ({ input }) => {
      applyAndPublish(input);
    },
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
  /** Bus for the live key set (broadcasts `K[]` snapshots on add/remove). */
  keysBus: Channel<K[]>;
}

export interface CollectionHandlers<K, T> {
  keys: (opts: { signal?: AbortSignal }) => AsyncGenerator<K[]>;
  get: (opts: { input: { key: K }; signal?: AbortSignal }) => AsyncGenerator<T>;
  upsert: (opts: { input: { key: K; value: T } }) => void;
  delete: (opts: { input: { key: K } }) => void;
  test__set: (opts: { input: Array<{ key: K; value: T }> }) => void;
}

export function collectionHandlers<Name extends string, K, T>(
  _coll: Collection<Name, K, T>,
  deps: CollectionHandlerDeps<K, T>,
): CollectionHandlers<K, T> {
  const readOne = deps.readOne ?? ((k: K) => deps.readAll().get(k));

  return {
    keys: async function* ({ signal }) {
      yield Array.from(deps.readAll().keys());
      for await (const v of deps.keysBus.subscribe(signal)) yield v;
    },
    get: async function* ({ input, signal }) {
      const initial = readOne(input.key);
      if (initial === undefined) {
        throw new Error(
          `collection ${_coll.name}: key not found at first snapshot`,
        );
      }
      yield initial;
      for await (const v of deps.perKeyBus(input.key).subscribe(signal)) {
        yield v;
      }
    },
    upsert: ({ input }) => {
      deps.upsert(input.key, input.value);
    },
    delete: ({ input }) => {
      deps.remove(input.key);
    },
    test__set: ({ input }) => {
      // Replace-all: clear current keys, upsert each from the fixture.
      const before = Array.from(deps.readAll().keys());
      for (const k of before) deps.remove(k);
      for (const { key, value } of input) deps.upsert(key, value);
    },
  };
}

// ── Stream handlers ────────────────────────────────────────────────────

export interface StreamHandlerDeps<I, T> {
  /** Source factory. Must yield snapshot-then-deltas semantics: first
   *  yield is a fresh full snapshot for the input, subsequent yields
   *  deliver updates. The framework's `pollOnEvent` produces this shape
   *  for poll-on-event sources. */
  source: (input: I, signal: AbortSignal | undefined) => AsyncIterable<T>;
}

export interface StreamHandlers<I, T> {
  get: (opts: { input: I; signal?: AbortSignal }) => AsyncGenerator<T>;
}

export function streamHandlers<Name extends string, I, T>(
  _stream: Stream<Name, I, T>,
  deps: StreamHandlerDeps<I, T>,
): StreamHandlers<I, T> {
  return {
    get: async function* ({ input, signal }) {
      for await (const v of deps.source(input, signal)) yield v;
    },
  };
}

// ── Event handlers ─────────────────────────────────────────────────────

export interface EventHandlerDeps<I, T> {
  /** Occurrence source. Yields zero or more occurrences; **no snapshot
   *  obligation** — the framework explicitly does not require the first
   *  yield to be a current-state snapshot, distinguishing Event from
   *  Stream. A late subscriber misses past occurrences; that's the
   *  contract. */
  source: (input: I, signal: AbortSignal | undefined) => AsyncIterable<T>;
}

export interface EventHandlers<I, T> {
  get: (opts: { input: I; signal?: AbortSignal }) => AsyncGenerator<T>;
}

/** Wire the server side of an `Event<I,T>`. Wire shape matches `streamHandlers`
 *  (oRPC iterator yielding `T`); the contract difference is that the source
 *  may yield zero items and need not start with a snapshot. The split from
 *  `streamHandlers` exists so authors can't accidentally wire an event
 *  source — which has no snapshot — to a stream handler that promises
 *  snapshot-then-deltas.
 *
 *  Implementation note: we forward `deps.source(input, signal)` directly
 *  as the handler's iterator rather than wrapping it in another
 *  `for await of source: yield v` generator. The extra wrap layer would
 *  put oRPC's wire one async tick behind a single-yield-then-return
 *  source — the wire's "iterator complete" frame races the yielded
 *  value's delivery, the consumer's first iteration sees `done: true`,
 *  and the yielded value is dropped. Pinned by `kill.feature` "Natural
 *  PTY exit removes terminal". */
export function eventHandlers<Name extends string, I, T>(
  _event: Event<Name, I, T>,
  deps: EventHandlerDeps<I, T>,
): EventHandlers<I, T> {
  return {
    get: ({ input, signal }) => deps.source(input, signal) as AsyncGenerator<T>,
  };
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
  let last: T = await opts.read();
  yield last;
  for await (const _ of repoEventStream(opts.install, opts.signal)) {
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
  }
}

/** Convert a callback-based "something changed" subscription into an
 *  AsyncIterable<void> that yields once per debounced tick.
 *
 *  Coalescing semantics: events that fire while the consumer is mid-yield
 *  collapse into one wakeup (the `dirty` flag flips to true; the consumer
 *  picks it up on the next loop iteration). This complements any upstream
 *  primitive's own debounce — bursts that arrive during snapshot
 *  computation don't queue up extra yields. */
async function* repoEventStream(
  install: (onEvent: () => void) => () => void,
  signal: AbortSignal | undefined,
): AsyncIterable<void> {
  let dirty = false;
  let resolve: (() => void) | null = null;
  // Drain the pending wake promise so the loop's `await` returns. Both
  // the upstream event callback and the abort signal need this exact
  // sequence; factoring it out keeps a future log/error addition from
  // landing in only one path.
  const drainResolve = (): void => {
    if (resolve) {
      const r = resolve;
      resolve = null;
      r();
    }
  };
  const unsub = install(() => {
    dirty = true;
    drainResolve();
  });
  signal?.addEventListener("abort", drainResolve);
  try {
    while (signal?.aborted !== true) {
      if (dirty) {
        dirty = false;
        yield;
        continue;
      }
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
  } finally {
    signal?.removeEventListener("abort", drainResolve);
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

// ── Built-in Channel adapter for @orpc/experimental-publisher ──────

/** Build a `Channel<T>` from an `@orpc/experimental-publisher`-style
 *  publisher. The publisher's untyped string-channel API is hidden
 *  behind a typed bus so each cell has one named channel and consumers
 *  can't typo.
 *
 *  Wraps the underlying iterator with `iterateUntilAborted` for two
 *  reasons. First (correctness): oRPC's WebSocket adapter calls
 *  `peer.close()` when the socket closes, which `AbortController.abort()`s
 *  every in-flight stream's signal — the publisher iterator then rejects
 *  pending pulls with `signal.reason`. Letting that propagate produces a
 *  full DOMException stack on every disconnect; swallowing the
 *  signal-shaped error keeps the cleanup quiet. Second (ordering): the
 *  extra generator layer adds one microtask of delay per yielded event,
 *  which preserves cross-channel ordering when multiple publishes fire
 *  on the same tick. Without that delay, a list-update publish racing
 *  a per-terminal exit publish can deliver the list message first and
 *  the client's `removeAndAutoSwitch` sees an already-truncated list,
 *  picking the wrong active terminal (or null).
 *
 *  Regression-pinned by Kolu's `kill.feature` "Natural PTY exit removes
 *  terminal" e2e scenario: removing the wrapper makes that test time out
 *  on the canvas-visible step. Any future "optimization" that flattens
 *  this layer must keep that test green. */
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
  return {
    publish: (value) => {
      void publisher.publish(channelName, value);
    },
    subscribe: (signal) =>
      iterateUntilAborted(publisher.subscribe(channelName, { signal }), signal),
  };
}

/** Iterate `source` and yield each item, ending cleanly if the iterator
 *  rejects with the signal's abort reason. Adds one microtask of delay
 *  per yield (see `publisherChannel`'s comment for why that matters). */
async function* iterateUntilAborted<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  try {
    for await (const item of source) yield item;
  } catch (err) {
    if (signal?.aborted && err === signal.reason) return;
    throw err;
  }
}

// ── implementSurface — server-side dep wiring for a Surface ─────────────

/** Per-cell implementation deps. The surface owns the publish channel
 *  (`<key>:changed`, derived from the surface key — not configurable);
 *  the consumer supplies persistence + (when patchSchema is set) the patch
 *  merge fn. */
export type CellImplDeps<S extends CellSpec<unknown, unknown>> = S extends {
  schema: ZodType<infer T>;
  patchSchema: ZodType<infer P>;
}
  ? {
      store: CellStore<T>;
      /** Pure merge for partial mutations. Optional here when the cell's
       *  spec already declares `patch` (the spec wins; the framework
       *  errors at boot if neither is supplied). */
      patch?: (current: T, p: P) => T;
      onMutate?: (patch: P, current: T) => void;
    }
  : S extends { schema: ZodType<infer T> }
    ? {
        store: CellStore<T>;
        onMutate?: (next: T, current: T) => void;
      }
    : never;

/** Per-collection implementation deps. The surface owns both buses
 *  (`<key>:keys` and `<key>:<k>`, derived from the surface key — not
 *  configurable) and wraps `upsert`/`remove` so every persisted change
 *  publishes through the surface's channels — the consumer's upsert/remove
 *  are persistence-only. Side-effects (`scheduleAutosave`, etc.) belong
 *  inside the consumer's upsert/remove fns or in the imperative procedure
 *  that triggered the call. */
export type CollectionImplDeps<S extends CollectionSpec<unknown, unknown>> =
  S extends { keySchema: ZodType<infer K>; schema: ZodType<infer T> }
    ? {
        readAll: () => Map<K, T>;
        readOne?: (key: K) => T | undefined;
        upsert: (key: K, value: T) => void;
        remove: (key: K) => void;
      }
    : never;

export type StreamImplDeps<S extends StreamSpec<unknown, unknown>> = S extends {
  inputSchema: ZodType<infer I>;
  outputSchema: ZodType<infer T>;
}
  ? {
      source: (input: I, signal: AbortSignal | undefined) => AsyncIterable<T>;
    }
  : never;

/** Per-event implementation deps. The surface owns the per-input event
 *  channel (default name `<key>:<key-of-input>` where the key-of-input is
 *  `String(input)` for primitives and `JSON.stringify(input)` for objects).
 *
 *    - Domain code publishes via `ctx.events.<key>.publish(input, payload)`,
 *      which writes to that channel.
 *    - The wire handler reads from the same channel.
 *
 *  `source` is optional. The default reads from the channel forever; supply
 *  one when the read path needs pre-subscribe validation, single-yield-then-
 *  close, or any other shape. The supplied source receives `helpers.bus` —
 *  the same channel `ctx.publish` writes to — so it doesn't reference a
 *  channel name string. */
export type EventImplDeps<S extends EventSpec<unknown, unknown>> = S extends {
  inputSchema: ZodType<infer I>;
  outputSchema: ZodType<infer T>;
}
  ? {
      source?: (
        input: I,
        signal: AbortSignal | undefined,
        helpers: { bus: Channel<T> },
      ) => AsyncIterable<T>;
    }
  : never;

// ── Procedure ctx ──────────────────────────────────────────────────────

/** Per-cell procedure ctx — get/set/patch via the surface's wrapped helpers
 *  so imperative procedures publish through the same channel as the wire
 *  handlers. Bypassing this and writing directly to the consumer's store
 *  silently skips the publish; don't. */
type CellCtxFor<S> = S extends {
  schema: ZodType<infer T>;
  patchSchema: ZodType<infer P>;
}
  ? { get: () => T; set: (v: T) => void; patch: (p: P) => void }
  : S extends { schema: ZodType<infer T> }
    ? { get: () => T; set: (v: T) => void }
    : never;

type CollectionCtxFor<S> = S extends {
  keySchema: ZodType<infer K>;
  schema: ZodType<infer T>;
}
  ? {
      upsert: (k: K, v: T) => void;
      remove: (k: K) => void;
      readAll: () => Map<K, T>;
      readOne: (k: K) => T | undefined;
    }
  : never;

/** Per-event ctx — `publish(input, payload)` writes to the framework-derived
 *  channel that the event's handler subscribes to. The channel name is
 *  `<key>:<key-of-input>` where the key-of-input is `String(input)` for
 *  primitives or `JSON.stringify(input)` for objects. Domain code never
 *  sees the channel string. */
type EventCtxFor<S> = S extends {
  inputSchema: ZodType<infer I>;
  outputSchema: ZodType<infer T>;
}
  ? { publish: (input: I, payload: T) => void }
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

/** Handler for an imperative procedure. Receives `ctx` exposing the
 *  surface's cell/collection mutation helpers so cross-descriptor publishes
 *  (e.g. `notes.create` writing to the `notes` collection) go through the
 *  same channels the wire handlers do. */
export type ProcedureImpl<
  S extends ProcedureSpec<unknown, unknown>,
  Ctx,
> = S extends { input: ZodType<infer I>; output: ZodType<infer O> }
  ? (opts: { input: I; ctx: Ctx; signal?: AbortSignal }) => Promise<O> | O
  : S extends { input: ZodType<infer I> }
    ? (opts: {
        input: I;
        ctx: Ctx;
        signal?: AbortSignal;
      }) => Promise<void> | void
    : S extends { output: ZodType<infer O> }
      ? (opts: { ctx: Ctx; signal?: AbortSignal }) => Promise<O> | O
      : (opts: { ctx: Ctx; signal?: AbortSignal }) => Promise<void> | void;

// ── ImplementSurfaceDeps ────────────────────────────────────────────────

export interface ImplementSurfaceDeps<S extends SurfaceSpec> {
  /** Channel factory. The framework computes channel names from surface
   *  keys (e.g. `"prefs:changed"`, `"notes:keys"`, `"notes:n1"`) and
   *  passes them into this fn — the consumer plugs in their underlying
   *  publisher (`publisherChannel(publisher, name)` for the `@orpc/experimental-publisher`
   *  adapter). */
  channel: <T>(name: string) => Channel<T>;

  cells?: {
    [K in keyof S["cells"] & string]: CellImplDeps<NonNullable<S["cells"]>[K]>;
  };
  collections?: {
    [K in keyof S["collections"] & string]: CollectionImplDeps<
      NonNullable<S["collections"]>[K]
    >;
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

/** Build the full server router from a surface + dep wiring. Replaces the
 *  hand-listed `t.X.<verb>.handler(handlers.<verb>)` plumbing for every
 *  cell, collection, stream, event, and imperative procedure declared in
 *  the surface.
 *
 *  Channel naming is surface-driven and not configurable: cells use
 *  `"<key>:changed"`, collections use `"<key>:keys"` + `"<key>:" +
 *  String(k)`, events use `"<key>:" + eventChannelKey(input)`. Renaming a
 *  surface key thus renames the channel — for cells whose channels back
 *  persisted subscriptions, prefer adding a new key and migrating off the
 *  old one.
 *
 *  Returns `{ router, ctx }`. Spread `router` into a host `t.router({...})`
 *  alongside hand-written raw-oRPC blocks for procedures the surface can't
 *  model (custom `onRetry`, binary framing, subscribe-before-yield); use
 *  `ctx` from domain code for typed mutations:
 *
 *      const { router: surfaceRouter, ctx: surfaceCtx } =
 *        implementSurface(surface, deps);
 *      const t = implement(fullContract);
 *      export const appRouter = t.router({
 *        ...surfaceRouter,
 *        terminal: t.terminal.handler(...),
 *      });
 */
export function implementSurface<const S extends SurfaceSpec>(
  surface: Surface<S>,
  deps: ImplementSurfaceDeps<S>,
) {
  // oRPC's typed implement(contract) chain is too dynamic for our walk
  // (we walk the spec at runtime to wire each entry); cast the whole
  // builder + result to `any` and rely on the surface's spec types for
  // call-site safety.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const t = implement(surface.contract as any) as any;
  const spec = surface.spec;

  const cellsCtx: Record<string, unknown> = {};
  const collectionsCtx: Record<string, unknown> = {};
  const namespaces: Record<string, Record<string, unknown>> = {};

  // ── Cells ────────────────────────────────────────────────────────────
  for (const [key, rawSpec] of Object.entries(spec.cells ?? {})) {
    const cellSpec = rawSpec as CellSpec<unknown, unknown>;
    const bus = deps.channel<unknown>(`${key}:changed`);
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
    const cellDeps = (deps.cells as any)?.[key] as
      | {
          store: CellStore<unknown>;
          patch?: (c: unknown, p: unknown) => unknown;
          onMutate?: (p: unknown, c: unknown) => void;
        }
      | undefined;
    if (!cellDeps) {
      throw new Error(`implementSurface: missing deps for cell "${key}"`);
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
    const handlers = cellHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      (surface.descriptors.cells as any)[key] as Cell<string, unknown>,
      {
        store: cellDeps.store,
        bus,
        patch: patchFn,
        onMutate: cellDeps.onMutate,
      },
    );

    cellsCtx[key] = {
      get: () => cellDeps.store.get(),
      set: (v: unknown) => {
        cellDeps.store.set(v);
        bus.publish(v);
      },
      ...(patchFn
        ? {
            patch: (p: unknown) => {
              const next = patchFn(cellDeps.store.get(), p);
              cellDeps.store.set(next);
              bus.publish(next);
            },
          }
        : {}),
    };

    const verbs =
      cellSpec.verbs ??
      (cellSpec.patchSchema
        ? DEFAULT_CELL_VERBS_WITH_PATCH
        : DEFAULT_CELL_VERBS_WITHOUT_PATCH);
    const ns: Record<string, unknown> = {};
    for (const v of verbs) {
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      const h = (handlers as any)[v];
      if (h === undefined) continue;
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      ns[v] = (t as any).surface[key][v].handler(h);
    }
    namespaces[key] = { ...(namespaces[key] ?? {}), ...ns };
  }

  // ── Collections ──────────────────────────────────────────────────────
  for (const [key, rawSpec] of Object.entries(spec.collections ?? {})) {
    const collSpec = rawSpec as CollectionSpec<unknown, unknown>;
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
    const collDeps = (deps.collections as any)?.[key] as
      | {
          readAll: () => Map<unknown, unknown>;
          readOne?: (k: unknown) => unknown;
          upsert: (k: unknown, v: unknown) => void;
          remove: (k: unknown) => void;
        }
      | undefined;
    if (!collDeps) {
      throw new Error(`implementSurface: missing deps for collection "${key}"`);
    }
    const keysBus = deps.channel<unknown[]>(`${key}:keys`);
    const perKeyBus = (k: unknown) =>
      deps.channel<unknown>(`${key}:${String(k)}`);

    // Surface-owned publish: every upsert/remove broadcasts the new key set
    // (and, on upsert, the new per-key value) through the framework's
    // channels. Consumers' upsert/remove stay persistence-only.
    const wrappedUpsert = (k: unknown, v: unknown) => {
      collDeps.upsert(k, v);
      keysBus.publish(Array.from(collDeps.readAll().keys()));
      perKeyBus(k).publish(v);
    };
    const wrappedRemove = (k: unknown) => {
      collDeps.remove(k);
      keysBus.publish(Array.from(collDeps.readAll().keys()));
    };

    collectionsCtx[key] = {
      upsert: wrappedUpsert,
      remove: wrappedRemove,
      readAll: collDeps.readAll,
      readOne: collDeps.readOne ?? ((k: unknown) => collDeps.readAll().get(k)),
    };

    const handlers = collectionHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      (surface.descriptors.collections as any)[key] as Collection<
        string,
        unknown,
        unknown
      >,
      {
        readAll: collDeps.readAll,
        readOne: collDeps.readOne,
        upsert: wrappedUpsert,
        remove: wrappedRemove,
        perKeyBus: perKeyBus as (k: unknown) => Channel<unknown>,
        keysBus: keysBus as Channel<unknown[]>,
      },
    );

    const verbs = collSpec.verbs ?? DEFAULT_COLLECTION_VERBS;
    const ns: Record<string, unknown> = {};
    for (const v of verbs) {
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      const h = (handlers as any)[v];
      if (h === undefined) continue;
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      ns[v] = (t as any).surface[key][v].handler(h);
    }
    namespaces[key] = { ...(namespaces[key] ?? {}), ...ns };
  }

  // ── Streams ──────────────────────────────────────────────────────────
  for (const [key] of Object.entries(spec.streams ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
    const streamDeps = (deps.streams as any)?.[key] as
      | {
          source: (
            i: unknown,
            s: AbortSignal | undefined,
          ) => AsyncIterable<unknown>;
        }
      | undefined;
    if (!streamDeps) {
      throw new Error(`implementSurface: missing deps for stream "${key}"`);
    }
    const handlers = streamHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      (surface.descriptors.streams as any)[key] as Stream<
        string,
        unknown,
        unknown
      >,
      { source: streamDeps.source },
    );
    namespaces[key] = {
      ...(namespaces[key] ?? {}),
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      get: (t as any).surface[key].get.handler(handlers.get),
    };
  }

  // ── Events ───────────────────────────────────────────────────────────
  // The surface owns each event's per-input channel. Domain code publishes
  // via `ctx.events.<key>.publish(input, payload)`; the wire source reads
  // from the same channel. Channel name = `<key>:<keyOfInput(input)>`.
  const eventsCtx: Record<string, unknown> = {};
  for (const [key] of Object.entries(spec.events ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
    const eventDeps = (deps.events as any)?.[key] as
      | {
          source?: (
            i: unknown,
            s: AbortSignal | undefined,
            helpers: { bus: Channel<unknown> },
          ) => AsyncIterable<unknown>;
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
    const source = (
      input: unknown,
      signal: AbortSignal | undefined,
    ): AsyncIterable<unknown> => {
      const bus = busFor(input);
      return consumerSource
        ? consumerSource(input, signal, { bus })
        : bus.subscribe(signal);
    };
    const handlers = eventHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      (surface.descriptors.events as any)[key] as Event<
        string,
        unknown,
        unknown
      >,
      { source },
    );
    namespaces[key] = {
      ...(namespaces[key] ?? {}),
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      get: (t as any).surface[key].get.handler(handlers.get),
    };
  }

  // ── Procedures ───────────────────────────────────────────────────────
  const ctx = {
    cells: cellsCtx,
    collections: collectionsCtx,
    events: eventsCtx,
  };
  for (const [ns, procs] of Object.entries(spec.procedures ?? {})) {
    namespaces[ns] = namespaces[ns] ?? {};
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
    const procDeps = (deps.procedures as any)?.[ns] as
      | Record<string, (opts: unknown) => unknown>
      | undefined;
    for (const verb of Object.keys(procs)) {
      const handler = procDeps?.[verb];
      if (!handler) {
        throw new Error(
          `implementSurface: missing handler for procedure "${ns}.${verb}"`,
        );
      }
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      namespaces[ns][verb] = (t as any).surface[ns][verb].handler(
        // biome-ignore lint/suspicious/noExplicitAny: see top of fn
        (opts: any) => handler({ ...opts, ctx }),
      );
    }
  }

  // Returns `{ router, ctx }`:
  //
  //   - `router` — a fragment under the top-level `surface` key, ready to
  //     spread into the consumer's host `t.router({...})` alongside
  //     hand-listed raw namespaces:
  //
  //       const { router: surfaceRouter, ctx: surfaceCtx } =
  //         implementSurface(surface, deps);
  //       const appRouter = t.router({
  //         ...surfaceRouter,
  //         terminal: { create: t.terminal.create.handler(...) },
  //       });
  //
  //   - `ctx` — the typed cells/collections/events helper map. Domain
  //     code that mutates a cell or collection (or fires an event) imports
  //     `surfaceCtx` and calls `surfaceCtx.cells.X.set(value)` etc. — the
  //     surface owns the apply+publish chain so direct `store.set + bus.publish`
  //     parallel paths (and their drift risk) don't exist.
  return {
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
    router: { surface: t.router(namespaces) } as any,
    ctx: ctx as SurfaceCtx<S>,
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
