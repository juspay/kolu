/**
 * The harness every batched-`deltas` suite drives the hook through.
 *
 * Four suites in this package watch one collection's `deltas` stream, and each had
 * written out the same three moves: a reactive root, a hand-pushed source, and two
 * macrotask turns to let a pushed frame cross the stream fiber and land in the
 * store. That is the shape that drifts — one suite fixes a timing flake by adding a
 * turn and the others silently keep testing the old timing — so it lives here once,
 * beside the {@link controllableStream} it is built on.
 */

import { Schema } from "effect";
import { createRoot } from "solid-js";
import type { CollectionDeltasMsg } from "../define";
import { type Collection, collection } from "../index";
import { controllableStream } from "./controllableStream.testlib";
import {
  type UseCollectionDeltasResult,
  useCollectionDeltas,
} from "./useCollection";

/** Two macrotask turns — enough for one pushed frame to cross the stream fiber, land
 *  in the store, and for the effects that observe it to flush. Never fewer: an
 *  assertion is never relaxed to fit the timing, the flush is made longer. */
export async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** What a suite drives the hook with: the view under test, the three terminations of
 *  its source, and whatever the hook reported through `onError`. */
export interface DeltasHarness<K, T> {
  readonly view: UseCollectionDeltasResult<K, T>;
  /** Deliver one wire frame. */
  push(frame: CollectionDeltasMsg<K, T>): void;
  /** End the stream normally (a typed end). */
  close(): void;
  /** Fail the stream, terminally. */
  fail(error: unknown): void;
  /** Errors the hook reported through `onError`, in order. */
  readonly errors: Error[];
}

/** Run `body` against `useCollectionDeltas` over a hand-pushed source, inside a
 *  reactive root that is disposed however the body ends. */
export async function driveDeltas<K, T>(
  descriptor: Collection<string, K, T>,
  body: (harness: DeltasHarness<K, T>) => Promise<void>,
): Promise<void> {
  await createRoot(async (dispose) => {
    const { source, push, close, fail } =
      controllableStream<CollectionDeltasMsg<K, T>>();
    const errors: Error[] = [];
    const view = useCollectionDeltas(descriptor, {
      source,
      onError: (err) => errors.push(err),
    });
    try {
      await body({ view, push, close, fail, errors });
    } finally {
      dispose();
    }
  });
}

/** The fixture value type the store and fold suites both watch — one number, so an
 *  assertion is about WHEN a frame lands and on WHICH key, never about the payload. */
export interface NumberRow {
  readonly n: number;
}

/** A string-keyed collection of {@link NumberRow}. Only `name` is read at runtime;
 *  the schemas are what type `K` and `T` at the call site. */
export const numberRows = collection({
  name: "rows",
  keySchema: Schema.String,
  schema: Schema.Struct({ n: Schema.Number }),
});
