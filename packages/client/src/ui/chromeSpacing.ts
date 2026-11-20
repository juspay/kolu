/** Chrome spacing tokens — sizing/spacing vocabulary for the canvas tile
 *  title bar, the right-panel tab bar, and the dock rail width. */

/** Width of the collapsed dock rail. */
export const RAIL_WIDTH_PX = 44;

/** The identity-mark row in a chrome bar: 28px marks on a 32px row, nudged up
 *  1px so the marks sit on the same optical baseline as the host tab strip
 *  beside them. */
export const CHROME_MARK_ROW_CLASS =
  "inline-flex h-8 items-center gap-0.5 -translate-y-px";

/** Icon-button sized for a chrome bar (title bar, tab bar). Colour/hover/text
 *  sit with the caller. */
export const CHROME_ICON_BUTTON_CLASS =
  "flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer";

/** Compact 24px icon button for sub-chrome (sub-tab bars, dense toolbars). */
export const COMPACT_ICON_BUTTON_CLASS =
  "flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer";
