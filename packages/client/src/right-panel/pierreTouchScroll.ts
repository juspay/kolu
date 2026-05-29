/** Manual touch-scroll driver for Pierre's file tree inside the mobile
 *  bottom-sheet drawer.
 *
 *  Two layers conspire to freeze the tree on a real phone, and only one of
 *  them is fixed by `data-corvu-no-drag`:
 *
 *    1. Corvu's drawer claims vertical drags as a sheet-dismiss. The
 *       `data-corvu-no-drag` attribute on the tree panel (see `CodeTab.tsx`)
 *       makes Corvu's `locationIsDraggable` walk bail, so this part is
 *       handled — but it's necessary, not sufficient.
 *    2. iOS Safari's *own* native-scroll discovery is unreliable for a
 *       shadow-rooted scroller below a portaled `Drawer.Content`: the
 *       `touchmove` deltas never reach Pierre's inner viewport, so the tree
 *       stays frozen below the visible band even with Corvu out of the way.
 *       Playwright emulation does not reproduce this — only real hardware.
 *
 *  So we drive the scroll ourselves: on `touchstart` we locate Pierre's
 *  shadow-DOM scroller and snapshot its `scrollTop`; on each committed
 *  `touchmove` we set `scrollTop` directly from the finger delta and
 *  `preventDefault` so iOS doesn't fight us. A stationary tap stays under
 *  the commit threshold and falls through to Pierre's row-click path.
 *
 *  (Originally lived in `MobileCodeSheet.tsx`; restored here after the mobile
 *  Code tab was unified into `CodeTab.tsx` + `RightPanelDrawer.tsx`.) */

import { onCleanup } from "solid-js";

/** Below this many pixels of finger travel, a touch is still a tap — let
 *  Pierre's row-click fire on `touchend` rather than eating it as a scroll. */
const COMMIT_THRESHOLD_PX = 4;

/** The scroll state captured at `touchstart`, carried across `touchmove`s. */
export type TouchScrollState = {
  startY: number;
  startTop: number;
  scroller: HTMLElement;
  moved: boolean;
};

/** Find Pierre's scroll viewport — the overflowing element inside the tree's
 *  shadow root. Both the shadow host and the viewport are located by
 *  capability, not by tag/class, so a Pierre internal rename can't silently
 *  break us. Returns null when the tree hasn't rendered yet or nothing
 *  overflows (short tree: nothing to scroll anyway). */
export function findPierreScroller(container: HTMLElement): HTMLElement | null {
  // Pierre mounts its tree into a custom element with an open shadow root.
  // Locate that host as the (only) light-DOM descendant carrying a shadowRoot
  // rather than by Pierre's `file-tree-container` tag name: a tag literal is a
  // detached copy of a `@pierre/trees` internal — a rename would silently
  // return null with no build error — and importing the tag constant would
  // reach past the `@kolu/solid-pierre` firewall. The capability probe has
  // neither failure mode.
  let root: ShadowRoot | null = null;
  for (const el of container.querySelectorAll("*")) {
    if (el.shadowRoot) {
      root = el.shadowRoot;
      break;
    }
  }
  if (!root) return null;
  // The viewport inside the shadow root is likewise probed by capability —
  // the first overflowing descendant — since it has no stable exported name.
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (el.scrollHeight > el.clientHeight + 1) return el;
  }
  return null;
}

/** Pure delta math: the `scrollTop` to apply for a finger at `clientY`, or
 *  null while the drag is still below the commit threshold (a tap). Exported
 *  so the threshold + direction logic is unit-tested without a DOM. */
export function nextScrollTop(
  state: TouchScrollState,
  clientY: number,
): number | null {
  const dy = clientY - state.startY;
  if (!state.moved && Math.abs(dy) < COMMIT_THRESHOLD_PX) return null;
  // Finger up (clientY decreases, dy < 0) scrolls content down, so subtract.
  return state.startTop - dy;
}

/** Wire the manual touch-scroll driver onto `container` (the element wrapping
 *  the Pierre tree). Registers non-passive `touchmove` so `preventDefault`
 *  actually suppresses iOS native scroll, and tears the listeners down via
 *  `onCleanup`. Call from a ref callback inside a reactive owner. */
export function attachPierreTouchScroll(container: HTMLElement): void {
  let state: TouchScrollState | null = null;

  // Cache the located scroller — re-probing Pierre's whole shadow root on
  // every touchstart is wasteful, and the scroller is stable for the lifetime
  // of a `<FileTree>` mount. Re-probe when the cache is empty or its node was
  // detached (Pierre remount on mode switch), so the cache never outlives the
  // element it points at — this keeps the driver from owning a stale-node
  // invalidation invariant.
  let cached: HTMLElement | null = null;
  const resolveScroller = (): HTMLElement | null => {
    if (cached?.isConnected) return cached;
    cached = findPierreScroller(container);
    return cached;
  };

  const onStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const scroller = resolveScroller();
    // Short tree (nothing overflows): leave the gesture to the drawer so a
    // drag can still dismiss the sheet. Only claim the touch below, once we
    // know we'll actually drive a scroll.
    if (!scroller) return;
    e.stopPropagation();
    state = {
      startY: touch.clientY,
      startTop: scroller.scrollTop,
      scroller,
      moved: false,
    };
  };

  const onMove = (e: TouchEvent) => {
    if (!state) return;
    const touch = e.touches[0];
    if (!touch) return;
    const top = nextScrollTop(state, touch.clientY);
    if (top === null) return;
    state.moved = true;
    state.scroller.scrollTop = top;
    // Eat the committed move so iOS doesn't run its own scroll attempt and
    // Pierre's row-click doesn't fire on the following touchend.
    e.preventDefault();
    e.stopPropagation();
  };

  const onEnd = () => {
    state = null;
  };

  container.addEventListener("touchstart", onStart, { passive: false });
  container.addEventListener("touchmove", onMove, { passive: false });
  container.addEventListener("touchend", onEnd);
  container.addEventListener("touchcancel", onEnd);
  onCleanup(() => {
    container.removeEventListener("touchstart", onStart);
    container.removeEventListener("touchmove", onMove);
    container.removeEventListener("touchend", onEnd);
    container.removeEventListener("touchcancel", onEnd);
  });
}
