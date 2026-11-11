// @vitest-environment happy-dom
/** Re-ordering a host tab must not also switch to it.
 *
 *  solid-dnd releases a drag on `pointerup` and the browser then fires `click`
 *  on the element the gesture started on — the host tab's own label or status
 *  button. Nothing in solid-dnd suppresses it, so the drag that moved a tab also
 *  ran `setActiveHost`, or opened the diagnostics popover when the drag started
 *  on the dot. This pins the latch that swallows that one click. */

import { createRoot, createSignal } from "solid-js";
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
  const drag = (): void => {
    setDragging(true);
    setDragging(false);
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

  it("swallows it for a drag that ends where it started", () => {
    // The drop is a no-op re-order (released in its own slot), but the click is
    // not: it would still activate the tab the user only meant to pick up.
    const h = harness();
    h.drag();
    expect(h.swallow()).toBe(true);
    h.dispose();
  });

  it("does not arm while a drag is still in flight", () => {
    const [dragging, setDragging] = createSignal(false);
    const { swallow, dispose } = createRoot((d) => ({
      swallow: createDragClickGuard(dragging),
      dispose: d,
    }));
    setDragging(true);
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
