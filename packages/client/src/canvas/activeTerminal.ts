/** Typed accessor for the active canvas terminal's DOM node — single
 *  grep-able home for the "find the inner xterm of the active tile"
 *  contract (issue #845).
 *
 *  Scoped via the production-only `data-canvas-tile` marker, NOT via
 *  `data-active='true'` alone: `data-active` is set by several
 *  unrelated producers via boolean coercion, and a bare global query
 *  can land on a non-tile element first in DOM order. The marker
 *  lives outside `data-testid` so a future test-attribute rename
 *  can't silently break refocus. */

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
