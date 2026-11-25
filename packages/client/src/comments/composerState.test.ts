// @vitest-environment happy-dom
//
// The composer's `close` is called from an EFFECT — `CodeTab.tsx`'s
// close-on-navigate watcher — and an effect callback's return value is its
// CLEANUP. Solid 2 refuses anything that is not a function or `undefined`, so
// a `close` that answers with what its setter answered takes the whole view
// down with it (dev throws out of the effect and escalates to
// REACTIVITY_HALTED). This drives the composer through that exact shape.
import type { ComposerTarget } from "./composerState";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { createComposer } from "./composerState";

const AT: ComposerTarget = {
  path: "src/main.ts",
  locator: { quote: "const x", prefix: "", suffix: " = 1" },
  rect: { x: 10, y: 20, width: 80, height: 16 },
};

describe("a view's comment composer", () => {
  it("closes from an effect without handing it a cleanup", () => {
    // What the Code view shows, and the watcher that drops a draft when it
    // moves (`code-view/CodeTab.tsx`, the close-on-navigate effect). The root
    // builds the wiring and nothing else: `open` is a capture surface's click,
    // so it is called from OUTSIDE the owned scope, as the app calls it.
    const made = createRoot((dispose) => {
      const [shown, setShown] = createSignal("src/main.ts");
      const composer = createComposer();
      createEffect(
        () => shown(),
        () => composer.close(),
        { defer: true },
      );
      return { composer, setShown, dispose };
    });
    made.composer.open(AT);
    flush();
    const opened = made.composer.target();
    made.setShown("src/other.ts");
    flush();
    const afterNavigating = made.composer.target();
    made.dispose();
    expect({ opened, afterNavigating }).toEqual({
      opened: AT,
      afterNavigating: null,
    });
  });
});
