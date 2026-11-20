import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCamera, type HostCamera } from "../../hostScope/createCamera";

let activeCam: HostCamera | undefined;
vi.mock("../../hostScope/hostScopes", () => ({
  activeScope: () => (activeCam ? { camera: activeCam } : undefined),
}));

import { useCanvasViewport } from "./useCanvasViewport";

let frames: { id: number; cb: FrameRequestCallback }[] = [];
let nextFrameId = 1;
let clock = 0;
let notifyResize: ResizeObserverCallback;
const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

beforeEach(() => {
  frames = [];
  nextFrameId = 1;
  clock = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.push({ id, cb });
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    frames = frames.filter((f) => f.id !== id);
  }) as typeof cancelAnimationFrame;
});

afterEach(() => {
  useCanvasViewport().abortTransientInput();
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
  activeCam = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function drainFrames(now: number): void {
  const due = frames;
  frames = [];
  for (const f of due) f.cb(now);
}

const POSE_ORIGIN = { panX: 0, panY: 0, zoom: 1 };
const NO_GESTURES = {
  wheelTargetScrollsItself: () => false,
  covered: () => false,
};

describe("host-switch camera isolation", () => {
  it("an in-flight pan animation started on host A never writes host B's camera after a switch", async () => {
    await createRoot(async (dispose) => {
      try {
        const camA = createCamera();
        const camB = createCamera();
        const viewport = useCanvasViewport();
        const el = document.createElement("div");
        viewport.setContainerRef(el, NO_GESTURES);
        await Promise.resolve();
        notifyResize(
          [
            {
              target: el,
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
              contentRect: DOMRect.fromRect({ width: 600, height: 400 }),
            } as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );

        activeCam = camA;
        clock = 0;
        viewport.panTo(1000, 1000);

        clock = 30;
        drainFrames(clock);
        expect(camA.positioned()).toBe(true);

        activeCam = camB;
        viewport.abortTransientInput();

        clock = 500;
        drainFrames(clock);

        expect(camB.positioned()).toBe(false);
        expect(camB.snapshot()).toEqual(POSE_ORIGIN);
      } finally {
        dispose();
      }
    });
  });

  it("a queued gesture flush started on host A never writes host B's camera after a switch", () => {
    createRoot((dispose) => {
      try {
        const camA = createCamera();
        const camB = createCamera();
        const viewport = useCanvasViewport();
        const el = document.createElement("div");
        viewport.setContainerRef(el, NO_GESTURES);

        activeCam = camA;
        el.dispatchEvent(
          new WheelEvent("wheel", { deltaX: 80, deltaY: 0, cancelable: true }),
        );
        expect(frames.length).toBe(1);

        activeCam = camB;
        viewport.abortTransientInput();

        clock = 500;
        drainFrames(clock);
        expect(camB.positioned()).toBe(false);
        expect(camB.snapshot()).toEqual(POSE_ORIGIN);
      } finally {
        dispose();
      }
    });
  });
});
