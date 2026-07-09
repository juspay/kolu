/** Host-switch camera isolation — the regression pin for the per-host-camera
 *  race (codex review F1). The viewport's pan-animation and queued-gesture
 *  machinery is MODULE scope (one active canvas) yet writes pan/zoom through
 *  `activeScope()`, which re-keys to the new host on a switch. A frame-late
 *  callback — an animation tween tick, or a queued gesture flush — that fires
 *  AFTER `activeHost` changed would land the OUTGOING host's motion in the
 *  INCOMING host's per-host camera, corrupting the pose the switch is meant to
 *  restore. `viewport.abortTransientInput()` (called by the active-host switch
 *  effect in `useCanvasCenterOnSwitch`) cancels the in-flight animation and
 *  discards the queued gesture up front, so the switched-to host's camera is
 *  never touched by the host we left. RED without the abort seam: both cases
 *  write host B's camera on the drained frame. */

import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCamera, type HostCamera } from "../../hostScope/createCamera";

// The viewport reads the ACTIVE host's camera as `activeScope()?.camera`. Drive
// it from a settable slot so a test can flip the active host mid-flight — exactly
// what a real host switch does to the `scopedByEntry` owner.
let activeCam: HostCamera | undefined;
vi.mock("../../hostScope/hostScopes", () => ({
  activeScope: () => (activeCam ? { camera: activeCam } : undefined),
}));

import { useCanvasViewport } from "./useCanvasViewport";

// Deterministic rAF + clock: capture frame callbacks so a test drives them by
// hand (real rAF never fires under vitest's headless clock).
let frames: { id: number; cb: FrameRequestCallback }[] = [];
let nextFrameId = 1;
let clock = 0;
const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

beforeEach(() => {
  frames = [];
  nextFrameId = 1;
  clock = 0;
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
  // Kill any in-flight animation before restoring the real clock/rAF.
  useCanvasViewport().abortTransientInput();
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
  activeCam = undefined;
  vi.restoreAllMocks();
});

/** Fire every currently-queued frame at timestamp `now`. A frame may enqueue its
 *  successor, which fires on the NEXT drain — matching real rAF semantics. */
function drainFrames(now: number): void {
  const due = frames;
  frames = [];
  for (const f of due) f.cb(now);
}

const POSE_ORIGIN = { panX: 0, panY: 0, zoom: 1 };

describe("host-switch camera isolation", () => {
  it("an in-flight pan animation started on host A never writes host B's camera after a switch", () => {
    createRoot((dispose) => {
      try {
        const camA = createCamera();
        const camB = createCamera();
        const viewport = useCanvasViewport();
        viewport.setContainerRef(document.createElement("div"));

        // Viewing A: start an animated pan toward a far point.
        activeCam = camA;
        clock = 0;
        viewport.panTo(1000, 1000);

        // One frame in: the animation is live and has moved A's camera.
        clock = 30;
        drainFrames(clock);
        expect(camA.positioned()).toBe(true);

        // SWITCH to B — exactly what the active-host effect does: re-key the
        // active camera AND abort the outgoing host's transient input.
        activeCam = camB;
        viewport.abortTransientInput();

        // Drive the clock past the animation's end. The cancelled tween frames
        // must not fire, so B's camera stays pristine (never positioned, origin).
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
        viewport.setContainerRef(el);

        // Viewing A: a wheel event enqueues a per-frame gesture flush (rAF).
        activeCam = camA;
        el.dispatchEvent(
          new WheelEvent("wheel", { deltaX: 80, deltaY: 0, cancelable: true }),
        );
        expect(frames.length).toBe(1); // a flush is queued

        // SWITCH to B before the flush frame runs, aborting the queued gesture.
        activeCam = camB;
        viewport.abortTransientInput();

        // The queued flush is discarded — B's camera is never touched.
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
