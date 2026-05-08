/** Typed accessor for the active terminal's DOM node.
 *
 *  The canvas marks its tiles with `data-canvas-tile=""` on the
 *  CanvasTile wrapper and `data-active="true"` when the tile is the
 *  user's selection. The inner Terminal element (xterm) carries
 *  `data-terminal-id` and `data-visible`. To "focus the active
 *  terminal" callers need to find the Terminal element *inside* the
 *  active tile — a two-attribute query. This module is the single
 *  grep-able home for that contract (issue #845).
 *
 *  **The selector is scoped via `data-canvas-tile`, not `data-testid`.**
 *  `data-active="true"` collides with several producers (RightPanel
 *  inspector tab, ModeChipPicker chips, SubPanelTabBar entries —
 *  boolean coercion → "true"); a bare `[data-active='true']` would
 *  resolve to whichever non-tile element comes first in DOM order,
 *  the inner lookup would find nothing, refocus would fall back to
 *  the first canvas tile, and `activeId` would silently flip off
 *  the user's selection. We need a canvas-tile-only marker. We
 *  use a dedicated production attribute (`data-canvas-tile`) rather
 *  than `data-testid="canvas-tile"` so a future test-attribute
 *  rename can't silently break refocus. */

const ACTIVE_TILE_SELECTOR = "[data-canvas-tile][data-active='true']";
const TERMINAL_INNER_SELECTOR = "[data-visible][data-terminal-id]";

/** The Terminal-element child of the active CanvasTile, or null when no
 *  tile is active. The returned node is the click/focus target the user
 *  perceives as "the terminal I'm looking at". */
export function getActiveTerminalNode(): HTMLElement | null {
  return (
    document
      .querySelector(ACTIVE_TILE_SELECTOR)
      ?.querySelector<HTMLElement>(TERMINAL_INNER_SELECTOR) ?? null
  );
}

/** First Terminal-element in DOM order, regardless of active state.
 *  Falls back when no tile is active (initial mount, just after closing
 *  the last tile, etc.) so refocus paths still have a target. */
export function getFirstTerminalNode(): HTMLElement | null {
  return document.querySelector<HTMLElement>(TERMINAL_INNER_SELECTOR);
}
