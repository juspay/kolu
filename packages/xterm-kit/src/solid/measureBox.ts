/** Read a live terminal and its mount element into the {@link GridBox} that
 *  `./grid`'s `gridForBox` turns into cols × rows — the direct replacement for
 *  `@xterm/addon-fit`'s `proposeDimensions()`, reading the same layout facts
 *  the addon read. Why the renderer's own cell size is NOT among them is
 *  stated once, in `./grid`.
 *
 *  Its own module because it is the only place that knows WHERE each number
 *  comes from (`getComputedStyle`, an xterm option, a private measurement) —
 *  which keeps `grid.ts` arithmetic testable without a DOM. */

import type { Terminal as XTerm } from "@xterm/xterm";
import type { GridBox } from "./grid";
import { measuredCharWidth } from "../internals";

/** What xterm's viewport reserves for its vertical scrollbar when the
 *  `scrollbar.width` option is unset — `ViewportConstants.DEFAULT_SCROLL_BAR_WIDTH`
 *  in the pinned `@xterm/xterm` (`src/browser/shared/Constants.ts`).
 *
 *  A COPY of an xterm fact, because the constant is not reachable from outside
 *  the bundle (`@xterm/addon-fit` imported it; a consumer cannot). So it is
 *  pinned the way every other xterm fact here is: `internals.test.ts` opens a
 *  real terminal and compares what this module reserves against the width
 *  xterm actually renders its scrollbar at. A stale copy costs a terminal one
 *  or two columns too wide, with its last cells under the scrollbar — too
 *  quiet to notice without the pin. */
const DEFAULT_SCROLL_BAR_WIDTH = 14;

/** The CSS pixels xterm's viewport keeps for its vertical scrollbar.
 *
 *  Mirrors `Viewport._getChangeOptions()` in the pinned `@xterm/xterm`: the
 *  bar is hidden only by `scrollbar.showScrollbar === false`, and its width is
 *  `scrollbar.width` or the default — all three branches pinned against a real
 *  terminal in `internals.test.ts`. (`@xterm/addon-fit` asked a STALER
 *  question — it keyed off `scrollback === 0` and an `overviewRuler.width`
 *  option this xterm no longer has — which for kolu's options happened to
 *  produce the same 14.) */
function scrollbarWidth(term: XTerm): number {
  const scrollbar = term.options.scrollbar;
  if (scrollbar?.showScrollbar === false) return 0;
  return scrollbar?.width ?? DEFAULT_SCROLL_BAR_WIDTH;
}

/** `style`'s `prop` as a number — `NaN` when it is not a length, which
 *  `gridForBox` refuses as "cannot be measured" (a detached element's computed
 *  style is empty). `parseFloat`, not `parseInt`: a 1.5× OS zoom gives
 *  fractional computed lengths, and truncating each one throws away up to a
 *  pixel of box per side. */
function px(style: CSSStyleDeclaration, prop: string): number {
  return Number.parseFloat(style.getPropertyValue(prop));
}

/** Every number `gridForBox` needs, or `null` when the terminal is not open /
 *  not in a document — the states in which there is nothing to measure. */
export function measureGridBox(
  term: XTerm,
  /** The mount element — xterm's own element's parent, which is the box the
   *  grid is fitted to. */
  container: HTMLElement,
): GridBox | null {
  const element = term.element;
  const view = container.ownerDocument.defaultView;
  // `dimensions` is undefined until a renderer exists (before `open()`), and
  // carries the cell height both renderers compute identically once one does.
  const deviceCellHeight = term.dimensions?.device.cell.height;
  if (!element || !view || deviceCellHeight === undefined) return null;

  const parentStyle = view.getComputedStyle(container);
  const elementStyle = view.getComputedStyle(element);
  return {
    parentWidth: px(parentStyle, "width"),
    parentHeight: px(parentStyle, "height"),
    paddingHorizontal:
      px(elementStyle, "padding-left") + px(elementStyle, "padding-right"),
    paddingVertical:
      px(elementStyle, "padding-top") + px(elementStyle, "padding-bottom"),
    scrollbarWidth: scrollbarWidth(term),
    charWidth: measuredCharWidth(term),
    letterSpacing: term.options.letterSpacing ?? 0,
    deviceCellHeight,
    devicePixelRatio: view.devicePixelRatio,
  };
}
