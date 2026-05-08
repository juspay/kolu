/** Typed accessor for the active terminal's DOM node.
 *
 *  The canvas marks its active tile with `data-active="true"` on the
 *  CanvasTile wrapper; the inner Terminal element (xterm) carries
 *  `data-terminal-id` and `data-visible`. To "focus the active terminal"
 *  callers need to find the Terminal element *inside* the active tile —
 *  a two-attribute query. This module is the single grep-able home for
 *  that contract so refocus / scroll / scope-of-active-terminal logic
 *  doesn't depend on the raw attribute strings (issue #845).
 *
 *  Scoped to the canvas-tile convention — does **not** match
 *  `data-active` on chrome bar tabs, sub-panel headers, mode chips, etc.
 *  The combined selector `[data-terminal-id][data-active='true']`
 *  serializes to `<inner-terminal-with-active-set-on-its-tile>` only via
 *  CanvasTile's `data-active="true"` form (other producers use
 *  `data-active=""` or boolean coercion). Future readers should keep
 *  narrowing through this accessor rather than reaching for the raw
 *  attribute. */

const ACTIVE_TILE_SELECTOR = "[data-active='true']";
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
