import { Schema, Stream } from "effect";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { expect, it, vi } from "vitest";
import { defineSurface } from "../define";
import { useCollection } from "./useCollection";
import type { Subscription } from "./createSubscription";

vi.mock("../client", () => ({ unenrolledStreamCall: () => Stream.never }));
const surface = defineSurface({
  collections: { rows: { keySchema: Schema.String, schema: Schema.Number } },
});

it("keeps per-key subscription creation lazy, first-duplicate lookup, and unrelated readers asleep", () => {
  const [keys, setKeys] = createSignal(["a", "a"]);
  const opened: Array<{ key: string; sub: Subscription<number> }> = [];
  let wakes = 0;
  // The ROOT holds the view and its one reader; the key-set writes happen OUTSIDE
  // it, which is where a consumer's writes come from — an event handler or a
  // frame arriving, never a reactive scope (a write under an owner is
  // REACTIVE_WRITE_IN_OWNED_SCOPE).
  const { view, dispose } = createRoot((dispose) => {
    const view = useCollection(surface.descriptors.collections.rows, {
      keys,
      keyToInput: (key) => key,
      valueSource: (() => Stream.never) as never,
      enroll: (key, sub) => opened.push({ key, sub }),
    });
    // Nobody has asked for a key yet, so `mapArray` has not been built and not
    // one upstream subscription exists.
    expect(opened).toHaveLength(0);
    // The compute does the tracked lookup; the effect phase counts the wake.
    createEffect(
      () => view.byKey("a"),
      () => {
        wakes++;
      },
    );
    return { view, dispose };
  });
  // A live reader is what makes `mapArray` create the per-key subscriptions, and
  // it did so in the effect's COMPUTE — eager, like every Solid 2 computed. Only
  // the effect PHASE waits for the flush, which is what `wakes` counts.
  expect(opened).toHaveLength(2);
  expect(view.byKey("a")).toBe(opened[0]?.sub);
  flush();
  expect(wakes).toBe(1);
  setKeys(["a", "a", "b"]);
  flush();
  expect(wakes).toBe(1);
  expect(view.byKey("b")).toBeDefined();
  setKeys(["b"]);
  flush();
  expect(wakes).toBe(2);
  expect(view.byKey("a")).toBeUndefined();
  dispose();
});
