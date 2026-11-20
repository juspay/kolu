/** Z-index contract for the canvas-tile / resize-handle stacking axis. Numbers
 *  are consumed as inline `z-index` style values at each site (Tailwind v4's
 *  @theme registers no custom `z-*` utility scale). */

export const Z_CANVAS_TILE_ACTIVE = 10;
export const Z_CANVAS_TILE_INACTIVE = 1;

/** Inner vertical handle inside `CodeTab` (tree ↔ content split) and the
 *  terminal-split handle inside a canvas tile. Any positioned descendant of
 *  the canvas-tile stacking context that must stay below the inner handle's
 *  hit zone stays below this value. */
export const Z_HANDLE_INNER = 10;

/** Outer horizontal handle between the canvas and the right panel. */
export const Z_HANDLE_OUTER = 20;
