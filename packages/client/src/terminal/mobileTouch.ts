/**
 * Mobile-touch bridges for xterm.js — Kolu's iOS-Safari workarounds
 * pulled out of `Terminal.tsx` so the platform volatility (iOS Safari
 * focus shuffling, touch viewport gaps in xterm 6.x) has a single
 * home. Both helpers register listeners via `makeEventListener` and
 * MUST run inside a SolidJS owner (`runWithOwner` or the synchronous
 * tail of `onMount`) so their cleanups dispose with the component.
 *
 * Why two helpers, not one merged setup: the tap-to-focus dance binds
 * pointer events on the `.xterm-screen` child (after coercing it to
 * `contenteditable=true`); touch-scroll binds touch events on the
 * wrapper container. Different targets, different event sets, separate
 * disposability — wrong to merge.
 */

import { makeEventListener } from "@solid-primitives/event-listener";
import type { Terminal as XTerm } from "@xterm/xterm";

/** Coerce `.xterm-screen` into a contenteditable target and bridge
 *  taps → `term.focus()` so iOS soft-keyboard summoning works. The
 *  underlying bug: xterm's mousedown → opacity-0-textarea-focus path
 *  shuffles focus mid-gesture, and iOS rejects programmatic
 *  soft-keyboard summoning when focus moves during the same
 *  user-gesture frame.
 *
 *  Strategy: preventDefault on pointerdown to block the
 *  contenteditable auto-focus, then defer the explicit `term.focus()`
 *  to pointerup gated by a movement threshold. Taps (small movement)
 *  summon the keyboard; swipes (larger movement, which is the
 *  touch-scroll path) don't. */
export function setupMobileTapToFocus(term: XTerm): void {
  const screen = term.element?.querySelector(
    ".xterm-screen",
  ) as HTMLElement | null;
  if (!screen) return;
  screen.setAttribute("contenteditable", "true");
  screen.setAttribute("spellcheck", "false");
  screen.setAttribute("autocorrect", "off");
  screen.setAttribute("autocapitalize", "none");
  screen.setAttribute("autocomplete", "off");
  screen.setAttribute("aria-readonly", "true");
  screen.style.caretColor = "transparent";
  screen.style.outline = "none";

  const TAP_THRESHOLD_PX = 10;
  const isTap = (dx: number, dy: number) =>
    Math.hypot(dx, dy) <= TAP_THRESHOLD_PX;
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
    if (!isTap(e.clientX - startX, e.clientY - startY)) return;
    term.focus();
  });
  makeEventListener(screen, "pointercancel", (e: PointerEvent) => {
    if (activeTap?.pointerId === e.pointerId) activeTap = null;
  });
}

/** Touch-scroll the xterm scrollback by bridging container touchmove
 *  → `terminal.scrollLines(...)`. xterm.js 6.0.0 declares
 *  `IViewport.handleTouchStart/Move` types but `Viewport.ts` has zero
 *  touch wiring, and the WebGL canvas eats touch events on the way to
 *  the parent `.xterm-viewport` — so swipes inside the terminal do
 *  nothing on mobile until we bridge them here.
 *
 *  Single-variable state machine: `touchAnchorY` is the Y baseline
 *  line conversion is measured from. `null` when idle, a number while
 *  a swipe is in progress. On every emitted line the anchor advances
 *  by exactly the consumed pixels, so the sub-line residue lives
 *  implicitly in `(currentY - touchAnchorY)` on the next move — no
 *  separate accumulator to keep in sync.
 *
 *  `scrollLock` picks up the resulting `term.onScroll` for free, so
 *  freezing live output while the user reads scrollback works without
 *  any extra wiring.
 *
 *  Reads `terminal` through an accessor because `Terminal.tsx`
 *  initializes the local `terminal` binding inside the same `onMount`
 *  body and may not have it when this setup runs — closing over the
 *  binding directly would capture the pre-init `undefined`. */
export function setupMobileTouchScroll(
  container: HTMLElement,
  getTerminal: () => XTerm | null | undefined,
): void {
  let touchAnchorY: number | null = null;
  makeEventListener(container, "touchstart", (e: TouchEvent) => {
    // Multi-touch (pinch-zoom) passes through to the browser
    const first = e.touches[0];
    if (e.touches.length !== 1 || first === undefined) return;
    touchAnchorY = first.clientY;
  });
  makeEventListener(container, "touchmove", (e: TouchEvent) => {
    // Multi-touch interrupts a swipe — drop the anchor so the next
    // single-finger move starts a fresh gesture instead of resuming
    // from a stale (possibly far-away) reference point.
    if (e.touches.length !== 1) {
      touchAnchorY = null;
      return;
    }
    const terminal = getTerminal();
    if (touchAnchorY === null || !terminal) return;
    const screen = terminal.element?.querySelector(
      ".xterm-screen",
    ) as HTMLElement | null;
    if (!screen) return;
    const cellHeight = screen.clientHeight / terminal.rows;
    // Number.isFinite catches NaN (0/0 if rows is transiently 0) which
    // a bare `<= 0` check would miss — NaN poisons the anchor.
    if (!Number.isFinite(cellHeight) || cellHeight <= 0) return;
    const first = e.touches[0];
    if (first === undefined) return;
    const lines = Math.trunc((first.clientY - touchAnchorY) / cellHeight);
    if (lines === 0) return;
    // Down-swipe (positive delta) shows earlier scrollback → scrollLines(-N)
    terminal.scrollLines(-lines);
    touchAnchorY += lines * cellHeight;
  });
  makeEventListener(container, "touchend", () => {
    touchAnchorY = null;
  });
}
