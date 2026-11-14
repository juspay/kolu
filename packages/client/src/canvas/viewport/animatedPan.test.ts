// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animatePan } from "./animatedPan";

/** A tab in the background: frames stop coming, timers keep running. */
function stopFrames(): () => void {
  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => undefined;
  return () => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
  };
}

describe("animatePan", () => {
  let restoreFrames: (() => void) | undefined;

  beforeEach(() => {
    // Only the timer half is faked — rAF is replaced by hand above, because
    // the point is that it NEVER fires.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    restoreFrames?.();
    restoreFrames = undefined;
    vi.useRealTimers();
  });

  it("lands on its target even if no frame ever arrives", () => {
    restoreFrames = stopFrames();
    const ticks: Array<[number, number]> = [];
    const done = vi.fn();
    animatePan(
      { x: 0, y: 0 },
      { x: 400, y: 200 },
      (x, y) => ticks.push([x, y]),
      {
        durationMs: 150,
        onDone: done,
      },
    );

    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    // The camera is where it was going, and the tween reported itself over —
    // so nothing downstream waits for a frame the background tab will not
    // produce until the user comes back (`cameraSettled`).
    expect(ticks.at(-1)).toEqual([400, 200]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the pan was aborted", () => {
    restoreFrames = stopFrames();
    const ticks: Array<[number, number]> = [];
    const done = vi.fn();
    const controller = animatePan(
      { x: 0, y: 0 },
      { x: 400, y: 200 },
      (x, y) => ticks.push([x, y]),
      { durationMs: 150, onDone: done },
    );
    controller.abort();
    vi.advanceTimersByTime(2_000);
    // Whatever cancelled the tween is the new truth: the guard must not drag
    // the camera to a target nobody asked for any more.
    expect(ticks).toEqual([]);
    expect(done).not.toHaveBeenCalled();
  });
});
