import { makeEventListener } from "@solid-primitives/event-listener";
import { walkShadowRoots } from "../dom/shadowWalk";

const COMMIT_THRESHOLD_PX = 4;
const SUBPIXEL_SLOP_PX = 1;

function cachedWhileConnected<T extends Element>(
  resolve: () => T | null,
): () => T | null {
  let cached: T | null = null;
  return () => {
    if (cached?.isConnected) return cached;
    cached = resolve();
    return cached;
  };
}

export type TouchScrollState = {
  startY: number;
  startTop: number;
  scroller: HTMLElement;
  moved: boolean;
};

export function findPierreScroller(container: HTMLElement): HTMLElement | null {
  return (
    walkShadowRoots(container, (root) => {
      for (const el of root.querySelectorAll<HTMLElement>("*")) {
        if (el.scrollHeight > el.clientHeight + SUBPIXEL_SLOP_PX) return el;
      }
      return undefined;
    }) ?? null
  );
}

export function nextScrollTop(
  state: TouchScrollState,
  clientY: number,
): number | null {
  const dy = clientY - state.startY;
  if (!state.moved && Math.abs(dy) < COMMIT_THRESHOLD_PX) return null;
  return state.startTop - dy;
}

export function attachPierreTouchScroll(container: HTMLElement): void {
  let state: TouchScrollState | null = null;

  const resolveScroller = cachedWhileConnected(() =>
    findPierreScroller(container),
  );

  const onStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const scroller = resolveScroller();
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
    e.preventDefault();
    e.stopPropagation();
  };

  const onEnd = () => {
    state = null;
  };

  makeEventListener(container, "touchstart", onStart, { passive: false });
  makeEventListener(container, "touchmove", onMove, { passive: false });
  makeEventListener(container, "touchend", onEnd);
  makeEventListener(container, "touchcancel", onEnd);
}
