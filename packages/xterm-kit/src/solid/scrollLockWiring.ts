import { createEffect, createSignal } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";

/** The slice of the scroll-lock API the DOM wiring drives. Structural so the
 *  state machine stays unaware of this module. */
export interface ScrollIntentTarget {
  armUserScrollIntent(source: "wheel"): void;
  holdUserScrollIntent(source: "pointer"): void;
  releaseUserScrollIntent(): void;
}

/**
 * Wire the wheel + pointer-held scroll inputs into the scroll-lock latch
 * (#1272). Must be called synchronously within a reactive scope so the
 * `makeEventListener` cleanups register on the caller's owner.
 *
 * Both clusters listen in capture phase: xterm's own wheel/pointer handlers sit
 * deeper in the DOM and fire `onScroll` synchronously, so the intent must be
 * armed before they run — a bubble listener would arrive too late.
 */
export function wireScrollIntent(
  container: HTMLElement,
  scrollLock: ScrollIntentTarget,
): void {
  const [held, setHeld] = createSignal(false);
  makeEventListener(
    container,
    "wheel",
    () => scrollLock.armUserScrollIntent("wheel"),
    { capture: true, passive: true },
  );

  makeEventListener(
    container,
    "pointerdown",
    (e: PointerEvent) => {
      if (e.button === 0) {
        scrollLock.holdUserScrollIntent("pointer");
        setHeld(true);
      }
    },
    { capture: true, passive: true },
  );
  createEffect(() => {
    if (!held()) return;
    const release = () => {
      scrollLock.releaseUserScrollIntent();
      setHeld(false);
    };
    makeEventListener(document, "pointerup", release, {
      capture: true,
      passive: true,
    });
    makeEventListener(document, "pointercancel", release, {
      capture: true,
      passive: true,
    });
  });
}
