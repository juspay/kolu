/** A COLLECTION MIRROR AS PRODUCTION BUILDS ONE — the real
 *  `useCollection` view over real `createSubscription` stores, for the suites
 *  that judge how WIDE a fold over a collection is.
 *
 *  Why not a hand-written `{ keys, byKey }`: the thing being judged is the
 *  number of tracked sources one scope holds, and the production seam's cost
 *  is the seam's own. A collection served per key
 *  (`surfaceClient.ts:1375-1405`) opens a subscription for the KEYS and one
 *  per key, each holding its frame in a `createStore<{ v }>`
 *  (`createSubscription.ts:686,713`), and `useCollection` hands out a memo
 *  per key over an index of them (`useCollection.ts:131-183`). So in
 *  production `keys()` is a STORE-PROXY array — walking it in user code costs
 *  its `length` leaf and one index leaf per key — and reading one record
 *  costs the per-key memo plus `store.v`. A mock handing back a plain array
 *  and a plain record under-measures that graph about threefold, and a fold
 *  that looks narrow under the mock can still be judged in the browser.
 *
 *  This drives the same two primitives with hand-pushed streams, so a suite
 *  can serve a fleet of any size and count what the app would count.
 *
 *  The view is built under a root of the caller's own (`useCollection`
 *  refuses an ownerless call), and every frame crosses a stream fiber, so a
 *  suite awaits {@link settle} after seeding or changing the mirror. */

import { createSubscription, useCollection } from "@kolu/surface/solid";
import {
  type ControllableStream,
  controllableStream,
} from "@kolu/surface/solid/testlib";
import { createMemo, createRoot } from "solid-js";

/** One collection the suite drives: its key list and one value per key. */
export interface CollectionMirror<K extends string, V> {
  /** The bound view, as `app.collections.<name>.use()` hands one out. */
  readonly view: {
    keys: () => ReadonlyArray<K>;
    byKey: (key: K) => (() => V | undefined) | undefined;
  };
  /** Serve a key's value — the first push for a key also opens its stream. */
  push(key: K, value: V): void;
  /** Say which keys the collection holds, in this order. */
  pushKeys(keys: ReadonlyArray<K>): void;
}

/** The streams a mirror holds, so a value pushed for a key the view has not
 *  looked up yet is still delivered once it does. */
interface Held<V> {
  readonly stream: ControllableStream<V>;
  last: V | undefined;
}

export function collectionMirror<K extends string, V>(
  name: string,
): CollectionMirror<K, V> {
  const keysStream = controllableStream<K[]>();
  const values = new Map<K, Held<V>>();
  const streamOf = (key: K): Held<V> => {
    const held = values.get(key);
    if (held !== undefined) return held;
    const made: Held<V> = { stream: controllableStream<V>(), last: undefined };
    values.set(key, made);
    return made;
  };
  const view = createRoot(() => {
    // The keys arrive as a subscription's STORE array, exactly as the client's
    // own per-key path opens them (`surfaceClient.ts:1377-1389`).
    const keysSub = createSubscription(keysStream.source);
    const keys = createMemo<K[]>(() => keysSub() ?? []);
    return useCollection(
      { name } as never,
      {
        keys,
        keyToInput: (key: K) => ({ key }),
        // `useCollection` opens each key's stream through `unenrolledStreamCall`,
        // which a suite mocks to call this procedure directly.
        valueSource: ((input: { key: K }) =>
          streamOf(input.key).stream.source) as never,
      } as never,
    ) as CollectionMirror<K, V>["view"];
  });
  return {
    view,
    push: (key, value) => {
      const held = streamOf(key);
      held.last = value;
      held.stream.push(value);
    },
    pushKeys: (keys) => keysStream.push([...keys]),
  };
}
