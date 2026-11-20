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
    expect(nextScrollTop({ ...base, moved: false }, 100 + 3)).toBeNull();
    expect(nextScrollTop({ ...base, moved: false }, 100 - 3)).toBeNull();
  });

  it("commits once the drag passes the threshold", () => {
    expect(nextScrollTop({ ...base, moved: false }, 100 - 20)).toBe(70);
    expect(nextScrollTop({ ...base, moved: false }, 100 + 20)).toBe(30);
  });

  it("keeps tracking once moved, even back inside the threshold band", () => {
    expect(nextScrollTop({ ...base, moved: true }, 100 + 1)).toBe(49);
    expect(nextScrollTop({ ...base, moved: true }, 100)).toBe(50);
  });
});

describe("findPierreScroller", () => {
  const el = (scrollHeight: number, clientHeight: number) =>
    ({ scrollHeight, clientHeight }) as HTMLElement;

  const host = (shadowChildren: HTMLElement[]) =>
    ({
      shadowRoot: { querySelectorAll: () => shadowChildren, children: [] },
      children: [],
    }) as unknown as Element;

  const container = (children: Element[]): HTMLElement =>
    ({ children }) as unknown as HTMLElement;

  it("returns the first overflowing descendant of the tree's shadow root", () => {
    const scroller = el(500, 200);
    const h = host([el(100, 100), scroller, el(300, 50)]);
    expect(findPierreScroller(container([h]))).toBe(scroller);
  });

  it("returns null when no shadow host is present", () => {
    const noShadow = { children: [] } as unknown as Element;
    expect(findPierreScroller(container([noShadow, noShadow]))).toBeNull();
  });

  it("returns null when no descendant overflows", () => {
    const h = host([el(100, 100), el(50, 200)]);
    expect(findPierreScroller(container([h]))).toBeNull();
  });
});
