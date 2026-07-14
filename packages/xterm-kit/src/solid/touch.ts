/** The mobile touch surface xterm 6.0 ships none of.
 *
 *  xterm 6.0.0 declares `IViewport.handleTouchStart/Move` types but wires
 *  nothing, and the WebGL canvas eats touch events before the `.xterm-viewport`
 *  sees them — so on a phone a tap does nothing and a swipe does nothing until
 *  the kit bridges them. Two independent gestures, two wirings:
 *
 *   - `wireTouchTaps` — tap-vs-scroll discrimination on the contenteditable
 *     `.xterm-screen`, with the iOS soft-keyboard focus rules. What a tap
 *     *means* (follow a `path:line`, else focus-to-type) is the consumer's
 *     `onTap`/`onFocus` policy.
 *   - `wireTouchScroll` — touch → scrollback bridge, arming the scroll lock.
 *
 *  Both register `makeEventListener` cleanups, so call them synchronously within
 *  a reactive owner (the `<Xterm>` component / a `createXtermLifecycle` scope). */

import { makeEventListener } from "@solid-primitives/event-listener";
import type { Terminal as XTerm } from "@xterm/xterm";

/** A tap-sized pointer movement: taps summon the keyboard / follow a ref, longer
 *  drags are scrolls and do neither. Generous enough to tolerate finger jitter
 *  on a real tap but tighter than the ~1-cell-height step the scroll bridge
 *  reads as "scroll started". */
const TAP_THRESHOLD_PX = 10;

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
    /** Resolve what the tap hit; return true if it was consumed (no focus). */
    onTap: (clientX: number, clientY: number) => boolean;
    /** A plain-content tap — focus to type (summons the soft keyboard). */
    onFocus: () => void;
  },
): void {
  let activeTap: {
    pointerId: number;
    startX: number;
    startY: number;
  } | null = null;
  makeEventListener(screen, "pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    activeTap = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
  });
  makeEventListener(screen, "pointerup", (e: PointerEvent) => {
    if (activeTap === null || e.pointerId !== activeTap.pointerId) return;
    const { startX, startY } = activeTap;
    activeTap = null;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > TAP_THRESHOLD_PX)
      return;
    // A tap on a `path:line` reference follows the link (xterm's own link
    // activation is mouse/hover-only and never fires for touch); a tap on plain
    // content focuses to type. Only the latter summons the soft keyboard.
    if (handlers.onTap(e.clientX, e.clientY)) return;
    handlers.onFocus();
  });
  makeEventListener(screen, "pointercancel", (e: PointerEvent) => {
    if (activeTap?.pointerId === e.pointerId) activeTap = null;
  });
}

/** The slice of the scroll-lock latch the touch bridge arms. Structural so the
 *  latch stays unaware of this module. */
export interface TouchScrollTarget {
  armUserScrollIntent(source: "touch"): void;
}

/** Bridge single-finger vertical swipes on `container` into scrollback movement
 *  on `term`, arming the scroll-lock latch so live output freezes while the user
 *  reads (scrollLock picks up the resulting `term.onScroll` for free, #1272).
 *
 *  Single-variable state machine: `anchorY` is the Y baseline line conversion is
 *  measured from — `null` when idle, a number mid-swipe. On every emitted line
 *  the anchor advances by exactly the consumed pixels, so the sub-line residue
 *  lives implicitly in `(currentY − anchorY)` on the next move — no separate
 *  accumulator to keep in sync. Multi-touch (pinch-zoom) passes through to the
 *  browser and drops the anchor so the next single-finger move starts fresh. */
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
    // Number.isFinite catches NaN (0/0 if rows is transiently 0) which a bare
    // `<= 0` check would miss — NaN poisons the anchor.
    if (!Number.isFinite(cellHeight) || cellHeight <= 0) return;
    const first = e.touches[0];
    if (first === undefined) return;
    const lines = Math.trunc((first.clientY - anchorY) / cellHeight);
    if (lines === 0) return;
    // Down-swipe (positive delta) shows earlier scrollback → scrollLines(-N).
    // Arm intent FIRST: scrollLines fires onScroll synchronously, and the
    // scroll-lock latch only engages for user-made scrolls (#1272).
    scrollLock.armUserScrollIntent("touch");
    term.scrollLines(-lines);
    anchorY += lines * cellHeight;
  });
  makeEventListener(container, "touchend", () => {
    anchorY = null;
  });
}
