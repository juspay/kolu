import { makeEventListener } from "@solid-primitives/event-listener";
import type { Terminal as XTerm } from "@xterm/xterm";

const TAP_THRESHOLD_PX = 10;

function onTouchPointer(
  element: HTMLElement,
  event: "pointerdown" | "pointerup" | "pointercancel",
  handle: (e: PointerEvent) => void,
): void {
  makeEventListener(element, event, (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    handle(e);
  });
}

/** Route touch taps on the soft-keyboard input surface (`screen`, from
 *  `enableSoftKeyboardInput`). A tap-sized `pointerup` fires `onTap(clientX,
 *  clientY)`; if it returns `true` the tap was consumed (e.g. a `path:line` ref
 *  was followed) and nothing else happens, otherwise `onFocus` runs.
 *
 *  The gesture is browser-quirk knowledge end to end: iOS Safari rejects the
 *  soft keyboard when focus shuffles mid-gesture, so `pointerdown`
 *  `preventDefault`s the contenteditable auto-focus, and the focus decision is
 *  deferred to `pointerup` — still inside the user-gesture window iOS requires —
 *  gated on `TAP_THRESHOLD_PX` so a scroll never summons the keyboard. The one
 *  DOMAIN decision (what a tap on content *means*) is the consumer's `onTap` /
 *  `onFocus`; the mechanism here is the kit's. */
export function wireTouchTaps(
  screen: HTMLElement,
  handlers: {
    onTap: (clientX: number, clientY: number) => boolean;
    onFocus: () => void;
  },
): void {
  let activeTap: {
    pointerId: number;
    startX: number;
    startY: number;
  } | null = null;
  onTouchPointer(screen, "pointerdown", (e) => {
    e.preventDefault();
    activeTap = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
  });
  onTouchPointer(screen, "pointerup", (e) => {
    if (activeTap === null || e.pointerId !== activeTap.pointerId) return;
    const { startX, startY } = activeTap;
    activeTap = null;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > TAP_THRESHOLD_PX)
      return;
    if (handlers.onTap(e.clientX, e.clientY)) return;
    handlers.onFocus();
  });
  onTouchPointer(screen, "pointercancel", (e) => {
    if (activeTap?.pointerId === e.pointerId) activeTap = null;
  });
}

export interface TouchScrollTarget {
  armUserScrollIntent(source: "touch"): void;
}

/** Bridge single-finger vertical swipes on `container` into scrollback movement
 *  on `term`, arming the scroll-lock latch so live output freezes while the user
 *  reads (scrollLock picks up the resulting `term.onScroll` for free, #1272). */
export function wireTouchScroll(
  container: HTMLElement,
  term: XTerm,
  scrollLock: TouchScrollTarget,
): void {
  let anchorY: number | null = null;
  makeEventListener(container, "touchstart", (e: TouchEvent) => {
    const first = e.touches[0];
    if (e.touches.length !== 1 || first === undefined) return;
    anchorY = first.clientY;
  });
  makeEventListener(container, "touchmove", (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      anchorY = null;
      return;
    }
    if (anchorY === null) return;
    const screen = term.element?.querySelector(
      ".xterm-screen",
    ) as HTMLElement | null;
    if (!screen) return;
    const cellHeight = screen.clientHeight / term.rows;
    if (!Number.isFinite(cellHeight) || cellHeight <= 0) return;
    const first = e.touches[0];
    if (first === undefined) return;
    const lines = Math.trunc((first.clientY - anchorY) / cellHeight);
    if (lines === 0) return;
    scrollLock.armUserScrollIntent("touch");
    term.scrollLines(-lines);
    anchorY += lines * cellHeight;
  });
  makeEventListener(container, "touchend", () => {
    anchorY = null;
  });
}
