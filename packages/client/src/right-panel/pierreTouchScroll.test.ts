import { describe, expect, it } from "vitest";
import { findPierreScroller, nextScrollTop } from "./pierreTouchScroll";

describe("nextScrollTop", () => {
  const base = {
    startY: 100,
    startTop: 50,
    scroller: {} as HTMLElement,
    moved: false,
  };

  it("ignores sub-threshold jitter before a drag commits", () => {
    // 3px of finger drift while not yet moving → no scroll (a tap, not a
    // drag). The 4px commit threshold lets Pierre's row-click fire on
    // touchend instead of being eaten as a scroll.
    expect(nextScrollTop({ ...base, moved: false }, 100 + 3)).toBeNull();
    expect(nextScrollTop({ ...base, moved: false }, 100 - 3)).toBeNull();
  });

  it("commits once the drag passes the threshold", () => {
    // Drag finger UP by 20px (clientY decreases) → content scrolls DOWN:
    // scrollTop = startTop - dy = 50 - (-20) = 70.
    expect(nextScrollTop({ ...base, moved: false }, 100 - 20)).toBe(70);
    // Drag finger DOWN by 20px → scrollTop = 50 - 20 = 30.
    expect(nextScrollTop({ ...base, moved: false }, 100 + 20)).toBe(30);
  });

  it("keeps tracking once moved, even back inside the threshold band", () => {
    // After the drag commits, every subsequent delta applies — a momentary
    // return near the start must not re-freeze the scroll.
    expect(nextScrollTop({ ...base, moved: true }, 100 + 1)).toBe(49);
    expect(nextScrollTop({ ...base, moved: true }, 100)).toBe(50);
  });
});

describe("findPierreScroller", () => {
  // findPierreScroller only touches `.querySelector`, `?.shadowRoot`,
  // `.querySelectorAll`, `.scrollHeight`, `.clientHeight` — so a structural
  // mock exercises it without a real DOM (vitest runs in Node here).
  const el = (scrollHeight: number, clientHeight: number) =>
    ({ scrollHeight, clientHeight }) as HTMLElement;

  const container = (host: unknown): HTMLElement =>
    ({ querySelector: () => host }) as unknown as HTMLElement;

  it("returns the first overflowing descendant of the tree's shadow root", () => {
    const scroller = el(500, 200);
    const host = {
      shadowRoot: {
        querySelectorAll: () => [el(100, 100), scroller, el(300, 50)],
      },
    };
    expect(findPierreScroller(container(host))).toBe(scroller);
  });

  it("returns null when the tree host is absent", () => {
    expect(findPierreScroller(container(null))).toBeNull();
  });

  it("returns null when no descendant overflows", () => {
    const host = {
      shadowRoot: { querySelectorAll: () => [el(100, 100), el(50, 200)] },
    };
    expect(findPierreScroller(container(host))).toBeNull();
  });
});
