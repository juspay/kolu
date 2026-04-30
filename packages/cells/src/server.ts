/**
 * @kolu/cells/server — handler helpers for the server side of cells, collections, and streams.
 *
 * The framework is intentionally non-magical: callers hand-list contract
 * entries with `oc.router({...})` (because TypeScript needs that for the
 * typed client) and use these helpers to populate the *bodies* of the
 * streaming handlers. The result is one declarative line per cell at
 * the call site instead of an inline `yield snapshot; for await ...` loop.
 */

import type { Cell, Collection, Stream } from "./index";

/** A simple subscription bus for one channel: `publish` triggers all live
 *  iterators to emit the value. Implemented via an in-memory publisher
 *  bridge — callers wire one channel per cell/collection-key. */
export interface ChannelBus<T> {
  publish(value: T): void;
  subscribe(signal: AbortSignal | undefined): AsyncIterable<T>;
}

/** Snapshot-then-deltas async generator for a Cell. Yields the current
 *  value, then every value pushed to `bus`. The snapshot-then-deltas
 *  invariant is the load-bearing one: the streaming retry plugin re-invokes
 *  this on every reconnect, so the first frame must be a fresh full state. */
export async function* cellGetStream<Name extends string, T>(
  _cell: Cell<Name, T>,
  read: () => T | Promise<T>,
  bus: ChannelBus<T>,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  yield await read();
  for await (const v of bus.subscribe(signal)) yield v;
}

/** Snapshot-then-deltas for a Collection's key set. */
export async function* collectionKeysStream<Name extends string, K, T>(
  _coll: Collection<Name, K, T>,
  readKeys: () => K[] | Promise<K[]>,
  bus: ChannelBus<K[]>,
  signal: AbortSignal | undefined,
): AsyncGenerator<K[]> {
  yield await readKeys();
  for await (const v of bus.subscribe(signal)) yield v;
}

/** Snapshot-then-deltas for one Collection entry by key. */
export async function* collectionGetStream<Name extends string, K, T>(
  _coll: Collection<Name, K, T>,
  _key: K,
  read: () => T | Promise<T>,
  bus: ChannelBus<T>,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  yield await read();
  for await (const v of bus.subscribe(signal)) yield v;
}

/** Drive a Stream from its source factory. The source is responsible for
 *  yielding snapshot-then-deltas (or a single yield if the stream is
 *  one-shot — though that's a Cell, really). */
export async function* streamGetStream<Name extends string, I, T>(
  _stream: Stream<Name, I, T>,
  input: I,
  source: (input: I, signal: AbortSignal) => AsyncIterable<T>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  for await (const v of source(input, signal)) yield v;
}

/** Repeatedly read on event tick, yield only when the value changed.
 *
 *  Snapshot-then-deltas in the form: yield an initial read, then on every
 *  event from `install` re-read and yield only when `isEqual(last, next)`
 *  is false. The initial read's exception propagates (first frame); a
 *  subsequent read failure logs and continues — a transient git error
 *  shouldn't tear down a long-lived subscription.
 *
 *  Moved unchanged from Kolu's `streamSnapshots` (router.ts). The equality
 *  predicate stays at the call site so reviewers see it next to the schema. */
export async function* pollOnEvent<T>(opts: {
  read: () => Promise<T>;
  isEqual: (a: T, b: T) => boolean;
  install: (onEvent: () => void) => () => void;
  signal: AbortSignal | undefined;
  /** Called when a re-read after the initial snapshot throws. The default
   *  swallows silently — provide one to log loud. */
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
 *  AsyncIterable<void> that yields once per debounced tick. Bursts that
 *  fire while the consumer is mid-yield collapse into one wakeup. */
async function* repoEventStream(
  install: (onEvent: () => void) => () => void,
  signal: AbortSignal | undefined,
): AsyncIterable<void> {
  let dirty = false;
  let resolve: (() => void) | null = null;
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
