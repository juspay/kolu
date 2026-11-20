// @vitest-environment happy-dom
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createDragClickGuard } from "./dragClickGuard";

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
    expect(swallow()).toBe(false);
    dispose();
  });

  it("clears the latch on the next frame when the drag produced no click", async () => {
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
