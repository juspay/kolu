// @vitest-environment happy-dom
/** Re-ordering a host tab must not also switch to it.
 *
 *  A drag is released on `pointerup`, and a `click` can follow on the element
 *  the gesture started on — the host tab's own label or status button — which
 *  would run `setActiveHost`, or open the diagnostics popover when the drag
 *  started on the dot. This pins the latch that swallows that one click. */

import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { createDragClickGuard } from "./dragClickGuard";

/** Let one animation frame pass — the latch's own clearing beat. */
function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
}

function harness() {
  const [dragging, setDragging] = createSignal(false);
  let swallow!: () => boolean;
  const dispose = createRoot((d) => {
    swallow = createDragClickGuard(dragging);
    return d;
  });
  // A drag is two frames: it starts, and later it ends. The writes are staged,
  // so each one is flushed — collapsing both into one update would mean the
  // guard never saw the drag at all.
  const drag = (): void => {
    setDragging(true);
    flush();
    setDragging(false);
    flush();
  };
  return { swallow: () => swallow(), drag, dispose };
}

describe("createDragClickGuard", () => {
  it("lets a plain click through when no drag has happened", () => {
    const h = harness();
    expect(h.swallow()).toBe(false);
    expect(h.swallow()).toBe(false);
    h.dispose();
  });

  it("swallows the click a finished drag leaves behind — and only that one", () => {
    const h = harness();
    h.drag();
    expect(h.swallow()).toBe(true);
    // The NEXT click is the user clicking the tab, and must still switch host.
    expect(h.swallow()).toBe(false);
    h.dispose();
  });

  it("does not arm while a drag is still in flight", () => {
    const [dragging, setDragging] = createSignal(false);
    const { swallow, dispose } = createRoot((d) => ({
      swallow: createDragClickGuard(dragging),
      dispose: d,
    }));
    setDragging(true);
    flush();
    expect(swallow()).toBe(false);
    dispose();
  });

  it("clears the latch on the next frame when the drag produced no click", async () => {
    // Released off the element, or cancelled: no click follows. A latch left
    // armed would eat the user's NEXT real click on the tab.
    const h = harness();
    h.drag();
    await nextFrame();
    expect(h.swallow()).toBe(false);
    h.dispose();
  });

  it("re-arms for every drag", () => {
    const h = harness();
    h.drag();
    expect(h.swallow()).toBe(true);
    h.drag();
    expect(h.swallow()).toBe(true);
    h.dispose();
  });
});
