import { Schema, Stream } from "effect";
import { createComputed, createRoot, createSignal } from "solid-js";
import { expect, it, vi } from "vitest";
import { defineSurface } from "../define";
import { useCollection } from "./useCollection";
import type { Subscription } from "./createSubscription";

vi.mock("../client", () => ({ unenrolledStreamCall: () => Stream.never }));
const surface = defineSurface({
  collections: { rows: { keySchema: Schema.String, schema: Schema.Number } },
});

it("keeps per-key subscription creation lazy, first-duplicate lookup, and unrelated readers asleep", () => {
  createRoot((dispose) => {
    const [keys, setKeys] = createSignal(["a", "a"]);
    const opened: Array<{ key: string; sub: Subscription<number> }> = [];
    const view = useCollection(surface.descriptors.collections.rows, {
      keys,
      keyToInput: (key) => key,
      valueSource: (() => Stream.never) as never,
      enroll: (key, sub) => opened.push({ key, sub }),
    });
    expect(opened).toHaveLength(0);
    let wakes = 0;
    createComputed(() => {
      view.byKey("a");
      wakes++;
    });
    expect(opened).toHaveLength(2);
    expect(view.byKey("a")).toBe(opened[0]?.sub);
    setKeys(["a", "a", "b"]);
    expect(wakes).toBe(1);
    expect(view.byKey("b")).toBeDefined();
    setKeys(["b"]);
    expect(wakes).toBe(2);
    expect(view.byKey("a")).toBeUndefined();
    dispose();
  });
});
