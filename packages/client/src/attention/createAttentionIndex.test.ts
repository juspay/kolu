import { createEffect, createRoot, createSignal } from "solid-js";
import { expect, it } from "vitest";
import { createAttentionIndex } from "./createAttentionIndex";

// The owner holds the index and its readers; the signals and the writes that
// drive them live outside it, as the app's do (a write inside an owned scope
// is a Solid 2 error).
it("only wakes terminals whose class or live membership changed", () => {
  const [classes, setClasses] = createSignal({
    asking: ["a"],
    working: ["b"],
    finished: [],
    linger: [],
  });
  const [live, setLive] = createSignal(["a"]);
  const wakes = [0, 0, 0];
  const dispose = createRoot((disposeRoot) => {
    const index = createAttentionIndex(classes, live);
    ["a", "b", "c"].forEach((id, i) => {
      createEffect(
        () => {
          index.classOf(id);
          index.isLive(id);
          wakes[i]!++;
        },
        () => {},
      );
    });
    return disposeRoot;
  });
  try {
    setLive(["b"]);
    expect(wakes).toEqual([2, 2, 1]);
    setLive(["b"]);
    expect(wakes).toEqual([2, 2, 1]);
    setClasses({ asking: [], working: ["a", "b"], finished: [], linger: [] });
    expect(wakes).toEqual([3, 2, 1]);
  } finally {
    dispose();
  }
});
