/**
 * DOM-adjacent wiring for the scroll-lock latch.
 *
 * The state machine in `scrollLock.ts` is deliberately DOM-free (it never
 * touches `addEventListener`). The flip side is that something has to translate
 * raw DOM scroll inputs into intent reports — and that wiring used to be spread
 * across several independent `makeEventListener` calls in Terminal.tsx, each
 * carrying an out-of-band rule in a comment ("capture phase is load-bearing",
 * "hold from press to release", "this source string"). This module collapses
 * the wheel/pointer/keyboard cluster — the bulk of those sites — into one
 * helper so the source strings and the capture/hold/release rules live in a
 * single place, and every `<Xterm>` (a tile, a Look, a live pane) gets them.
 *
 * Kept at their call sites (interleaved with non-scroll logic): the touch arm
 * inside the touchmove bridge, and SearchBar navigation.
 */

import { createSignal } from "solid-js";
import {
  createEventListener,
  makeEventListener,
} from "@solid-primitives/event-listener";

/** The slice of the scroll-lock API the DOM wiring drives. Structural so the
 *  state machine stays unaware of this module. */
export interface ScrollIntentTarget {
  armUserScrollIntent(source: "wheel" | "keyboard"): void;
  holdUserScrollIntent(source: "pointer"): void;
  releaseUserScrollIntent(): void;
}

/**
 * Wire the wheel, pointer-held and keyboard scroll inputs into the scroll-lock
 * latch (#1272). Must be called synchronously within a reactive scope so the
 * `makeEventListener` cleanups register on the caller's owner.
 *
 * Every listener is in capture phase: xterm's own wheel/pointer/keydown
 * handlers sit deeper in the DOM and fire `onScroll` synchronously, so the
 * intent must be armed before they run — a bubble listener would arrive too
 * late.
 */
export function wireScrollIntent(
  container: HTMLElement,
  scrollLock: ScrollIntentTarget,
): void {
  const [held, setHeld] = createSignal(false);
  // Wheel input arms the latch. Passive: we only observe; xterm owns the
  // scrolling.
  makeEventListener(
    container,
    "wheel",
    () => scrollLock.armUserScrollIntent("wheel"),
    { capture: true, passive: true },
  );

  // Shift+PageUp / Shift+PageDown are the ONLY chords this xterm build turns
  // into a viewport scroll (KeyboardResultType.PAGE_UP / PAGE_DOWN →
  // scrollLines). Shift+Home/End emit escape SEQUENCES, not scrolls — arming
  // on them would leave a stale intent that an unrelated programmatic
  // off-bottom scroll could latch onto within the window. So arm only on the
  // keys that actually scroll; the key still reaches xterm's textarea after.
  makeEventListener(
    container,
    "keydown",
    (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "PageUp" || e.key === "PageDown"))
        scrollLock.armUserScrollIntent("keyboard");
    },
    { capture: true, passive: true },
  );

  // Pointer-driven scrolls that never fire `wheel`: dragging xterm's visible
  // scrollbar (a `pointerdown` on `.xterm-scrollbar`, then a global pointermove
  // monitor) and selection auto-scroll (a primary `mousedown` on the screen,
  // then an interval that scrolls the viewport while the button stays down).
  // Both emit `onScroll` only while the pointer is held — well past the time
  // window — so we HOLD intent from press to release rather than arm-and-expire.
  makeEventListener(
    container,
    "pointerdown",
    (e: PointerEvent) => {
      // Primary button only — secondary/middle don't drag-scroll.
      if (e.button === 0) {
        scrollLock.holdUserScrollIntent("pointer");
        setHeld(true);
      }
    },
    { capture: true, passive: true },
  );
  // Release on the document: a scrollbar/selection drag routinely ends with the
  // pointer outside the terminal, so a container-scoped pointerup would miss it
  // and leave intent stuck open. A held-only target means the listeners exist
  // exactly while the hold does: they are added when the hold starts and removed
  // when it ends or the owner disposes, so a hold that ends leaves nothing
  // attached.
  createEventListener(
    () => (held() ? document : undefined),
    ["pointerup", "pointercancel"],
    () => {
      scrollLock.releaseUserScrollIntent();
      setHeld(false);
    },
    { capture: true, passive: true },
  );
}
