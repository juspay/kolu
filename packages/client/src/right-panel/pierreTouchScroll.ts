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

import { makeEventListener } from "@solid-primitives/event-listener";
import { walkShadowRoots } from "../dom/shadowWalk";

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
  // `walkShadowRoots` visits every shadow root reachable from `container`.
  // We visit the first one (Pierre's `file-tree-container` custom element)
  // and search its internals for the first overflowing descendant — the
  // scroll viewport.
  // +1: guards against fractional-pixel rounding where scrollHeight and
  // clientHeight can both be integers that differ by less than 1px on
  // high-DPI displays.
  return (
    walkShadowRoots(container, (root) => {
      for (const el of root.querySelectorAll<HTMLElement>("*")) {
        if (el.scrollHeight > el.clientHeight + 1) return el;
      }
      return undefined;
    }) ?? null
  );
}

/** Pure delta math: the `scrollTop` to apply for a finger at `clientY`, or
 *  null while the drag is still below the commit threshold (a tap). Exported
 *  so the threshold + direction logic is unit-tested without a DOM.
 *
 *  The returned value is unclamped — it may be negative or past
 *  `scrollHeight - clientHeight`; assigning it to `el.scrollTop` lets the
 *  browser clamp into range (over-scroll is a no-op, by contract). */
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
 *  the Pierre tree). Registers a non-passive `touchmove` so `preventDefault`
 *  can suppress iOS native scroll.
 *
 *  MUST be called synchronously inside a SolidJS reactive owner — a `ref`
 *  callback or `onMount`, never after an `await`. Listener teardown rides on
 *  `makeEventListener`'s `onCleanup`, which silently no-ops outside an owner
 *  and would leak the four listeners. */
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
    // preventDefault is the load-bearing call: it suppresses iOS's native
    // scroll so our scrollTop write wins, and stops Pierre's row-click from
    // firing on the touchend after a drag. stopPropagation is belt-and-braces
    // — it keeps the move off document-level handlers — NOT what neutralizes
    // Corvu's drag-to-dismiss; that's `data-corvu-no-drag` on the pointer path.
    e.preventDefault();
    e.stopPropagation();
  };

  const onEnd = () => {
    state = null;
  };

  // `makeEventListener` registers its own `onCleanup` against the current
  // reactive owner (hence the call-site requirement below). `{ passive: false }`
  // on touchmove is load-bearing — it's what lets `preventDefault` suppress
  // iOS's native scroll.
  makeEventListener(container, "touchstart", onStart, { passive: false });
  makeEventListener(container, "touchmove", onMove, { passive: false });
  makeEventListener(container, "touchend", onEnd);
  makeEventListener(container, "touchcancel", onEnd);
}
