/** Shared Tailwind class string for tile chrome buttons.
 *
 *  One affordance shape — used by `TileTitleActions` (terminal chrome)
 *  and `BrowserRegion` chrome. Consolidated so a hover/focus tweak to
 *  the pill style flows to every tile-chrome surface. */
export const TILE_BUTTON_CLASS =
  "flex items-center justify-center h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
