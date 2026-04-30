/**
 * @kolu/cells/server — end-to-end server-side bindings for cells, collections, and streams.
 *
 * The framework owns the snapshot+deltas wire protocol on both sides:
 * client-side `useCell` / `useCollection` / `useStream` hooks consume the
 * stream; server-side `cellHandlers` / `collectionHandlers` /
 * `streamHandlers` produce it. Adding a new cell to a typed oRPC router
 * is a single declarative call instead of a hand-rolled async generator
 * per route.
 *
 * The framework is non-magical about the contract: callers hand-list the
 * oRPC contract entries (TypeScript needs the literal at compile time
 * for the typed client). What the framework owns is the *handler bodies*
 * — get's snapshot+deltas loop, set's validate+persist+publish chain,
 * test__set's reset+publish chain.
 *
 * The persistence and pub/sub are pluggable via `CellStore<T>` and
 * `ChannelBus<T>` interfaces. Adapters for `conf` (`confStore`) and
 * `@orpc/experimental-publisher` (`publisherChannel`) ship with the
 * framework; consumers can supply their own.
 */

import type { Cell, Collection, Stream } from "./index";

// ── Persistence + pub/sub interfaces ───────────────────────────────────

/** Persistence interface for a Cell or Collection's storage backend. */
export interface CellStore<T> {
  get(): T;
  set(value: T): void;
}

/** A typed publish/subscribe channel. `publish` triggers all live
 *  iterators to emit the value; `subscribe` returns an AsyncIterable that
 *  yields each future publish until `signal` aborts. */
export interface ChannelBus<T> {
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
  bus: ChannelBus<T>;
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
  perKeyBus: (key: K) => ChannelBus<T>;
  /** Bus for the live key set (broadcasts `K[]` snapshots on add/remove). */
  keysBus: ChannelBus<K[]>;
}

export interface CollectionHandlers<K, T> {
  keys: (opts: { signal?: AbortSignal }) => AsyncGenerator<K[]>;
  get: (opts: { input: { key: K }; signal?: AbortSignal }) => AsyncGenerator<T>;
  update: (opts: { input: { key: K; value: T } }) => void;
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
    update: ({ input }) => {
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

// ── pollOnEvent (poll-on-event-tick stream source) ─────────────────────

/** Repeatedly read on event tick, yield only when the value changed.
 *
 *  Snapshot-then-deltas in the form: yield an initial read, then on every
 *  event from `install` re-read and yield only when `isEqual(last, next)`
 *  is false. The initial read's exception propagates (first frame); a
 *  subsequent read failure invokes `onReadError` and continues — a
 *  transient error shouldn't tear down a long-lived subscription.
 *
 *  The equality predicate stays at the call site so reviewers see it
 *  next to the schema. */
export async function* pollOnEvent<T>(opts: {
  read: () => Promise<T>;
  isEqual: (a: T, b: T) => boolean;
  install: (onEvent: () => void) => () => void;
  signal: AbortSignal | undefined;
  onReadError?: (err: unknown) => void;
}): AsyncIterable<T> {
  let last: T = await opts.read();
  yield last;
  for await (const _ of repoEventStream(opts.install, opts.signal)) {
    let next: T;
    try {
      next = await opts.read();
    } catch (e) {
      opts.onReadError?.(e);
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
 *  one migration ladder). */
export function confStore<T, Schema extends Record<string, unknown>>(
  conf: {
    get: (key: keyof Schema) => T;
    set: (key: keyof Schema, v: T) => void;
  },
  key: keyof Schema,
): CellStore<T> {
  return {
    get: () => conf.get(key),
    set: (v) => conf.set(key, v),
  };
}

// ── Built-in ChannelBus adapter for @orpc/experimental-publisher ──────

/** Build a `ChannelBus<T>` from an `@orpc/experimental-publisher`-style
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
 *  picking the wrong active terminal (or null). */
export function publisherChannel<T>(
  publisher: {
    publish: (channel: string, payload: T) => Promise<void> | void;
    subscribe: (
      channel: string,
      opts: { signal?: AbortSignal },
    ) => AsyncIterable<T>;
  },
  channelName: string,
): ChannelBus<T> {
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
